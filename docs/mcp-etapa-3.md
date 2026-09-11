# Etapa 3 — Serviços protegidos de vendas, estoque, insumos e produção

Implementação local na branch `codex/mcp-auth-foundation`, sobre a etapa 2 (`fef7a7b`). Esta etapa prepara os serviços compartilhados que serão usados pelo sistema web e pelo MCP. O endpoint MCP e a conexão do Claude são a etapa 4; escritas MCP com prévia e idempotência são a etapa 5.

## Comportamento entregue

- APIs web derivam identidade, papel e permissões atuais da sessão no servidor. Dados enviados pelo navegador não podem definir o autor nem ampliar suas capacidades. Usuários inativos, primeiro acesso pendente e módulos desativados são recusados.
- Serviços em `src/server/operations/` recebem `AccessContext` e argumentos validados. Listagens usam `{ data, source, asOf, warnings, nextCursor }`, com 50 registros por padrão e máximo de 100 por página.
- Vendas comparam períodos reais de igual duração. Base anterior zero retorna `change: null` com explicação. Lista, dashboard, curva ABC, recorrência e conciliação usam o acesso protegido. Conciliação mantém sua permissão própria de página, exclusivamente no adaptador web.
- Estoque preserva zero e mantém totais desconhecidos como `null`. Saldo de depósito não substitui o total do produto. Falha do Bling gera aviso explícito; observações anteriores ou de webhook continuam identificadas. Cache preserva a data original. Dados marcados como simulados são recusados.
- Produção recebe projeção de SKU, quantidade e dados operacionais, sem valores comerciais, dados de contato ou documentos fiscais. Cada saldo inclui `stockSource` e `stockAsOf`, separados da data da consulta de demanda.
- Cadastro de insumos valida SKU único e limites. Movimentações atualizam saldo e histórico numa transação, com autoria da sessão. Saída que resulta em saldo negativo gera aviso; exclusão de insumo com saldo ou histórico é recusada.
- Kanban valida coluna, pedido, SKU, quantidade e responsável. Autoria e dados dos itens vêm do servidor. Numeração do lote usa sequência transacional. Criação aceita até 400 itens; exclusão de lote limita os registros associados para respeitar o tamanho da transação.
- Telas, detalhes e relatórios consultam os serviços a cada 10 segundos enquanto visíveis, e após gravações. Resultados atrasados após desmontagem não são aplicados. Erros limpam os dados exibidos.

## Rotas

| Rota | Função |
| --- | --- |
| `/api/operations/sales` | Lista paginada e `view=summary` por período |
| `/api/operations/finance-orders` | Pedidos para a conciliação, com permissão da página financeira |
| `/api/operations/stock` | Saldos por SKU com origem e data |
| `/api/operations/supplies` | Cadastro, limites e movimentações de insumos |
| `/api/operations/production-demand` | Demanda mínima de produção e consulta individual de SKU |
| `/api/operations/production` | Colunas, lotes, itens, comentários e seleção operacional de pedidos |

Mutações HTTP exigem sessão e origem da aplicação. As ações antigas usadas pela interface foram preservadas como adaptadores protegidos quando necessário. O serviço de persistência de pedidos passou a ser interno ao servidor, sem exportar Server Actions de gravação sem autorização.

## Banco e integração Bling

As regras locais negam leitura e escrita direta, inclusive com um token Firebase contendo papel de administrador, nas coleções migradas: `salesOrders`, `supplies`, `inventoryMovements`, `productionColumns`, `productionLots`, `productionLotItems`, `productionComments` e `stockUpdates`. Também protegem `supplyCodes`, `operationsMetadata`, `webhookDebugLogs` e os documentos Bling/sincronização em `appConfig`.

O webhook e a sincronização passaram para Admin SDK para continuarem funcionando com essas regras. O webhook exige `BLING_WEBHOOK_SECRET` configurado e assinatura válida **antes de gravar qualquer evento**. Sem configuração retorna 503; sem assinatura ou com assinatura inválida retorna 401. O health check público não revela dados de pedidos. Logs de diagnóstico guardam metadados, sem copiar o payload completo.

A conexão existente com o Bling agora exige administrador e um `state` aleatório emitido pelo servidor, vinculado ao administrador em cookie HttpOnly de dez minutos e consumido no callback. O código de autorização não é registrado no log. Isso protege a persistência das credenciais usada pelos serviços migrados; é distinto do OAuth MCP da etapa 2.

Para um futuro deploy, configurar o segredo de webhook, criar os índices declarados em `firestore.indexes.json`, publicar os adaptadores de backend e então fechar as regras. As demais coleções legadas continuam fora do escopo desta etapa. Nenhuma regra, configuração ou credencial de produção foi alterada nesta execução.

## Evidências locais

| Verificação | Resultado |
| --- | --- |
| Serviços, autenticação, OAuth e regras | **94 testes passaram em 18 arquivos** (`npx vitest run`) |
| Compilação Next | **Passou** (`npm run build`) |
| TypeScript | **25 diagnósticos preexistentes; nenhum novo**, comparados sem números de linha com a referência anterior |
| Revisão independente | Três achados corrigidos; nova revisão aprovou comportamento e qualidade |
| Vendas no navegador | R$ 300, duas vendas e variação de 100% sobre R$ 150 |
| Estoque no navegador | SKU ZERO: total virtual 0, físico não informado, fonte webhook e aviso de indisponibilidade do Bling |
| Insumos no navegador | Cadastro de TESTE-LOCAL, entrada de 12 unidades, saldo 12 e valor R$ 24 |
| Produção no navegador | Dois pedidos, seis unidades; saldo 0 com origem/data do webhook |
| Kanban no navegador | Lote criado com item de pedido, movido de Fila para Em Produção, posição mantida após recarregar e comentário salvo |
| Persistência real no emulador | Movimento e lote atribuídos a `fixture-admin`; lote persistido em `default-1` |
| Console do navegador | Nenhum erro registrado na inspeção final |

Os testes usam Firestore Emulator real, projeto `demo-brsteel-auth`, e respostas sintéticas do adaptador Bling. A execução não consultou o Bling real, não alterou seu estoque e não publicou endpoint público. A marca `FIRESTORE_EMULATOR_HOST` impede chamadas externas do adaptador Bling nesse ambiente. As verificações do provedor Supabase real continuam documentadas na etapa 2; esta etapa executa suas regressões automatizadas.

## Reproduzir

Com Node 22, Java e dependências instaladas, iniciar o Firestore Emulator local com `firebase.test.json`, porta 8188 e projeto `demo-brsteel-auth`. Executar:

```sh
npx vitest run
npm run build
npm run typecheck
```

Para verificar as telas, usar um checkout isolado com `.env.local` apontando exclusivamente para o emulador, `AUTH_SESSION_SECRET` próprio de teste e origem local da aplicação. Preparar dados e iniciar Next:

```sh
node --env-file=.env.local scripts/seed-operations-local.cjs
npm run dev
```

O script de fixtures recusa qualquer host/projeto diferente do emulador dedicado e limpa apenas esse banco de teste. Cria `admin@example.test`, `seller@example.test` e `operator@example.test`, com senha exclusivamente sintética `Local-test-only-2026`. Não executar junto dos testes: ambos usam o mesmo banco descartável.

A aba temporária e o servidor Next foram encerrados. Os dados sintéticos remanescentes foram removidos do emulador dedicado e o Firestore Emulator foi encerrado. A branch e o worktree ficam preservados para a próxima etapa.
