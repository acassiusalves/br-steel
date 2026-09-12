# Gravações do núcleo em PostgreSQL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans para implementar tarefa a tarefa e superpowers:requesting-code-review antes de qualquer publicação. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portar todas as entradas de escrita do núcleo para adaptadores PostgreSQL atrás da fronteira de operações existente, com transação única, idempotência e auditoria, mantendo o Firestore selecionado em produção.

**Architecture:** Cada domínio ganha contrato de escrita, adaptador Firestore (extração do código atual, sem mudança de comportamento) e adaptador PostgreSQL, no mesmo formato já usado pelas leituras das etapas 1–3. Um seletor por domínio escolhe a implementação; o padrão continua Firestore. As operações preservam autorização, validação Zod e envelope `result`. A ingestão de webhook passa a persistir o evento numa fila durável antes de confirmar recebimento, e o processamento fica separado da confirmação HTTP.

**Tech Stack:** Next.js 15, Node.js 22, TypeScript, Zod, Firebase Admin, `pg` 8.23.0, PostgreSQL 17, Vitest, Node Test Runner, Firestore Emulator, Docker.

**Spec:** `docs/superpowers/specs/2026-09-12-operational-postgres-design.md`, etapa 4.

## Global Constraints

- Manter o login do sistema, o OAuth do MCP e a aplicação na Vercel.
- O Firestore permanece como fonte principal até que todas as entradas de escrita do núcleo tenham sido adaptadas e verificadas. **Esta entrega não troca a fonte**; o seletor ativo continua Firestore em todos os ambientes.
- A mudança de banco não concede permissões nem habilita escrita pelo Claude. `MCP_WRITES_ENABLED=false` permanece o padrão e nenhuma ferramenta MCP de escrita é publicada.
- Não representar falha como resultado vazio nem consultar o Bling silenciosamente no MCP. Em erro de banco, retornar indisponibilidade.
- **Não simular uma transação atômica entre Firestore e PostgreSQL.** Onde a transação atual lê `users` do Firestore, a identidade deve ser resolvida antes da transação SQL e revalidada dentro dela contra dados já portados, ou a operação deve recusar explicitamente.
- Idempotência: 24 horas. Auditoria: 90 dias. Limpeza por TTL.
- Datas civis em `America/Sao_Paulo`; timestamps em ISO UTC.
- Consultas: padrão 50, máximo 100 registros; corpo 64 KiB; saída 256 KiB.
- Execução local com dados sintéticos, emulador Firestore e PostgreSQL descartável. Sem push para produção, deploy, importação hospedada ou alteração de OAuth.
- Base: `codex/operational-postgres-readers` já rebaseada sobre `main` (contém `cf12409`). Typecheck mantém exatamente 25 diagnósticos preexistentes; a suíte parte de 245 testes vitest e 19 de integração PostgreSQL.

## Inventário fechado de escritores

A spec exigia fechar este inventário antes da etapa 4. Busca por referências às dez coleções do núcleo em `src/` e `scripts/`:

| Escritor | Coleções | Mecanismo atual | Operações |
| --- | --- | --- | ---: |
| `src/server/operations/supplies.ts` | `supplies`, `supplyCodes`, `inventoryMovements` | `adminDb.runTransaction` | 5 |
| `src/server/operations/production.ts` | `productionColumns`, `productionLots`, `productionLotItems`, `productionComments`, `operationsMetadata` | `adminDb.runTransaction` | 12 |
| `src/app/api/webhook/bling/route.ts` | `stockUpdates`, `salesOrders` | `.set({merge:true})` direto + `saveSalesOrders` | 2 caminhos |
| `src/services/order-service.ts` | `salesOrders` | `adminDb.batch()` de 500 | 2 funções |
| `src/app/actions.ts` | `salesOrders` (indireto) | chama `order-service` | sincronização manual |

Os três crons de `vercel.json` (`ml-health`, `ml-messages-drain`, `ml-messages-backfill`) não tocam o núcleo. `src/server/operations/stock.ts` não grava: a única mutação é `Map.set` em memória. Os scripts de migração e prova gravam apenas em ambiente descartável e ficam fora do corte.

