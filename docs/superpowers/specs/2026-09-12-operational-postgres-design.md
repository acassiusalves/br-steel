# Migração do banco operacional para PostgreSQL

Status: roteiro preparado a pedido do usuário em 12/09/2026. Medições e primeira etapa concluídas localmente. A etapa 2 já tem schema, importação retomável e adaptador candidato de vendas; faltam os adaptadores de estoque/produção antes do piloto hospedado. O PostgreSQL operacional ainda não foi ativado.

## Objetivo e escopo

Migrar o armazenamento de vendas, estoque, insumos e produção do Firestore para o PostgreSQL do projeto Supabase `mlumbvxpaqfzpdjnvzxc`, reduzindo a transferência de registros completos nas consultas do sistema e do MCP. Manter o login do sistema, o OAuth do MCP e a aplicação na Vercel.

O MCP continua usando as permissões efetivas do usuário, verificadas pelo servidor a cada operação. A mudança de banco não concede permissões nem habilita escrita pelo Claude. A liberação de ferramentas de escrita terá uma entrega própria, depois da migração e da validação das operações de gravação.

Base factual: [medições](../../medicoes-postgresql-2026-09-12.md) e [avaliação inicial](../../avaliacao-supabase-free-2026-09-12.md). O núcleo medido somou 37,08 MB; a projeção com a base hospedada existente foi 63,22 MB. São resultados de um protótipo local, com dados pseudonimizados, e não do esquema definitivo em produção.

## Abordagem proposta

Adotar uma migração gradual, com cópia para conferência e uma única fonte autorizada a receber gravações em cada etapa. O Firestore permanece como fonte principal até que todas as entradas de escrita do núcleo tenham sido adaptadas e verificadas. Uma réplica permanente exigiria manter dois bancos, sincronização, leituras e recuperação de falhas; uma troca integral imediata ampliaria o risco aos módulos ainda não modelados. A cópia de conferência terá duração e orçamento limitados.

O servidor do BR Steel será o ponto de acesso aos dados. As operações mantêm suas verificações de acesso e projeções por módulo; os repositórios internos implementam a persistência. Resumos de vendas e demanda devem ser calculados no SQL, para retornar agregados. Listagens terão filtros e paginação no banco. A autenticação atual usa os usuários do sistema e não será substituída por um novo cadastro no Supabase.

Para o acesso operacional futuro, a proposta é um schema privado `brsteel_ops`, papéis de banco com privilégios restritos e credenciais apenas no servidor. Não usar o login `postgres` no runtime. RLS será defesa adicional, com políticas coerentes com o acesso pelo servidor; não presumir que o UID do OAuth corresponde ao ID do usuário local. Nenhuma tabela operacional será concedida a `anon` ou `authenticated` por padrão. Os testes deverão provar o bloqueio de acesso direto e a autorização dos endpoints, inclusive com tokens válidos sem a capacidade necessária.

