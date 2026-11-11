# Fase 1 da saída do Firebase: histórico de saldo e demanda semanal no PostgreSQL

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer as duas séries que só existem no Firestore (`stockObservations` e `skuWeeklyDemand`) existirem também no PostgreSQL, para que o corte do núcleo não perca nem silencie nenhuma delas.

**Architecture:** As duas viram coleções do mesmo mecanismo genérico de carga (`source_id`, `payload`, versão, hash, execução, exclusão lógica). Assim a exportação, a importação, a reconciliação e o comparador do corte passam a cobri-las sem código especial. O caminho PostgreSQL das gravações passa a registrar o histórico de saldo. A demanda semanal ganha um repositório trocável por fonte, como os demais.

**Tech Stack:** Node.js 22, TypeScript, `pg` 8.23, PostgreSQL 17 (Supabase `mmewkphsrnttkzvpyddv`), Vitest com Firestore Emulator, `node --test` para a integração PostgreSQL em Docker.

## Global Constraints

- **Nada aqui toca produção.** As migrations entram na cadeia manual de `supabase/operational/migrations/`. A aplicação no projeto hospedado é um passo separado, com autorização.
- Não aplicar as migrations operacionais pela cadeia `supabase/migrations` nem usar `db push`, como diz o README operacional.
- Toda tabela operacional nova tem RLS, `revoke all ... from public` e política explícita para `brsteel_ops_importer`, `brsteel_ops_reader`, `brsteel_ops_writer` e `brsteel_ops_backup`, no mesmo padrão das 11 existentes.
- O catálogo esperado muda de 13 para 15 tabelas com RLS e de 18 para 20 chaves estrangeiras. O executor local (`scripts/operational-postgres-local.mjs`) e o backup (`scripts/lib/operational-backup.mjs`) mudam junto.
- Linhas gravadas pela aplicação usam `NATIVE_RUN_ID`. A carga nunca as reconcilia, e o comparador nunca as conta como documento do snapshot.
- A fonte ativa continua em `appConfig/operationalSource`, e o comportamento com a fonte em Firestore não muda.
- Rodar `npm run test:vitest`, `npm run test:postgres`, `npm run typecheck:ci` e `npm run lint` antes do PR.

---

### Task 1: Tabelas `stock_observation_log` e `sku_weekly_demand`

**Files:**
- Create: `supabase/operational/migrations/20261111120000_operational_history.sql`
- Modify: `scripts/operational-postgres-local.mjs:101` (catálogo 13→15, RLS 13→15, FKs 18→20)
- Modify: `scripts/lib/operational-backup.mjs:7-9,79` (lista de tabelas e contagens)
- Modify: `supabase/operational/README.md` (tabela "Como saber o que está aplicado" e o parágrafo das 13 tabelas)
- Modify: `supabase/operational/backup-restore.md:10,32` (13 → 15)
- Test: `tests/postgres/operational-history.integration.ts`, `tests/backup/operational-backup.test.ts`

**Interfaces:**
- Produces: tabelas `brsteel_ops.stock_observation_log` e `brsteel_ops.sku_weekly_demand`, com as colunas genéricas `source_id, payload, source_version, source_hash, import_run_id, source_deleted`.

- [ ] **Step 1: Write the failing test**

`tests/postgres/operational-history.integration.ts`:

```ts
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Pool } from 'pg';

const url = process.env.BRSTEEL_PG_LOCAL_URL;
assert.ok(url);
const pool = new Pool({ connectionString: url, max: 2 });
after(() => pool.end());

const TABLES = ['stock_observation_log', 'sku_weekly_demand'];

test('history tables exist with RLS and the operational role policies', async () => {
  for (const table of TABLES) {
    const row = (await pool.query(`select c.relrowsecurity as rls,
        has_table_privilege('brsteel_ops_reader', 'brsteel_ops.${table}', 'select') as reader,
        has_table_privilege('brsteel_ops_importer', 'brsteel_ops.${table}', 'insert') as importer,
        has_table_privilege('brsteel_ops_writer', 'brsteel_ops.${table}', 'insert') as writer,
        has_table_privilege('brsteel_ops_backup', 'brsteel_ops.${table}', 'select') as backup,
        has_table_privilege('brsteel_ops_reader', 'brsteel_ops.${table}', 'insert') as reader_writes,
        has_table_privilege('anon', 'brsteel_ops.${table}', 'select') as anon
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'brsteel_ops' and c.relname = $1`, [table])).rows[0];
    assert.deepEqual(row, { rls: true, reader: true, importer: true, writer: true, backup: true,
      reader_writes: false, anon: false }, table);
  }
});
```