**Total a portar: 19 operações de escrita em 4 arquivos.** O cache de leitura de estoque (`src/server/operations/stock.ts:10`) também precisa mudar: ver Task 5.

## Mapa dos arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| Criar `supabase/operational/migrations/*_operational_writer_role.sql` | Papel `brsteel_ops_writer`, grants e políticas RLS de escrita |
| Criar `src/server/persistence/postgres-write.ts` | `withOperationalWrite`, transação serializable read-write e retry de `40001` |
| Criar `src/server/persistence/write-audit.ts` | Registro de auditoria e chave de idempotência na mesma transação |
| Criar `src/server/persistence/supplies-write-contract.ts` | Contrato de escrita de insumos |
| Criar `src/server/persistence/firestore-supplies-write.ts` | Extração do código atual de `operations/supplies.ts` |
| Criar `src/server/persistence/postgres-supplies-write.ts` | Adaptador SQL de insumos |
| Criar `src/server/persistence/supplies-write.ts` | Seletor, fixo em Firestore |
| Criar `src/server/persistence/production-write-contract.ts` | Contrato de escrita de produção |
| Criar `src/server/persistence/firestore-production-write.ts` | Extração do código atual de `operations/production.ts` |
| Criar `src/server/persistence/postgres-production-write.ts` | Adaptador SQL de produção |
| Criar `src/server/persistence/production-write.ts` | Seletor, fixo em Firestore |
| Criar `src/server/persistence/sales-ingest-contract.ts` | Contrato de ingestão de vendas e estoque |
| Criar `src/server/persistence/firestore-sales-ingest.ts` | Extração de `order-service.ts` e das escritas do webhook |
| Criar `src/server/persistence/postgres-sales-ingest.ts` | Upsert versionado em SQL |
| Criar `src/server/ingest/webhook-queue.ts` | Fila durável de eventos, enfileirar e drenar |
| Modificar `src/server/operations/supplies.ts` | Preservar API pública; delegar escrita |
| Modificar `src/server/operations/production.ts` | Preservar API pública; delegar escrita |
| Modificar `src/app/api/webhook/bling/route.ts` | Persistir evento antes de confirmar; processar pela fila |
| Modificar `src/services/order-service.ts` | Delegar persistência ao contrato de ingestão |
| Ler `src/server/persistence/postgres-read.ts` | Padrão de transação e verificação de cópia pronta |
| Ler `src/server/operations/common.ts` | `OperationError`, `result`, `serialize`, schemas compartilhados |

---

## Task 1: Fundação de escrita

**Files:**
- Create: `supabase/operational/migrations/<gerada pelo CLI>_operational_writer_role.sql`
- Create: `src/server/persistence/postgres-write.ts`, `src/server/persistence/write-audit.ts`
- Test: `tests/postgres/operational-write.integration.ts`

**Interfaces:**
- Consome `brsteel_import.state` e as 13 tabelas de `brsteel_ops` das etapas 2–3.
- Produz `withOperationalWrite(pool, run)` e `recordWriteAudit(client, entry)`, usados por todas as tarefas seguintes.

```ts
export type WriteAuditEntry = {
  operation: string;            // 'supplies.recordMovement'
  userId: string;
  source: 'web' | 'mcp';
  clientId: string | null;
  idempotencyKey: string | null;
  target: { collection: string; id: string };
};
export function withOperationalWrite<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T>;
export function recordWriteAudit(client: PoolClient, entry: WriteAuditEntry): Promise<void>;
```

