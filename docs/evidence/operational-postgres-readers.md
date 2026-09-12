# Leituras operacionais PostgreSQL — evidência de 12/09/2026

Esta entrega conclui os adaptadores candidatos de leitura de estoque, insumos, movimentos, produção e demanda em PostgreSQL. Vendas já estava implementada. Os repositórios ativos continuam usando Firestore; os candidatos SQL foram exercitados apenas no ensaio local.

Branch: `codex/operational-postgres-readers`, baseada em `4ac9062`. Checkout: `/private/tmp/br-steel-postgres-phase1`. Plano: [leituras operacionais](../superpowers/plans/2026-09-12-operational-postgres-readers.md).

## O que foi implementado

Estoque passa a ter uma projeção mínima conferida na importação. Ela preserva as regras existentes de saldo válido, exclusão de dados simulados, coerção de SKU, instante da observação e ordenação. O SQL escolhe a observação mais recente, mantém o desempate por documento da origem e aplica filtro/paginação. Saldo físico desconhecido permanece nulo; saldo virtual zero permanece zero. O horário agregado e os avisos são preservados.

Produção tem listagens por documento de colunas, lotes, itens, comentários e pedidos, além de detalhes e continuação de itens. A projeção SQL limita os campos antes de devolvê-los ao servidor e restringe identidades aninhadas. Contato, documento fiscal, XML, preços e nomes de clientes não entram nas respostas de produção. Lote e itens são lidos na mesma transação consistente.

Insumos mantém a paginação por documentos examinados, inclusive páginas vazias após omitir registros sem nome. Movimentos preservam o cursor por ID quando não há datas, e intervalo civil de São Paulo com cursor por data/ID quando há. O contrato existente de insumos/movimentos mantém seus campos legados.

A demanda agrega no SQL itens válidos de pedidos faturados, soma quantidades e conta IDs de negócio distintos. Preserva a descrição da primeira ocorrência e a ordem dos empates. Saldo e limites são obtidos na mesma transação; o cálculo por semanas inclusivas mantém as fórmulas atuais. A consulta devolve somente a projeção operacional.

As operações verificam usuário ativo, capacidade e página antes do acesso ao repositório. Os testes usam os adaptadores SQL através dessas mesmas verificações. As implementações de gravação de produção e insumos foram comparadas ao commit base e permanecem idênticas. A aplicação web mantém o comportamento live/cache existente; o MCP mantém a leitura apenas do banco selecionado.

## Validação

| Verificação | Resultado |
| --- | --- |
| Integração PostgreSQL + Firestore + CLI | 16 testes, sem falhas |
| Suíte Vitest completa | 189 testes, 34 arquivos, sem falhas |
| Build Next.js com configuração de demonstração | Exit 0 |
| TypeScript | Mesmos 25 diagnósticos preexistentes; sem novos |
| Catálogo SQL | 13 tabelas com RLS, 18 chaves estrangeiras, 25 índices |
| Supabase CLI advisors local, tipos security/performance, mínimo warn | Nenhum aviso ou erro retornado |

O build já ignora lint e validação de tipos na configuração existente; seu resultado não representa typecheck limpo. O typecheck foi executado separadamente e comparado à etapa anterior.

O ensaio usa 31 documentos sintéticos no conjunto das novas leituras e 12 no conjunto anterior de importação/vendas. Cada conjunto limpa apenas seus bancos de teste, sem depender da ordem de execução. O primeiro ensaio revelou interferência entre os conjuntos; o isolamento foi corrigido antes das execuções válidas.

Foram comparados dados, avisos e cursores dos repositórios Firestore e SQL. Apenas os marcadores de origem e o instante de emissão da resposta diferem por definição; os horários de observação do estoque foram comparados explicitamente. A cobertura inclui empates de datas e SKU, paginação, limite zero, falta de estoque, período vazio, semanas inclusivas, IDs comerciais repetidos, movimentação sem data, empates de movimentação e limites do dia de São Paulo.

A carga parcial é recusada pelos quatro novos leitores. A conferência detecta alteração manual da projeção de saldo. Uma nova versão da observação atualiza o resultado; a remoção de observações num snapshot completo retira os saldos das consultas. O ensaio também verifica que a nova migration invalida uma cópia anterior e reinicia o checkpoint para reconstruir as projeções.

## Revisão e tratamento de legados

A revisão encontrou perda de informação de tipo ao converter `Timestamp` Firestore em texto: um saldo antes ignorado poderia se tornar elegível, um movimento poderia entrar num filtro de datas e a precisão devolvida poderia mudar. Foi adicionada uma validação antes da conversão. Os testes puros reproduziram cinco falhas antes da correção e passaram depois; o emulador também demonstrou a diferença de elegibilidade e a rejeição pela exportação. A revisão final não deixou achados pendentes para novas exportações neste escopo.

Os escritores inspecionados usam texto ISO. Registros legados com tipos nativos nos campos afetados precisam de normalização explícita antes da exportação. Metadados de estoque não usados nas respostas ainda preservam timestamps precisos. **Snapshots JSON antigos não comprovam equivalência de tipos: antes do piloto hospedado, é obrigatória uma nova exportação validada da origem.**

## Reprodução e próximos passos

```sh
BRSTEEL_PG_ADVISORS=1 npm run test:postgres
PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json 'npx --no-install vitest run'
npm run typecheck
```

O build usou `npm run build` com projeto de demonstração, emulador em loopback e segredo fictício de sessão. Não foram copiadas credenciais de produção. O harness inicializa PostgreSQL 17.6 descartável em imagem Supabase, aplica somente migrations operacionais locais e remove contêiner/volume e configuração temporária de advisors. Não simula todos os serviços da plataforma hospedada.

As migrations operacionais continuam separadas da cadeia OAuth. A reconstrução de uma cópia local anterior usa o mesmo snapshot, mas isso não substitui a nova validação de origem exigida para o piloto. Detalhes do contrato estão em [supabase/operational/README.md](../../supabase/operational/README.md); comandos e hashes estão no [registro estruturado](operational-postgres-readers.json).

Não houve push, merge, deploy, mudança de plano, alteração de dados hospedados ou ativação SQL no sistema. O próximo trabalho é preparar o piloto de leitura com origem validada, credencial restrita, permissões nos endpoints e medições reais de armazenamento, tráfego e latência. As projeções adicionam espaço: os números do protótipo anterior não comprovam a capacidade deste schema no plano gratuito. Gravações, sincronizações, backup e troca coordenada da fonte continuam nas etapas seguintes do roteiro.

Referências SQL usadas na implementação: [seleção determinística com DISTINCT ON](https://www.postgresql.org/docs/17/queries-select-lists.html) e [funções de janela](https://www.postgresql.org/docs/17/functions-window.html).