Em `tests/backup/operational-backup.test.ts`, ajustar a expectativa da lista de tabelas para incluir `brsteel_ops.sku_weekly_demand` e `brsteel_ops.stock_observation_log`. Se o teste fixa a contagem, trocar 13 por 15.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:postgres`
Expected: FAIL. O executor local recusa o catálogo antes dos testes, ou o novo teste falha com `Cannot read properties of undefined`, porque as tabelas não existem.

- [ ] **Step 3: Write the migration**

`supabase/operational/migrations/20261111120000_operational_history.sql`:

```sql
-- Histórico de saldo por SKU e demanda semanal: as duas séries que até aqui só existiam no Firestore.
-- Mesmo formato genérico das demais coleções, para que carga, reconciliação e comparador as cubram.
create table brsteel_ops.stock_observation_log (
  source_id text collate "C" primary key check (length(source_id) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_version numeric(30,0) not null check (source_version >= 0),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  import_run_id text not null references brsteel_import.runs(id),
  source_deleted boolean not null default false
);
create index stock_observation_log_sku on brsteel_ops.stock_observation_log
  ((payload->>'sku'), (payload->>'observedAt')) where not source_deleted;

create table brsteel_ops.sku_weekly_demand (
  source_id text collate "C" primary key check (length(source_id) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_version numeric(30,0) not null check (source_version >= 0),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  import_run_id text not null references brsteel_import.runs(id),
  source_deleted boolean not null default false
);

alter table brsteel_ops.stock_observation_log enable row level security;
revoke all on brsteel_ops.stock_observation_log from public;
grant select, insert, update, delete on brsteel_ops.stock_observation_log to brsteel_ops_importer;
create policy importer on brsteel_ops.stock_observation_log for all to brsteel_ops_importer using (true) with check (true);
grant select on brsteel_ops.stock_observation_log to brsteel_ops_reader;
create policy reader on brsteel_ops.stock_observation_log for select to brsteel_ops_reader using (true);
grant select, insert, update, delete on brsteel_ops.stock_observation_log to brsteel_ops_writer;
create policy writer on brsteel_ops.stock_observation_log for all to brsteel_ops_writer using (true) with check (true);
grant select on brsteel_ops.stock_observation_log to brsteel_ops_backup;
create policy backup_reader on brsteel_ops.stock_observation_log for select to brsteel_ops_backup using (true);

alter table brsteel_ops.sku_weekly_demand enable row level security;
revoke all on brsteel_ops.sku_weekly_demand from public;
grant select, insert, update, delete on brsteel_ops.sku_weekly_demand to brsteel_ops_importer;
create policy importer on brsteel_ops.sku_weekly_demand for all to brsteel_ops_importer using (true) with check (true);
grant select on brsteel_ops.sku_weekly_demand to brsteel_ops_reader;
create policy reader on brsteel_ops.sku_weekly_demand for select to brsteel_ops_reader using (true);
grant select, insert, update, delete on brsteel_ops.sku_weekly_demand to brsteel_ops_writer;
create policy writer on brsteel_ops.sku_weekly_demand for all to brsteel_ops_writer using (true) with check (true);
grant select on brsteel_ops.sku_weekly_demand to brsteel_ops_backup;
create policy backup_reader on brsteel_ops.sku_weekly_demand for select to brsteel_ops_backup using (true);
```

Atualizar os números do catálogo:
- Em `scripts/operational-postgres-local.mjs:101`: `catalog.tables !== 15 || catalog.rls_tables !== 15 || catalog.foreign_keys !== 20`.
- Em `scripts/lib/operational-backup.mjs`: incluir `'sku_weekly_demand'` e `'stock_observation_log'` na lista em ordem alfabética, e trocar `13` por `15` e `18` por `20` na linha 79.

Na tabela "Como saber o que está aplicado" do README operacional, acrescentar:

```
| `operational_history` | `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='brsteel_ops' and c.relname in ('stock_observation_log','sku_weekly_demand') and c.relrowsecurity` | 2 |
```

e trocar "13 tabelas com RLS" por "15 tabelas com RLS" no README e no `backup-restore.md`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:postgres` e `npx vitest run tests/backup`
Expected: PASS, com o catálogo de 15 tabelas aceito.

- [ ] **Step 5: Commit**

```bash
git add supabase/operational scripts/operational-postgres-local.mjs scripts/lib/operational-backup.mjs tests/postgres/operational-history.integration.ts tests/backup/operational-backup.test.ts
git commit -m "feat(postgres): add stock observation log and weekly demand tables"
```

---

### Task 2: As duas coleções no snapshot e na exportação

**Files:**
- Modify: `src/server/migration/operational-snapshot.ts:4-9,54-60`
- Modify: `src/server/migration/operational-export.ts:4-15`
- Test: `tests/operations/operational-snapshot.test.ts`, `tests/operations/operational-export-types.test.ts`, `tests/postgres/operational-history.integration.ts`

**Interfaces:**
- Consumes: as tabelas da Task 1.
- Produces: `TABLES.stockObservations === 'stock_observation_log'` e `TABLES.skuWeeklyDemand === 'sku_weekly_demand'`. `COLLECTIONS` passa a ter 12 itens, e `importSnapshot`, `verifySnapshot` e `reconcile` passam a cobri-los porque iteram `COLLECTIONS`.

- [ ] **Step 1: Write the failing tests**

Em `tests/operations/operational-snapshot.test.ts`:

```ts
const observation = { collection: 'stockObservations', id: 'obs-1', version: '1789214400000000001',
  data: { sku: 'A', estoqueAtual: 3, observedAt: '2026-09-01T10:00:00.000Z', event: 'stock.updated',
    source: 'webhook', expiresAt: '2028-09-01T10:00:00.000Z' } };
const weekly = { collection: 'skuWeeklyDemand', id: 'A', version: '1789214400000000002',
  data: { sku: 'A', description: 'Ralo', weeks: { '2026-W35': { units: 4, orders: 2 } },
    lastClosedWeek: '2026-W35', updatedAt: '2026-09-01T10:00:00.000Z' } };

it('accepts stock observation history and weekly demand as operational collections', () => {
  const prepared = prepareSnapshot(snapshot([observation, weekly]));
  expect(prepared.records.map(r => r.collection)).toEqual(['stockObservations', 'skuWeeklyDemand']);
});
it.each([
  [{ ...observation, data: { ...observation.data, sku: '' } }],
  [{ ...observation, data: { ...observation.data, estoqueAtual: 'x' } }],
  [{ ...observation, data: { ...observation.data, observedAt: 'ontem' } }],
  [{ ...weekly, data: { ...weekly.data, weeks: { '2026-W35': { units: 'x', orders: 1 } } } }],
  [{ ...weekly, data: { ...weekly.data, weeks: { 'semana': { units: 1, orders: 1 } } } }],
])('rejects history records the readers could not interpret', record => {
  expect(() => prepareSnapshot(snapshot([record]))).toThrow();
});
```

Em `tests/operations/operational-export-types.test.ts`:

```ts
it('normalizes the retention timestamp of stock observation history', async () => {
  const exported = await exportOperationalSnapshot(source('stockObservations',
    { sku: 'A', estoqueAtual: 3, observedAt: '2026-09-01T10:00:00.000Z', expiresAt: timestamp }), 'demo-brsteel-auth');
  expect(exported.records[0].data.expiresAt).toBe('2026-09-12T10:00:00.123456000Z');
});
it('still rejects a native timestamp in the observation instant itself', async () => {
  await expect(exportOperationalSnapshot(source('stockObservations',
    { sku: 'A', estoqueAtual: 3, observedAt: timestamp }), 'demo-brsteel-auth'))
    .rejects.toThrow(/Source timestamp requires explicit normalization/);
});
```

Em `tests/postgres/operational-history.integration.ts`, acrescentar uma ida e volta pela carga (`importSnapshot` e depois `verifySnapshot`) com um registro de cada coleção nova. Usar `createLocalImportPool(url)` e o mesmo `snapshot()` de `operational-write.integration.ts`. Conferir que `verifySnapshot` devolve `records` igual ao total enviado.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/operations/operational-snapshot.test.ts tests/operations/operational-export-types.test.ts`
Expected: FAIL. `stockObservations` não é coleção válida no enum do snapshot, e a exportação recusa o `expiresAt` nativo.

- [ ] **Step 3: Implement**

Em `operational-snapshot.ts`, acrescentar ao `TABLES`:

```ts
  stockObservations: 'stock_observation_log', skuWeeklyDemand: 'sku_weekly_demand',
```

e, dentro do primeiro laço de `prepareSnapshot`, depois da validação de `salesOrders`:

```ts
    if (row.collection === 'stockObservations') {
      const { sku, estoqueAtual, observedAt } = row.data;
      if (typeof sku !== 'string' || !sku || typeof estoqueAtual !== 'number' || !Number.isFinite(estoqueAtual)
        || typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))) throw new Error(`Invalid stock observation: ${key}`);
    }
    if (row.collection === 'skuWeeklyDemand') {
      const weeks = row.data.weeks;
      if (typeof row.data.sku !== 'string' || !row.data.sku || !weeks || typeof weeks !== 'object' || Array.isArray(weeks)
        || Object.entries(weeks as Record<string, unknown>).some(([week, bucket]) => !/^\d{4}-W\d{2}$/.test(week)
          || !bucket || typeof bucket !== 'object' || !Number.isFinite((bucket as { units?: unknown }).units)
          || !Number.isInteger((bucket as { orders?: unknown }).orders))) throw new Error(`Invalid weekly demand: ${key}`);
    }