- [ ] **Passo 1 — Teste vermelho do papel.** Em `tests/postgres/operational-write.integration.ts`, provar que `brsteel_ops_writer` ainda não existe e que `brsteel_ops_reader` não consegue gravar. Rodar `npm run test:postgres` e confirmar falha real, não erro de conexão.
- [ ] **Passo 2 — Migration do papel.** Gerar com `supabase migration new operational_writer_role` e mover para `supabase/operational/migrations/`. Criar `brsteel_ops_writer` NOLOGIN, INHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS. Conceder `SELECT, INSERT, UPDATE, DELETE` nas 13 tabelas de `brsteel_ops` e política `writer_rw` `FOR ALL TO brsteel_ops_writer USING (true) WITH CHECK (true)`. **Não** conceder nada em `brsteel_import` além de `SELECT` em `state`. Nenhuma concessão a `anon`, `authenticated` ou `PUBLIC`; nenhuma associação entre `brsteel_ops_writer` e os papéis de leitura, importação ou backup.
- [ ] **Passo 3 — Tabelas de auditoria e idempotência.** Na mesma migration, criar `brsteel_ops.write_audit` (id, operation, user_id, source, client_id, target_collection, target_id, created_at) e `brsteel_ops.write_idempotency` (key primary key, operation, user_id, response jsonb, created_at, expires_at). Índice por `created_at` nas duas. `expires_at` default `now() + interval '24 hours'`; `write_audit.created_at` retido por 90 dias, limpeza por job da etapa 6 — esta entrega apenas cria as colunas.
- [ ] **Passo 4 — Helper de transação.** Implementar `withOperationalWrite` em `postgres-write.ts`, espelhando `withOperationalSnapshot` mas com `begin isolation level serializable`. Conferir `brsteel_import.state.ready` e a origem antes de qualquer mutação; abortar com erro de indisponibilidade se a cópia não estiver pronta. Repetir automaticamente no máximo 3 vezes em `40001` (serialization failure) e `40P01` (deadlock); qualquer outro erro sobe sem retry. Nunca imprimir payload ou credencial em mensagem de erro.
- [ ] **Passo 5 — Auditoria e idempotência.** Implementar `recordWriteAudit` gravando na mesma transação do efeito. Implementar a checagem de chave de idempotência: chave repetida com o mesmo `operation` e `user_id` devolve a resposta anterior; chave repetida com payload diferente levanta `OperationError('IDEMPOTENCY_CONFLICT', …, 409)`. O ID do evento de auditoria deriva de `operation + target`, para que uma repetição não duplique registro.
- [ ] **Passo 6 — Testes de integração.** Provar: escrita pelo papel escritor funciona; leitor recebe `42501` ao gravar; escritor recebe `42501` ao gravar em `brsteel_import`; cópia não pronta bloqueia a transação inteira; falha no `recordWriteAudit` aborta o efeito; duas transações concorrentes na mesma linha resolvem com exatamente um vencedor e o perdedor repete; chave de idempotência repetida devolve a resposta anterior sem segundo efeito.
- [ ] **Passo 7 — Verificar e commitar.** Rodar `npm run test:postgres` e `npm run typecheck` (esperado: 25 diagnósticos, nenhum novo). Commit local `feat(postgres): add operational write foundation`.

---

## Task 2: Gravações de insumos e movimentações

**Files:**
- Create: `src/server/persistence/supplies-write-contract.ts`, `firestore-supplies-write.ts`, `postgres-supplies-write.ts`, `supplies-write.ts`
- Modify: `src/server/operations/supplies.ts`
- Test: `tests/operations/supplies-write-boundary.test.ts`, `tests/postgres/operational-write.integration.ts`

**Interfaces:**
- Consome `withOperationalWrite` e `recordWriteAudit` da Task 1.
- Produz:

```ts
export interface SuppliesWriteRepository {
  create(input: SupplyFields, actor: WriteActor): Promise<OperationResult<{ id: string }>>;
  update(id: string, input: Partial<SupplyFields>, actor: WriteActor): Promise<OperationResult<{ id: string }>>;
  remove(id: string, actor: WriteActor): Promise<OperationResult<{ id: string }>>;
  recordMovement(input: MovementInput, actor: WriteActor): Promise<OperationResult<{ id: string; newStock: number }>>;
}
export type WriteActor = { userId: string; source: 'web' | 'mcp'; clientId: string | null; idempotencyKey: string | null };
```

`updateSupplyLimits` continua em `operations/supplies.ts`: resolve o SKU e delega a `update`, porque a regra de duplicidade é de operação, não de persistência.