O runtime serverless poderá usar o pooler em modo transacional, com pool pequeno, TLS e configuração compatível com o driver. Credenciais de migração e backup serão separadas das de runtime. A documentação atual recomenda esse modo para conexões curtas de funções serverless. [Conexão ao PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Dependências reais do núcleo

| Origem Firestore | Destino conceitual | Regra a preservar |
| --- | --- | --- |
| `salesOrders` e `itens` | Pedidos e itens | ID de origem, datas civis, situação, exclusão lógica e campos usados pelos consumidores |
| `stockUpdates` | Observações de estoque | Última observação válida por SKU; saldo físico desconhecido permanece nulo |
| `supplies`, `supplyCodes` | Insumos e unicidade por SKU | Cadastros legados, limites por SKU, códigos e identificação original |
| `inventoryMovements` | Movimentações | Saldo e movimento na mesma transação; histórico por insumo |
| `productionColumns`, `productionLots`, `productionLotItems` | Kanban, lotes e itens | Ordenação, vínculos de pedidos, numeração e limites de lote |
| `productionComments` | Comentários | Autor e autorização para editar/excluir |
| `operationsMetadata` referente a lotes | Contadores operacionais | Numeração anual sem repetição em concorrência |

Comentários, chaves de SKU e contadores devem existir no esquema definitivo mesmo que estejam vazios ou tenham pouca representatividade na medição. Os documentos de `users` usados para validar autores e responsáveis continuam no sistema de identidade atual. As transações de produção hoje leem esses usuários no Firestore: antes de portar gravações, registrar e testar o tratamento de desativação concorrente de usuários; não simular uma transação atômica entre Firestore e PostgreSQL.

Os demais módulos, documentos de credenciais e integrações de Mercado Livre ficam fora deste primeiro recorte. O Firestore só poderá ser desativado integralmente depois que seus consumidores restantes forem migrados.

## Entregas e critérios para avançar

| Etapa | Entrega | Critério de saída |
| --- | --- | --- |
| 1. Preparar a leitura | Repositório de vendas atrás das operações atuais; Firestore continua ativo | Contratos, autorização, paginação e resultados atuais preservados nos testes |
| 2. Modelar e importar | Schema SQL do núcleo, adaptadores de leitura, importador retomável e conferência | Reexecutar a carga não duplica dados; IDs, referências, totais e exclusões conferidos |
| 3. Validar leitura hospedada | Piloto de leitura com usuários restritos, comparações e métricas | Mesmos resultados e permissões; latência, dados desatualizados e tráfego medidos |
| 4. Adaptar gravações | Operações, sincronizações e webhooks apontáveis para uma única fonte | Concorrência, idempotência, recuperação de eventos e todas as entradas de escrita testadas |
| 5. Trocar a fonte | Procedimento de manutenção, conferência final e ativação coordenada | Escritores antigos bloqueados, divergência zero no corte e recuperação demonstrada |
| 6. Observar e consolidar | Leituras e gravações do núcleo no PostgreSQL, métricas e backup | Período de observação encerrado com critérios atendidos; consumidores restantes inventariados |

O primeiro plano executável está em [preparação da leitura](../plans/2026-09-12-operational-postgres-phase1.md). O plano da primeira entrega da etapa 2 está em [schema, importação e leitura local de vendas](../plans/2026-09-12-operational-postgres-phase2.md). Estoque e produção foram cobertos nesta entrega por preservação dos dados e vínculos; seus adaptadores de leitura e a agregação de demanda continuam pendentes dentro da etapa 2. As etapas 3 a 6 receberão seus planos técnicos depois de verificar os resultados e contratos anteriores.

## Conferência, atualização e troca de fonte

A carga deve preservar o caminho/ID Firestore como chave de origem, registrar versão de origem e progresso por coleção, rejeitar registros inválidos com relatório e usar upsert idempotente. Não presumir que todos os documentos tenham `updatedAt`. Comparar o conteúdo normalizado, referências, contagens e agregados por período, mantendo a distinção entre campo ausente, nulo e zero.

Na cópia de conferência, atualizações e exclusões posteriores à primeira carga precisam ser reconciliadas. Uma varredura paginada não é um snapshot transacional. A estratégia inicial é uma carga inicial e reconciliações controladas; não executar leituras duplas em todas as chamadas do MCP. Uma cópia ainda desatualizada não deve servir como fonte oficial de saldo ou produção.

Antes da troca: adaptar e enumerar todos os escritores, bloquear novas mutações do núcleo, esperar as já iniciadas, fazer a reconciliação final consistente, comparar os dados e só então ativar a nova fonte para leitores e escritores. Incluir webhooks, cron, sincronização manual, server actions e versões antigas do aplicativo. A entrada de webhooks deve persistir eventos numa fila durável antes de confirmar recebimento; durante a manutenção o processamento fica suspenso e os eventos são retomados de forma idempotente. Não depender apenas de um retry presumido do Bling.

Até a primeira gravação oficial em PostgreSQL, o retorno pode reativar a fonte Firestore após drenar as chamadas em trânsito. Depois que o PostgreSQL receber gravações oficiais, retornar exige bloquear mutações e reconciliar essas alterações de volta, incluindo exclusões e efeitos já enviados a integrações. Não tratar essa situação como simples mudança de variável de ambiente. A remoção de dados Firestore não faz parte do corte inicial.

Pontos de código já identificados: `src/services/order-service.ts`, `src/app/actions.ts`, `src/app/api/webhook/bling/route.ts` e `src/server/operations/{sales,stock,supplies,production,production-demand}.ts`. O inventário será fechado por busca de todas as referências às coleções acima e pela revisão das chamadas indiretas antes da etapa 4.

## Orçamento e recuperação

O espaço medido permite começar a implementação local. A viabilidade operacional do Free ainda depende do tráfego compartilhado e do backup. A sobra de 3,039 GB em 12/09 era do ciclo em andamento, não um orçamento mensal garantido.

Um cenário de planejamento soma 3,749 GB do ciclo anterior da organização, 0,865 GB de 30 dumps texto do núcleo e 0,520 GB dos dois resumos atualizados a cada minuto por cinco usuários: aproximadamente **5,13 GB**, acima dos 5 GB. Essa soma combina hipóteses e tamanhos de arquivo; não é uma previsão de fatura, mas mostra que armazenamento suficiente não garante adequação ao Free.

Antes da etapa 5, medir bytes reais das chamadas completas e do backup, incluir os demais projetos e registrar uma projeção de ciclo. Adotar inicialmente teto de planejamento de 4 GB de tráfego não cacheado compartilhado e 400 MB de banco por projeto, reservando 20% das quotas verificadas nas medições. Esses tetos são critérios propostos para esta migração, não limites do provedor. Se a projeção exceder o teto, ajustar consultas, cache e frequência de atualização, ou apresentar o custo de um plano pago. Não trocar plano automaticamente.

Backup do núcleo diário, criptografado fora do projeto de origem, é a proposta inicial a medir, com objetivo de perda máxima de 24 horas e recuperação em até 2 horas. Esses objetivos precisam ser aceitos para produção e comprovados em um ensaio; o teste anterior apenas provou a restauração do protótipo. Se a necessidade operacional exigir recuperação de alterações mais recentes, a estratégia de recuperação e o orçamento deverão ser revistos antes do corte. Retenção inicial proposta: sete cópias diárias e quatro semanais, reaproveitando a cópia diária para evitar download adicional do banco.

O cache deve ser segmentado por identidade/permissões e filtros, manter data de observação e nunca servir como base transacional de uma gravação. Invalidação após mutações e comportamento de indisponibilidade serão testados. Em erro de banco, retornar indisponibilidade; não representar falha como resultado vazio nem consultar o Bling silenciosamente no MCP.

## Validação exigida

- Equivalência de totais e regras dos dez cenários medidos, acrescentando empates, precisão monetária, datas, exclusão lógica, cursores antigos e referências legadas.
- Aplicação e MCP com administrador, vendedor, operador, usuário inativo e acesso revogado; projeções de produção sem campos comerciais restritos.
- Transações de saldo/movimento, unicidade de SKU, contador de lotes, entregas duplicadas e fora de ordem de webhooks.
- Falha no meio da carga, retomada, atualizações e exclusões entre passagens, corte e retorno após gravações.
- Backup restaurado com conteúdo e relações conferidos; medição hospedada com credencial de runtime e chamadas reais pelo servidor.

## Referências e limites deste documento

As medições não provaram RLS, escritas, sincronização contínua ou desempenho hospedado. Este roteiro não declara esses itens concluídos.

Verificados o changelog e a documentação Supabase em 12/09/2026. Novas tabelas não devem depender de grants implícitos da Data API; nossa proposta de acesso privado pelo servidor evita essa dependência. [Alteração de grants](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically), [proteção da API](https://supabase.com/docs/guides/api/securing-your-api).
