# Leituras operacionais PostgreSQL — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans, preservando o checkout isolado e os limites abaixo. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Concluir os adaptadores candidatos de leitura de estoque, insumos e produção, incluindo agregação SQL da demanda, com equivalência local ao Firestore.

**Architecture:** Repositórios internos preservam os contratos e a autorização nas operações. O Firestore permanece selecionado. A importação cria projeções determinísticas de estoque e chaves de limites; consultas SQL escolhem a última observação válida e agregam somente os itens faturados. Toda leitura SQL usa a mesma transação de cópia pronta da etapa anterior.

**Tech Stack:** Node 22, TypeScript, PostgreSQL 17, pg 8.23.0, Firestore Emulator, Vitest e Node Test Runner.

**Spec:** `docs/superpowers/specs/2026-09-12-operational-postgres-design.md`.

## Global Constraints

- Manter o login do sistema, o OAuth do MCP e a aplicação na Vercel.
- O Firestore permanece como fonte principal até que todas as entradas de escrita do núcleo tenham sido adaptadas e verificadas.
- A mudança de banco não concede permissões nem habilita escrita pelo Claude.
- Execução somente local, dados sintéticos e credenciais de demonstração. Sem push, merge, deploy ou importação hospedada.
- Base `4ac9062`; branch `codex/operational-postgres-readers`, checkout `/private/tmp/br-steel-postgres-phase1`.

## Task 1: Contratos e projeções de estoque

Arquivos: `src/server/persistence/stored-stock-model.ts`, `stock-contract.ts`, `firestore-stock.ts`, `postgres-stock.ts`, `stock.ts`; `src/server/migration/operational-import.ts`; `supabase/operational/migrations/20260912170838_operational_read_models.sql`; operações de estoque.

- [x] Caracterizar zero, saldo inválido, data inválida, dados simulados, SKU alternativo, empate de datas e ordenação de SKU. Teste de regressão mínimo:
  ```ts
  expect(normalizeStoredStockObservation('A', { estoqueAtual: 0, webhookReceivedAt: '2026-09-01T00:00:00Z' })?.stock.saldoFisicoTotal).toBeNull();
  ```
- [x] Extrair normalização pura do saldo persistido. Gerar no importador projeção mínima, instante numérico conforme `Date.parse` e ordem do SKU conforme `localeCompare`, preservando desempate por primeiro documento da origem. Não reinterpretar datas legadas no PostgreSQL.
- [x] Adicionar colunas de projeção e índice para SKU/data/ID. Invalidar cópia antiga e reiniciar seu checkpoint para reconstruir projeções pelo mesmo snapshot; não deixar cópia antiga aparecer pronta.
- [x] Conferir projeções relidas e chaves de limites junto ao payload original em `verifySnapshot`.
- [x] Contrato `StockReadRepository`: `snapshot()` e `list({limit,cursor?,sku?})`. SQL aplica seleção da observação mais recente, filtro e paginação; cursores de offset e avisos atuais permanecem válidos. O export ativo mantém Firestore.

## Task 2: Produção e insumos

Arquivos: contratos, projeções e repositórios `production-*`, `firestore-production.ts`, `postgres-production.ts`, `supplies-*`, `firestore-supplies.ts`, `postgres-supplies.ts`; operações `production.ts`, `supplies.ts`.

- [x] Extrair contratos das leituras existentes, mantendo os exports públicos e as verificações de capacidade/página antes do acesso ao repositório.
- [x] Implementar listagens SQL de colunas, lotes, itens, comentários e pedidos, com chave de documento, filtros por lote e cursores base64 atuais. Detalhe de lote e seus itens usam uma única transação consistente. Pedido de produção mantém continuação por offset dos itens.
- [x] Reutilizar uma projeção por lista permitida de campos, incluindo identidades aninhadas; nunca retornar contato, XML, preços ou nomes comerciais de clientes nas consultas de produção.
- [x] Implementar listagem de insumos e movimentos. A página de insumos avança pelos documentos examinados, mesmo quando registros sem nome são omitidos. Movimento sem datas mantém cursor por ID; com datas mantém intervalo civil de São Paulo e cursor `(createdAt,id)`.
- [x] Caracterizar com testes puros as projeções privadas e com integração os cursores e datas; sem alteração nas operações de gravação.

## Task 3: Demanda SQL e validação conjunta

Arquivos: `production-demand-contract.ts`, `firestore-production-demand.ts`, `postgres-production-demand.ts`, `production-demand.ts`; `tests/postgres/operational-readers.integration.ts`; script local e evidências.

- [x] Extrair contrato `ProductionDemandReadRepository.read({from,to})` para demanda baseada no banco. A aplicação web mantém sua consulta live/cache existente, e o MCP usa o repositório Firestore selecionado nesta etapa.
- [x] Agregar no SQL apenas pedidos com `notaFiscal.id` truthy e itens com SKU truthy e quantidade numérica positiva. Preservar IDs distintos de pedido, descrição da primeira ocorrência, ordem dos empates e cálculo por semanas inclusivas.
- [x] Juntar última observação válida e último cadastro de limites por SKU dentro da mesma transação. Ausências permanecem nulas/indisponíveis; zero permanece zero. Retornar somente a projeção de demanda.
- [x] Exportar a base sintética do emulador e comparar as respostas de Firestore e PostgreSQL, exceto marcadores de origem e instantes de emissão. Exemplo de equivalência:
  ```ts
  assert.deepEqual(normalizeOrigin(await sql.read(range)), normalizeOrigin(await firestore.read(range)));
  ```
- [x] Comprovar indisponibilidade da cópia parcial, atualização/exclusão de observações, conteúdo mínimo da resposta e autorização antes da chamada ao repositório.
- [x] Rodar a integração em PostgreSQL descartável, advisors locais, suíte existente, typecheck comparado aos 25 diagnósticos anteriores e build. Revisar o diff e registrar evidência e commit locais.

## Decisões de implementação

A projeção de estoque é calculada durante importação para manter exatamente as regras JavaScript legadas de datas, coerção de SKU e ordenação. Consultas retornam apenas os saldos escolhidos e paginados. A conferência independente verifica também essa projeção; hashes do payload original não bastam.

A revisão identificou que um `Timestamp` nativo pode alterar a elegibilidade ou precisão de uma leitura quando convertido em texto. A exportação passa a rejeitar esses tipos nos campos que afetam leitores; a origem deverá ser normalizada explicitamente. Snapshots antigos não registravam tipos e precisam ser reexportados antes do piloto. Não se presume equivalência apenas por conferir o JSON já normalizado.

As políticas SQL continuam voltadas ao backend e não concedem permissões individuais. A autorização pertence às operações; repositórios são internos. O piloto hospedado, os testes de endpoints contra banco hospedado, a medição com dados reais e todas as gravações de negócio continuam fora desta entrega.

## Resultado

Adaptadores locais implementados e revisados. A suíte passou com 189 testes e a integração com 16. Build gerado; typecheck mantém os mesmos 25 diagnósticos anteriores. Evidência: `docs/evidence/operational-postgres-readers.md`. O piloto exige nova exportação validada e avaliação dos legados identificados; nenhum seletor de produção foi alterado.