- [ ] **Passo 1 — Caracterizar antes de extrair.** Criar `tests/operations/supplies-write-boundary.test.ts` provando, no comportamento atual: `createSupply` nega antes de tocar a persistência quando falta `insumos:write`; SKU duplicado devolve `DUPLICATE_SKU` 409; `estoqueMinimo > estoqueMaximo` devolve `INVALID_LIMITS`; `deleteSupplyRecord` recusa com saldo ou histórico (`SUPPLY_IN_USE` 409); `recordMovement` com saldo cadastrado não numérico devolve `INVALID_BALANCE`; saldo negativo é permitido e vem com aviso. Rodar sob emulador e confirmar que passam no código atual.
- [ ] **Passo 2 — Extrair o contrato e o adaptador Firestore.** Mover os corpos de `createSupply`, `updateSupplyRecord`, `deleteSupplyRecord` e `recordMovement` para `firestore-supplies-write.ts`, preservando exatamente `keyRef` (SHA-256 do SKU), as mensagens, os códigos de erro e o envelope `result`. `operations/supplies.ts` mantém a autorização, o parse Zod e `validateLimits`, e passa a delegar. Criar `supplies-write.ts` exportando o Firestore como implementação ativa.
- [ ] **Passo 3 — Rodar o teste da etapa 1 e os existentes.** Esperado: todos passam sem alteração de comportamento. Confirmar com `rg -n 'adminDb|runTransaction' src/server/operations/supplies.ts` que a persistência saiu do arquivo de operação.
- [ ] **Passo 4 — Teste vermelho do adaptador SQL.** Em `tests/postgres/operational-write.integration.ts`, escrever os casos contra `createPostgresSuppliesWriteRepository(pool)`, ainda inexistente: saldo e movimento gravados na mesma transação; interrupção entre os dois não deixa movimento órfão; unicidade de SKU via `supply_codes`; troca de SKU remove a chave antiga e cria a nova atomicamente; exclusão recusada com histórico; `balanceAfter` coerente com o saldo final.
- [ ] **Passo 5 — Implementar o adaptador SQL.** `postgres-supplies-write.ts` usa `withOperationalWrite`. Unicidade por `insert` em `brsteel_ops.supply_codes` com `on conflict do nothing` e verificação do número de linhas — não por leitura prévia, que não protege sob concorrência. O saldo é lido com `select ... for update` na linha do insumo. Preservar a distinção entre campo ausente, nulo e zero: saldo zero continua zero e nunca vira nulo.
- [ ] **Passo 6 — Concorrência.** Provar que duas `recordMovement` simultâneas no mesmo insumo produzem exatamente dois movimentos e um saldo final correto, sem perda de atualização; e que duas `createSupply` simultâneas com o mesmo SKU resultam em exatamente um sucesso e um `DUPLICATE_SKU`.
- [ ] **Passo 7 — Equivalência entre adaptadores.** Rodar a mesma bateria contra os dois adaptadores e comparar respostas, ignorando apenas `source` e `asOf`. Diferença de mensagem, código ou arredondamento é falha.
- [ ] **Passo 8 — Verificar e commitar.** `npm run test:postgres`, suíte vitest sob emulador, typecheck. Commit `feat(postgres): add supplies write adapters`.

---

## Task 3: Gravações de produção

**Files:**
- Create: `src/server/persistence/production-write-contract.ts`, `firestore-production-write.ts`, `postgres-production-write.ts`, `production-write.ts`
- Modify: `src/server/operations/production.ts`
- Test: `tests/operations/production-write-boundary.test.ts`, `tests/postgres/operational-write.integration.ts`

**Interfaces:**
- Consome `withOperationalWrite`, `recordWriteAudit` (Task 1) e `WriteActor` (Task 2).
- Produz `ProductionWriteRepository` com os doze métodos correspondentes às operações atuais: `createColumn`, `updateColumn`, `deleteColumn`, `reorderColumns`, `seedDefaultColumns`, `createLot`, `updateLot`, `reorderLotsInColumn`, `deleteLot`, `createComment`, `updateComment`, `deleteComment`.
- Produz `resolveWriteIdentity(userId): Promise<{ userId: string; userName: string }>` em `operations/production.ts`, fora da transação de persistência.