```

Em `operational-export.ts`, no `requireReadCompatibleTypes`, tratar o log como o `stockUpdates`: só os campos lidos ficam sujeitos à recusa, e o `expiresAt` de retenção é normalizado por `jsonValue`.

```ts
  if (collection === 'stockUpdates') {
    for (const field of ['sku','nome','webhookReceivedAt']) inspect(data[field]);
  } else if (collection === 'stockObservations') {
    for (const field of ['sku','estoqueAtual','observedAt','event','source']) inspect(data[field]);
  } else if (collection !== 'supplyCodes' && collection !== 'operationsMetadata') inspect(data);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/operations` e `npm run test:postgres`
Expected: PASS, incluindo os testes existentes de corte e de reconciliação que agora iteram 12 coleções.

- [ ] **Step 5: Commit**

```bash
git add src/server/migration tests/operations/operational-snapshot.test.ts tests/operations/operational-export-types.test.ts tests/postgres/operational-history.integration.ts
git commit -m "feat(migration): carry stock history and weekly demand in the operational snapshot"
```

---

### Task 3: O caminho PostgreSQL registra o histórico de saldo

**Files:**
- Modify: `src/server/persistence/postgres-sales-ingest.ts` (`applyStockObservation`)
- Modify: `src/server/persistence/sales-ingest-contract.ts:9-10` (comentário: as duas implementações registram)
- Test: `tests/postgres/operational-write.integration.ts`

**Interfaces:**
- Consumes: `brsteel_ops.stock_observation_log` (Task 1).
- Produces: linhas nativas (`import_run_id = NATIVE_RUN_ID`), com `source_id` UUID e payload `{ sku, estoqueAtual, observedAt, event, source: 'webhook', expiresAt }`, igual ao documento do Firestore.

- [ ] **Step 1: Write the failing test**

Em `tests/postgres/operational-write.integration.ts`, depois do teste de projeção de estoque:

```ts
test('SQL stock observations append to the history only when the balance changes', async () => {
  await seedReadyCopy();
  await pool.query('delete from brsteel_ops.stock_observation_log');
  await ingest.applyStockObservation('A', { sku: 'A', estoqueAtual: 5, webhookReceivedAt: '2026-09-01T00:00:00Z', lastEvent: 'stock.updated' });
  await ingest.applyStockObservation('A', { sku: 'A', estoqueAtual: 5, webhookReceivedAt: '2026-09-01T01:00:00Z' });
  await ingest.applyStockObservation('A', { sku: 'A', estoqueAtual: 7, webhookReceivedAt: '2026-09-01T02:00:00Z' });
  await ingest.applyStockObservation('A', { sku: 'A', estoqueAtual: Number.NaN, webhookReceivedAt: '2026-09-01T03:00:00Z' });
  await ingest.applyStockObservation('A', { sku: 'A', estoqueAtual: 8, webhookReceivedAt: 'quebrado' });
  const rows = (await pool.query(`select payload, import_run_id from brsteel_ops.stock_observation_log
    order by payload->>'observedAt'`)).rows;
  assert.deepEqual(rows.map(r => [r.payload.estoqueAtual, r.payload.observedAt]),
    [[5, '2026-09-01T00:00:00Z'], [7, '2026-09-01T02:00:00Z']]);
  assert.ok(rows.every(r => r.import_run_id === NATIVE_RUN_ID));
  assert.equal(rows[0].payload.event, 'stock.updated');
  assert.equal(rows[0].payload.expiresAt, new Date(Date.parse('2026-09-01T00:00:00Z') + 730 * 86_400_000).toISOString());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:postgres`
Expected: FAIL, com `[]` no lugar das duas observações.

- [ ] **Step 3: Implement**

Em `postgres-sales-ingest.ts`, importar `randomUUID` de `node:crypto`, declarar `const OBSERVATION_TTL_MS = 730 * 86_400_000;` e trocar o corpo de `applyStockObservation`:

```ts
    async applyStockObservation(sku: string, observation: Doc) {
      await withOperationalWrite(pool, async client => {
        const current = (await client.query(
          'select payload from brsteel_ops.stock_observations where source_id = $1 for update', [sku])).rows[0];
        const previous = current?.payload as Doc | undefined;
        const payload = { ...previous, ...observation };
        await client.query(
          `insert into brsteel_ops.stock_observations (source_id, payload, source_version, source_hash, import_run_id)
           values ($1, $2, $3, $4, $5)
           on conflict (source_id) do update set payload = excluded.payload, source_version = excluded.source_version,
             source_hash = excluded.source_hash, source_deleted = false`,
          [sku, JSON.stringify(payload), nativeVersion(), contentHash(payload), NATIVE_RUN_ID]);
        // Mesma regra do log do Firestore (firestore-sales-ingest.ts): só registra saldo numérico que
        // mudou, com instante legível. Bling reentrega o mesmo número com frequência.
        const balance = observation.estoqueAtual;
        const observedAt = String(observation.webhookReceivedAt ?? '');
        const at = Date.parse(observedAt);
        if (typeof balance === 'number' && Number.isFinite(balance) && previous?.estoqueAtual !== balance && Number.isFinite(at)) {
          const entry = { sku, estoqueAtual: balance, observedAt, event: String(observation.lastEvent ?? ''),
            source: 'webhook', expiresAt: new Date(at + OBSERVATION_TTL_MS).toISOString() };
          await client.query(
            `insert into brsteel_ops.stock_observation_log (source_id, payload, source_version, source_hash, import_run_id)
             values ($1, $2, $3, $4, $5)`,
            [randomUUID(), JSON.stringify(entry), nativeVersion(), contentHash(entry), NATIVE_RUN_ID]);
        }
        await rebuildStockProjection(client);
      });
    },
```

Atualizar o comentário do contrato: "As duas implementações também registram cada mudança de saldo no histórico".

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:postgres`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/persistence/postgres-sales-ingest.ts src/server/persistence/sales-ingest-contract.ts tests/postgres/operational-write.integration.ts
git commit -m "feat(postgres): record stock balance history on the SQL ingest path"
```

---

### Task 4: Demanda semanal com repositório trocável

**Files:**
- Create: `src/server/persistence/sku-weekly-demand-contract.ts`
- Create: `src/server/persistence/postgres-sku-weekly-demand.ts`
- Create: `src/server/persistence/sku-weekly-demand.ts`
- Modify: `src/server/persistence/firestore-sku-weekly-demand.ts` (exportar `firestoreSkuWeeklyDemandRepository`)
- Modify: `src/app/api/cron/sku-weekly-rollup/route.ts`, `src/server/operations/sku-history.ts`
- Test: `tests/postgres/operational-history.integration.ts`, `tests/operations/sku-weekly-rollup-cron.test.ts`, `tests/operations/sku-history.test.ts`

**Interfaces:**
- Produces:

```ts
// sku-weekly-demand-contract.ts
import type { HistoryPoint } from './production-demand-contract';
export type RollupResult = { weeks: string[]; skus: number; remaining: number };
export interface SkuWeeklyDemandRepository {
  rollUpPendingWeeks(now?: Date, budgetMs?: number): Promise<RollupResult>;
  readWeeklyHistory(weeks: number): Promise<Map<string, HistoryPoint[]>>;
}
```

- `skuWeeklyDemandRepository` em `sku-weekly-demand.ts`, resolvido por chamada com `selectRepository`.

- [ ] **Step 1: Write the failing test**

Em `tests/postgres/operational-history.integration.ts`, com o pool de escritor (`options: '-c role=brsteel_ops_writer'`) e uma cópia pronta semeada como em `operational-write.integration.ts` (`seedReadyCopy`). Os pedidos são semeados direto em `brsteel_ops.sales_orders` e `sales_order_items`, com `notaFiscal.id` e situação não cancelada:

```ts
test('SQL weekly rollup closes weeks, drops stale buckets and serves the series', async () => {
  // Semana 2026-W35: pedido 1 com 3 un. de A e 2 un. de B. Semana 2026-W36: pedido 2 com 1 un. de A.
  await seedOrder(1, '2026-08-25', [{ codigo: 'A', quantidade: 3, descricao: 'Ralo' }, { codigo: 'B', quantidade: 2 }]);
  await seedOrder(2, '2026-09-01', [{ codigo: 'A', quantidade: 1 }]);
  const repository = createPostgresSkuWeeklyDemandRepository(writerPool);
  const now = new Date('2026-09-09T12:00:00Z');
  const first = await repository.rollUpPendingWeeks(now, 60_000);
  assert.ok(first.weeks.includes('2026-W35') && first.weeks.includes('2026-W36'));
  let series = await repository.readWeeklyHistory(104);
  assert.deepEqual(series.get('A'), [{ week: '2026-W35', units: 3, orders: 1 }, { week: '2026-W36', units: 1, orders: 1 }]);
  assert.deepEqual(series.get('B'), [{ week: '2026-W35', units: 2, orders: 1 }]);
  // O pedido 1 é cancelado: reprocessar a semana tem que tirar B (que fica sem semana nenhuma).
  await cancelOrder(1);
  await pool.query(`update brsteel_ops.sku_weekly_demand set payload = payload - 'lastClosedWeek'`);
  await repository.rollUpPendingWeeks(now, 60_000);
  series = await repository.readWeeklyHistory(104);
  assert.equal(series.get('B'), undefined);
  assert.deepEqual(series.get('A'), [{ week: '2026-W36', units: 1, orders: 1 }]);
  const native = (await pool.query(`select count(*)::int as n from brsteel_ops.sku_weekly_demand where import_run_id <> $1`, [NATIVE_RUN_ID])).rows[0].n;
  assert.equal(native, 0);
});
```

`seedOrder` e `cancelOrder` são helpers locais do arquivo:
- `seedOrder` insere a ordem com `payload = { id, data, situacao: { id: 9 }, notaFiscal: { id: 1 }, itens }`, `import_run_id = NATIVE_RUN_ID` e os itens.
- `cancelOrder` atualiza a ordem para `situacao.id = 12`, o id cancelado em `CANCELLED_ORDER_STATUS` (`src/server/persistence/demand-eligibility.ts`).

Em `tests/operations/sku-weekly-rollup-cron.test.ts`, trocar o mock de `@/server/persistence/firestore-sku-weekly-demand` por `@/server/persistence/sku-weekly-demand`, com `skuWeeklyDemandRepository.rollUpPendingWeeks`. Em `tests/operations/sku-history.test.ts`, conferir que `source` acompanha `readOperationalSource()`: `firestore` ou `postgres`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:postgres` e `npx vitest run tests/operations/sku-weekly-rollup-cron.test.ts tests/operations/sku-history.test.ts`
Expected: FAIL. `createPostgresSkuWeeklyDemandRepository` não existe, e o cron ainda importa a implementação Firestore.

- [ ] **Step 3: Implement**

`src/server/persistence/postgres-sku-weekly-demand.ts`:

```ts
import 'server-only';
import type { Pool } from 'pg';
import { contentHash, NATIVE_RUN_ID } from '@/server/migration/operational-snapshot';
import { closedWeeksSince, isoWeekRange } from '@/lib/iso-week';
import { serialize } from '@/server/operations/common';
import { countsAsConsumption } from './demand-eligibility';
import { createPostgresSalesRepository } from './postgres-sales';
import { withOperationalWrite } from './postgres-write';
import { withOperationalSnapshot } from './postgres-read';
import type { HistoryPoint } from './production-demand-contract';
import type { RollupResult, SkuWeeklyDemandRepository } from './sku-weekly-demand-contract';

type WeekBucket = { units: number; orders: number };
type Stored = { sku: string; description?: string; weeks: Record<string, WeekBucket>; lastClosedWeek?: string; updatedAt?: string };
const ROLLUP_BUDGET_MS = 240_000;
const CACHE_TTL_MS = 600_000;
const nativeVersion = () => String(BigInt(Date.now()) * BigInt(1000000));

/** O SKU é a chave: no PostgreSQL não há restrição de caracteres como a do id de documento do Firestore. */
export function createPostgresSkuWeeklyDemandRepository(pool: Pool): SkuWeeklyDemandRepository {
  let cached: { at: number; series: Map<string, HistoryPoint[]> } | null = null;
  // Os pedidos vêm do mesmo banco, nunca do repositório trocável: esta implementação só é escolhida
  // com a fonte em PostgreSQL, e o trocável leria `operationalSource` de novo (no teste, Firestore).
  const sales = createPostgresSalesRepository(pool);

  async function rollUpWeek(week: string, now: Date) {
    const { from, to } = isoWeekRange(week);
    const orders = await sales.readOrdersForPeriod({ from, to });
    const buckets = new Map<string, { description: string; orders: Set<number>; units: number }>();
    for (const order of orders) {
      if (!countsAsConsumption(order)) continue;
      for (const item of order.itens ?? []) {
        if (!item.codigo || !Number.isFinite(item.quantidade) || item.quantidade <= 0) continue;
        const description = typeof item.descricao === 'string' ? item.descricao : '';
        const bucket = buckets.get(item.codigo) ?? { description, orders: new Set<number>(), units: 0 };
        bucket.orders.add(order.id); bucket.units += item.quantidade; buckets.set(item.codigo, bucket);
      }
    }
    const oldest = closedWeeksSince(null, now)[0];
    await withOperationalWrite(pool, async client => {
      const rows = (await client.query(
        'select source_id, payload from brsteel_ops.sku_weekly_demand where not source_deleted for update')).rows;
      const stored = new Map(rows.map(row => [row.source_id as string, row.payload as Stored]));
      for (const sku of new Set([...stored.keys(), ...buckets.keys()])) {
        const previous = stored.get(sku);
        const fresh = buckets.get(sku);
        const weeks = { ...(previous?.weeks ?? {}) };
        for (const key of Object.keys(weeks)) if (key < oldest || key === week) delete weeks[key];
        if (fresh) weeks[week] = { units: fresh.units, orders: fresh.orders.size };
        if (!fresh && previous && Object.keys(weeks).length === Object.keys(previous.weeks ?? {}).length) continue;
        if (!Object.keys(weeks).length) {
          await client.query(`update brsteel_ops.sku_weekly_demand set source_deleted = true where source_id = $1`, [sku]);
          continue;
        }
        const payload = serialize({ ...previous, sku, weeks,
          ...(fresh?.description ? { description: fresh.description } : {}),
          ...(fresh ? { lastClosedWeek: week } : {}), updatedAt: now.toISOString() }) as Stored;
        await client.query(
          `insert into brsteel_ops.sku_weekly_demand (source_id, payload, source_version, source_hash, import_run_id)
           values ($1, $2, $3, $4, $5)
           on conflict (source_id) do update set payload = excluded.payload, source_version = excluded.source_version,
             source_hash = excluded.source_hash, source_deleted = false`,
          [sku, JSON.stringify(payload), nativeVersion(), contentHash(payload), NATIVE_RUN_ID]);
      }
    });
    cached = null;
    return buckets.size;
  }

  return {
    async rollUpPendingWeeks(now = new Date(), budgetMs = ROLLUP_BUDGET_MS): Promise<RollupResult> {
      const startedAt = Date.now();
      // Sem documento de checkpoint: a semana mais recente gravada serve de marca. Uma semana sem
      // nenhuma venda não avança a marca e é reprocessada na execução seguinte, o que é inofensivo,
      // porque o fechamento é idempotente.
      const last = (await withOperationalSnapshot(pool, client => client.query(
        `select max(payload->>'lastClosedWeek') as week from brsteel_ops.sku_weekly_demand`))).rows[0]?.week ?? null;
      const pending = closedWeeksSince(typeof last === 'string' ? last : null, now);
      const weeks: string[] = [];
      let skus = 0;
      for (const week of pending) {
        if (weeks.length && Date.now() - startedAt >= budgetMs) break;
        skus += await rollUpWeek(week, now);
        weeks.push(week);
      }
      return { weeks, skus, remaining: pending.length - weeks.length };
    },
    async readWeeklyHistory(weeks: number) {
      if (!cached || Date.now() - cached.at > CACHE_TTL_MS) {
        const rows = (await withOperationalSnapshot(pool, client => client.query(
          'select source_id, payload from brsteel_ops.sku_weekly_demand where not source_deleted'))).rows;
        const series = new Map<string, HistoryPoint[]>();
        for (const row of rows) {
          const stored = ((row.payload as Stored).weeks ?? {});
          const points = Object.keys(stored).sort().map(week => ({ week, units: stored[week].units, orders: stored[week].orders }));
          if (points.length) series.set(String((row.payload as Stored).sku || row.source_id), points);
        }
        cached = { at: Date.now(), series };
      }
      return new Map([...cached.series].map(([sku, points]) => [sku, weeks > 0 ? points.slice(-weeks) : []]));
    },
  };
}
```

Antes de escrever, confira duas coisas:
- se `withOperationalSnapshot` devolve o valor do callback, como `postgres-production-demand.ts` sugere;
- se `serialize` aceita o objeto como está.

Se a assinatura for outra, ajuste o uso a ela, sem criar um utilitário novo.

No fim de `firestore-sku-weekly-demand.ts`:

```ts
export const firestoreSkuWeeklyDemandRepository: SkuWeeklyDemandRepository = { rollUpPendingWeeks, readWeeklyHistory };
```

`src/server/persistence/sku-weekly-demand.ts`:

```ts
import 'server-only';
import { firestoreSkuWeeklyDemandRepository } from './firestore-sku-weekly-demand';
import { createPostgresSkuWeeklyDemandRepository } from './postgres-sku-weekly-demand';
import { selectRepository } from './source';

/** Resolvido por chamada: o rollup e a série seguem a fonte ativa, como o restante do núcleo. */
export const skuWeeklyDemandRepository = selectRepository(firestoreSkuWeeklyDemandRepository, createPostgresSkuWeeklyDemandRepository);
```

No cron, trocar `import { rollUpPendingWeeks } from '@/server/persistence/firestore-sku-weekly-demand'` por `import { skuWeeklyDemandRepository } from '@/server/persistence/sku-weekly-demand'` e chamar `skuWeeklyDemandRepository.rollUpPendingWeeks()`.

Em `sku-history.ts`, ler por `skuWeeklyDemandRepository.readWeeklyHistory(semanas)` e informar a fonte real:

```ts
import { readOperationalSource } from '@/server/persistence/source';
import { skuWeeklyDemandRepository } from '@/server/persistence/sku-weekly-demand';
// ...
  const [points, source] = await Promise.all([
    skuWeeklyDemandRepository.readWeeklyHistory(semanas).then(series => series.get(sku) ?? []),
    readOperationalSource(),
  ]);
  return result(points, source, points.length ? [] : [ /* mesmo aviso de hoje */ ]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:postgres` e `npm run test:vitest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/persistence src/app/api/cron/sku-weekly-rollup/route.ts src/server/operations/sku-history.ts tests
git commit -m "feat(postgres): switchable weekly demand rollup and series"
```

---

### Task 5: A demanda de produção em PostgreSQL devolve a série

**Files:**
- Modify: `src/server/persistence/postgres-production-demand.ts`
- Test: `tests/postgres/operational-readers.integration.ts`

**Interfaces:**
- Consumes: `brsteel_ops.sku_weekly_demand` (Task 1), no mesmo formato que a Task 4 grava.
- Produces: `history` com as 12 semanas fechadas mais recentes e, se o período alcança a semana corrente, o ponto aberto `{ week, units, orders, open: true }`. É a mesma forma de `readFirestoreProductionDemand`.

- [ ] **Step 1: Write the failing test**

Em `tests/postgres/operational-readers.integration.ts`:
1. Semear `brsteel_ops.sku_weekly_demand` com A: `weeks { '2026-W35': {units:3,orders:1} }`.
2. Semear um pedido faturado na semana corrente com 2 un. de A.
3. Ler a demanda num período que alcança hoje.

Conferir:
- `history` de A é `[{week:'2026-W35',units:3,orders:1},{week:<semana corrente>,units:2,orders:1,open:true}]`;
- o aviso "A série semanal por SKU (campo `history`) não existe nesta fonte" não aparece mais.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:postgres`
Expected: FAIL. `history` vem `[]` e o aviso está presente.

- [ ] **Step 3: Implement**

Dentro do mesmo `withOperationalSnapshot`, ler a série e os pontos da semana corrente:

```ts
      const currentWeek = isoWeekOf(new Date());
      const { from: weekFrom, to: weekTo } = isoWeekRange(currentWeek);
      const stored = (await client.query(
        'select source_id, payload from brsteel_ops.sku_weekly_demand where not source_deleted')).rows;
      const closed = new Map<string, HistoryPoint[]>();
      for (const row of stored) {
        const weeksMap = (row.payload.weeks ?? {}) as Record<string, { units: number; orders: number }>;
        const points = Object.keys(weeksMap).sort().filter(week => week !== currentWeek)
          .map(week => ({ week, units: weeksMap[week].units, orders: weeksMap[week].orders })).slice(-12);
        if (points.length) closed.set(String(row.payload.sku || row.source_id), points);
      }
      const openFrom = input.from > weekFrom ? input.from : weekFrom;
      const openTo = input.to < weekTo ? input.to : weekTo;
      const open = new Map<string, { units: number; orders: number }>();
      if (openFrom <= openTo) {
        for (const row of (await client.query(demandSql, [openFrom, openTo])).rows) {
          if (typeof row.sku === 'string') open.set(row.sku, { units: Number(row.quantity), orders: row.order_count });
        }
      }
```

e, no `map` das linhas, trocar `history: []` por:

```ts
        history: (() => {
          const sku = typeof row.sku === 'string' ? row.sku : String(row.sku);
          const point = open.get(sku);
          const closedPoints = closed.get(sku) ?? [];
          return point ? [...closedPoints, { week: currentWeek, units: point.units, orders: point.orders, open: true }] : closedPoints;
        })(),
```

Remover o `warnings.push` da série vazia. Importar `isoWeekOf` e `isoWeekRange` de `@/lib/iso-week` e `HistoryPoint` de `./production-demand-contract`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:postgres`
Expected: PASS, inclusive os testes de equivalência entre os leitores Firestore e PostgreSQL que já existem.

- [ ] **Step 5: Commit**

```bash
git add src/server/persistence/postgres-production-demand.ts tests/postgres/operational-readers.integration.ts
git commit -m "feat(postgres): serve the weekly series in production demand"
```

---

### Task 6: Verificação completa, documentação e PR

**Files:**
- Modify: `supabase/operational/cutover-rehearsal.md` (o pré-requisito do log de estoque deixa de ser bloqueador)
- Modify: `docs/superpowers/plans/2026-09-12-operational-postgres-phase5-cutover.md` (marcar o pré-requisito de dados como atendido no código, ainda não no projeto hospedado)
- Modify: `docs/migracao-supabase-2026-11.md` (Fase 1 da saída do Firebase)

- [ ] **Step 1:** `npm run lint`, `npm run typecheck:ci`, `npm run test:vitest` e `npm run test:postgres`. Todos verdes.
- [ ] **Step 2:** Atualizar os três documentos, dizendo o que mudou e o que ainda falta. A migration ainda não foi aplicada no projeto hospedado, e o `scripts/backfill-sku-weekly-demand.ts` continua só no Firestore, porque roda antes do corte.
- [ ] **Step 3:** Commit `docs: record phase 1 of the Firebase exit` e PR contra `main`.

---

## Fora deste plano

- Aplicar a migration nova no Supabase hospedado (passo da Fase 2, com autorização).
- Exportar o Firestore de produção e carregar o projeto novo (Fase 2).
- A janela de identidade entre `users` do Firestore e as gravações em PostgreSQL (Fase 3).