- [ ] **Passo 1 — Resolver a identidade antes da transação.** A função `identity(tx, userId)` hoje lê `users` dentro da transação Firestore. `users` **não** foi portado e continua no sistema de identidade. Extrair `resolveWriteIdentity` para `operations/production.ts`, executada **antes** de chamar o repositório, mantendo as mesmas recusas: usuário inexistente, `active === false`, `mustChangePassword === true` ou papel fora de `['Administrador','Operador']` levantam `INVALID_USER` 400. O repositório recebe a identidade já resolvida e **não** consulta `users`. Documentar explicitamente no arquivo que isso abre uma janela entre a validação e o commit, e que a desativação concorrente de um usuário pode permitir uma gravação já autorizada — comportamento aceito e registrado, nunca uma atomicidade simulada entre bancos.
- [ ] **Passo 2 — Caracterizar antes de extrair.** Criar `tests/operations/production-write-boundary.test.ts` provando no código atual: criação de lote com SKU que não pertence ao pedido devolve `INVALID_ITEM`; quantidade acima do pedido devolve `INVALID_QUANTITY`; mais de 400 itens devolve `TOO_LARGE` 413; `deleteColumn` com lote associado devolve `COLUMN_NOT_EMPTY`; `deleteLot` com mais de 498 registros associados devolve `TOO_LARGE`; comentário só é alterado pelo autor ou por Administrador (`FORBIDDEN` 403); `reorderLotsInColumn` recusa lote de outra coluna com `INVALID_COLUMN`.
- [ ] **Passo 3 — Extrair para o adaptador Firestore.** Mover os doze corpos para `firestore-production-write.ts`, preservando a numeração `LOT-AAAA-NNNN`, o bootstrap do contador a partir dos lotes existentes, o `tx.update(column, …)` que serializa criações concorrentes na coluna, os limites de 400 itens e 498 registros associados, e todas as mensagens. Criar `production-write.ts` fixo em Firestore. Rodar a bateria da etapa 2: comportamento idêntico.
- [ ] **Passo 4 — Teste vermelho do contador anual.** Contra `createPostgresProductionWriteRepository(pool)`: dois criadores concorrentes no mesmo ano produzem números distintos e consecutivos, sem repetição; a numeração reinicia por ano; o bootstrap a partir de lotes legados existentes não colide com o contador.
- [ ] **Passo 5 — Implementar o adaptador SQL.** Usar `brsteel_ops.production_counters` com `insert ... on conflict (year) do update set sequence = production_counters.sequence + 1 returning sequence`, que serializa sem leitura prévia. Itens do lote criados e excluídos no mesmo commit do lote. `deleteLot` remove itens e comentários na mesma transação, preservando o limite de 498. A ordenação das colunas e dos lotes usa as mesmas chaves de desempate da leitura da etapa 2.
- [ ] **Passo 6 — Projeção e vínculos.** Provar que nenhuma consulta de produção retorna contato, XML, preços ou nomes comerciais de clientes, inclusive nas respostas de escrita. `customerName` permanece string vazia, como hoje. Referências a pedidos inexistentes são recusadas, não corrigidas silenciosamente.
- [ ] **Passo 7 — Equivalência e concorrência.** Rodar a bateria completa contra os dois adaptadores e comparar, ignorando `source` e `asOf`. Provar dois `createLot` simultâneos na mesma coluna, duas reordenações concorrentes e exclusão concorrente de coluna e lote.
- [ ] **Passo 8 — Verificar e commitar.** `npm run test:postgres`, vitest sob emulador, typecheck. Commit `feat(postgres): add production write adapters`.

---

## Task 4: Ingestão de vendas e estoque com fila durável

**Files:**
- Create: `src/server/ingest/webhook-queue.ts`, `src/server/persistence/sales-ingest-contract.ts`, `firestore-sales-ingest.ts`, `postgres-sales-ingest.ts`
- Modify: `src/app/api/webhook/bling/route.ts`, `src/services/order-service.ts`
- Test: `tests/operations/webhook-queue.test.ts`, `tests/postgres/operational-write.integration.ts`

**Interfaces:**
- Consome `withOperationalWrite` (Task 1).
- Produz:

```ts
export interface SalesIngestRepository {
  upsertOrders(orders: SourceOrder[]): Promise<{ created: number; updated: number }>;
  applyStockObservation(sku: string, observation: StockObservation): Promise<void>;
  markOrderDeleted(orderId: string, at: string): Promise<void>;
}
export type QueuedEvent = { id: string; topic: 'order' | 'stock'; payload: unknown; receivedAt: string;
  status: 'received' | 'processing' | 'processed' | 'failed' | 'ignored'; attempts: number };
export function enqueueWebhookEvent(event: Omit<QueuedEvent,'status'|'attempts'>): Promise<void>;
export function drainWebhookEvents(limit: number): Promise<{ processed: number; failed: number }>;
```

- [ ] **Passo 1 — Teste vermelho da fila.** Em `tests/operations/webhook-queue.test.ts`: o POST confirma recebimento somente depois de o evento estar persistido; uma falha de processamento **não** transforma a resposta em erro para o Bling; o mesmo evento entregue duas vezes é processado uma vez; eventos fora de ordem chegam ao estado final correto; com o processamento suspenso os eventos acumulam e são retomados sem perda. Rodar e confirmar falha.
- [ ] **Passo 2 — Implementar a fila.** `webhook-queue.ts` grava o evento bruto com ID derivado do conteúdo da entrega (não de `Date.now()`), estado `received` e contador de tentativas. A chave derivada é o que garante a idempotência entre entregas repetidas. Reaproveitar a modelagem já usada por `mercadoLivreWebhookEvents`, que existe no projeto e resolve o mesmo problema.
- [ ] **Passo 3 — Separar recebimento de processamento.** Em `src/app/api/webhook/bling/route.ts`, o POST passa a: verificar assinatura, enfileirar, responder 200. As funções `handleStockWebhook` e `handleOrderDeleted` passam a ser executadas pelo dreno. **Não depender apenas de um retry presumido do Bling**: um evento com falha permanece na fila com estado `failed` e é retomável explicitamente. Preservar a verificação de assinatura existente e o comportamento de `logWebhookDebug`.
- [ ] **Passo 4 — Extrair a persistência de vendas.** Mover para `firestore-sales-ingest.ts` o corpo de `saveSalesOrdersOptimized` (lotes de 500, `serialize`, `merge: true`), a escrita de `stockUpdates` do webhook e a exclusão lógica de `handleOrderDeleted`. `order-service.ts` mantém as funções de consulta e passa a delegar a gravação. As funções exportadas e suas assinaturas não mudam.
- [ ] **Passo 5 — Teste vermelho do upsert SQL.** Contra `createPostgresSalesIngestRepository(pool)`: reprocessar o mesmo pedido é no-op; uma versão mais nova substitui a anterior; uma versão regressiva é recusada; a ordem do array `itens` é preservada; a exclusão lógica é preservada e distinta de registro ausente; a projeção de itens é recriada no mesmo commit do pedido.
- [ ] **Passo 6 — Implementar o upsert SQL.** Usar `insert ... on conflict (source_id) do update` condicionado à versão, dentro de `withOperationalWrite`. A observação de estoque atualiza `stock_observations` e recalcula a projeção de última observação válida pelas mesmas regras JavaScript legadas já implementadas em `stored-stock-model.ts` — não reinterpretar datas legadas no SQL.
- [ ] **Passo 7 — Equivalência da ingestão.** Processar a mesma sequência de eventos pelos dois adaptadores e comparar o estado final normalizado: contagens, conteúdo, exclusões e projeções de estoque. Incluir entrega duplicada, entrega fora de ordem e evento com payload inválido.
- [ ] **Passo 8 — Verificar e commitar.** `npm run test:postgres`, vitest sob emulador, typecheck, `npm run build`. Commit `feat(postgres): add durable ingest queue and sales write adapters`.

---

## Task 5: Cache e indisponibilidade

**Files:**
- Modify: `src/server/operations/stock.ts`, `src/server/persistence/supplies-write.ts`, `src/server/persistence/production-write.ts`
- Test: `tests/operations/cache-invalidation.test.ts`

**Interfaces:**
- Consome os repositórios de escrita das Tasks 2–4.
- Produz `invalidateAfterWrite(domain: 'stock' | 'supplies' | 'production'): Promise<void>`, chamada pela fronteira de operações depois de um commit bem-sucedido.

O cache atual de estoque é uma variável de módulo em `src/server/operations/stock.ts:10`, com `invalidateProductStockCache()` na linha 12 e expiração de 300 s. Ele tem duas propriedades que a spec proíbe:

1. **Não é segmentado por identidade, permissões ou filtros** — é uma lista única de produtos compartilhada entre todos os chamadores.
2. **É local ao processo.** Sob Fluid Compute a aplicação roda em várias instâncias; invalidar numa não invalida as outras. Uma gravação pode ser seguida de uma leitura obsoleta em outra instância por até 300 segundos.

- [ ] **Passo 1 — Teste vermelho.** Em `tests/operations/cache-invalidation.test.ts`: uma leitura logo após uma gravação bem-sucedida reflete a mudança; uma gravação que falha **não** invalida o cache; uma entrada de cache nunca serve de base para uma gravação, isto é, nenhum caminho de escrita lê `cached`; com o banco indisponível a leitura devolve `source: 'unavailable'` e não uma lista vazia.
- [ ] **Passo 2 — Segmentar.** Passar a chavear o cache por identidade efetiva e pelos filtros da consulta, preservando a data de observação (`asOf`) por entrada. Uma entrada não pode ser servida a um chamador com permissões diferentes das de quem a preencheu.
- [ ] **Passo 3 — Invalidação entre instâncias.** Substituir a invalidação local por uma marca de versão compartilhada, lida junto com a entrada: uma gravação incrementa a versão do domínio e toda entrada mais antiga que a versão vigente é descartada na leitura. **Não** confiar em `invalidateProductStockCache()` isolado: ele só limpa a instância que executou a gravação.
- [ ] **Passo 4 — Indisponibilidade.** Confirmar que, em erro de banco, todas as leituras do núcleo devolvem indisponibilidade explícita. Em particular, o MCP não pode cair silenciosamente para o Bling nem devolver lista vazia.
- [ ] **Passo 5 — Verificar e commitar.** Suíte vitest sob emulador, `npm run test:postgres`, typecheck. Commit `fix(cache): scope and invalidate core read cache across instances`.

---

## Task 6: Encerramento da etapa

**Files:**
- Create: `docs/evidence/operational-postgres-phase4.{md,json}`
- Modify: `docs/superpowers/specs/2026-09-12-operational-postgres-design.md`, `supabase/operational/README.md`

- [ ] **Passo 1 — Bateria completa.** Rodar, com Java no PATH: `PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json 'npx --no-install vitest run tests/access tests/oauth tests/mcp tests/operations tests/backup tests/deployment'` e `npm run test:postgres`. Registrar os números reais, não os esperados.
- [ ] **Passo 2 — Conferir os seletores.** `rg -n "salesIngestRepository|suppliesWriteRepository|productionWriteRepository" src/server/persistence/*.ts` deve mostrar Firestore como implementação ativa em todos. Nenhuma variável de ambiente de produção alterada.
- [ ] **Passo 3 — Evidência.** Registrar as 19 operações portadas, os resultados de concorrência e idempotência, e as limitações — em especial a janela de desativação concorrente de usuários da Task 3 e o fato de que nenhuma gravação real foi feita em PostgreSQL hospedado.
- [ ] **Passo 4 — Revisão e commit.** superpowers:requesting-code-review sobre o diff completo. Commit local; sem merge e sem deploy.

**Critério de saída da etapa 4:** concorrência, idempotência, recuperação de eventos e todas as 19 entradas de escrita testadas, com equivalência comprovada entre adaptadores e o seletor ainda em Firestore.

**Próxima entrega:** `2026-09-12-operational-postgres-phase5-cutover.md`. Ela só pode ser executada depois de os resultados desta etapa serem verificados.
