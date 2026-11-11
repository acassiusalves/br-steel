import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { COLLECTIONS, NATIVE_RUN_ID, type OperationalSnapshot } from '../../src/server/migration/operational-snapshot';
import { createPostgresSkuWeeklyDemandRepository } from '../../src/server/persistence/postgres-sku-weekly-demand';
import { closedWeeksSince } from '../../src/lib/iso-week';
import { createLocalImportPool, importSnapshot, verifySnapshot } from '../../src/server/migration/operational-import';

const url = process.env.BRSTEEL_PG_LOCAL_URL;
assert.ok(url);
const pool = new Pool({ connectionString: url, max: 2 });
const importPool = createLocalImportPool(url);
const writerPool = new Pool({ connectionString: url, max: 4, options: '-c role=brsteel_ops_writer' });
after(async () => { await importPool.end(); await writerPool.end(); await pool.end(); });

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

test('stock observation history and weekly demand round-trip through import and verification', async () => {
  await importPool.query('truncate brsteel_import.runs cascade');
  const snapshot: OperationalSnapshot = { formatVersion: 1, sourceProject: 'demo-brsteel-auth', capturedAt: '2026-09-12T12:00:00.000Z',
    completeCollections: [...COLLECTIONS], records: [
      { collection: 'stockObservations', id: 'obs-1', version: '1789214400000000001',
        data: { sku: 'A', estoqueAtual: 3, observedAt: '2026-09-01T10:00:00.000Z', event: 'stock.updated',
          source: 'webhook', expiresAt: '2028-09-01T10:00:00.000Z' } },
      { collection: 'skuWeeklyDemand', id: 'A', version: '1789214400000000002',
        data: { sku: 'A', description: 'Ralo', weeks: { '2026-W35': { units: 4, orders: 2 } },
          lastClosedWeek: '2026-W35', updatedAt: '2026-09-01T10:00:00.000Z' } },
    ] };
  await importSnapshot(importPool, snapshot);
  assert.equal((await verifySnapshot(importPool, snapshot)).records, snapshot.records.length);
  const rows = await pool.query(`select (select count(*) from brsteel_ops.stock_observation_log)::int as obs,
    (select count(*) from brsteel_ops.sku_weekly_demand)::int as weekly`);
  assert.deepEqual(rows.rows[0], { obs: 1, weekly: 1 });
});

/** A ready copy is the precondition every write transaction and snapshot read checks. */
async function seedReadyCopy() {
  const run = 'd'.repeat(64);
  await pool.query('truncate brsteel_import.runs cascade');
  await pool.query(`insert into brsteel_import.runs (id, source_project, captured_at, status, next_index, total_records, completed_at)
    values ($1, 'brsteel-native', '-infinity', 'complete', 0, 0, '-infinity') on conflict (id) do nothing`, [NATIVE_RUN_ID]);
  await pool.query(`insert into brsteel_import.runs (id, source_project, captured_at, status, next_index, total_records, completed_at)
    values ($1, 'demo-brsteel-auth', now() - interval '1 hour', 'complete', 0, 0, now() - interval '1 hour')`, [run]);
  await pool.query(`insert into brsteel_import.state (singleton, source_project, active_run, ready, captured_at, completed_at)
    values (true, 'demo-brsteel-auth', $1, true, now() - interval '1 hour', now() - interval '1 hour')
    on conflict (singleton) do update set active_run = excluded.active_run, ready = excluded.ready,
      captured_at = excluded.captured_at, completed_at = excluded.completed_at`, [run]);
}

type SeedItem = { codigo: string; quantidade: number; descricao?: string };
async function seedOrder(id: number, data: string, itens: SeedItem[]) {
  const payload = { id, numero: id, data, total: 100, notaFiscal: { id: 1 }, situacao: { id: 9 },
    itens: itens.map(item => ({ descricao: 'Item', valor: 1, unidade: 'UN', ...item })) };
  await pool.query(`insert into brsteel_ops.sales_orders (source_id, payload, source_version, source_hash, import_run_id)
    values ($1, $2, 1, $3, $4)`, [String(id), JSON.stringify(payload), 'a'.repeat(64), NATIVE_RUN_ID]);
  for (const [position, item] of payload.itens.entries()) {
    await pool.query('insert into brsteel_ops.sales_order_items (order_id, position, payload) values ($1, $2, $3)',
      [String(id), position, JSON.stringify(item)]);
  }
}
const cancelOrder = (id: number) => pool.query(
  `update brsteel_ops.sales_orders set payload = jsonb_set(payload, '{situacao,id}', '12') where source_id = $1`, [String(id)]);
const reset = async () => {
  await seedReadyCopy();
  await pool.query('delete from brsteel_ops.sales_order_items');
  await pool.query('delete from brsteel_ops.sales_orders');
  await pool.query('delete from brsteel_ops.sku_weekly_demand');
};
const now = new Date('2026-09-09T12:00:00Z');

test('SQL weekly rollup closes weeks, drops stale buckets and serves the series', async () => {
  await reset();
  // Semana 2026-W35: pedido 1 com 3 un. de A e 2 un. de B. Semana 2026-W36: pedido 2 com 1 un. de A.
  await seedOrder(1, '2026-08-25', [{ codigo: 'A', quantidade: 3, descricao: 'Ralo' }, { codigo: 'B', quantidade: 2 }]);
  await seedOrder(2, '2026-09-01', [{ codigo: 'A', quantidade: 1 }]);
  const repository = createPostgresSkuWeeklyDemandRepository(writerPool);
  const first = await repository.rollUpPendingWeeks(now, 600_000);
  assert.ok(first.weeks.includes('2026-W35') && first.weeks.includes('2026-W36'));
  assert.equal(first.remaining, 0);
  let series = await repository.readWeeklyHistory(104);
  assert.deepEqual(series.get('A'), [{ week: '2026-W35', units: 3, orders: 1 }, { week: '2026-W36', units: 1, orders: 1 }]);
  assert.deepEqual(series.get('B'), [{ week: '2026-W35', units: 2, orders: 1 }]);
  // O pedido 1 é cancelado: reprocessar a semana tem que tirar B (que fica sem semana nenhuma).
  await cancelOrder(1);
  await pool.query(`update brsteel_ops.sku_weekly_demand set payload = payload - 'lastClosedWeek'`);
  await repository.rollUpPendingWeeks(now, 600_000);
  series = await repository.readWeeklyHistory(104);
  assert.equal(series.get('B'), undefined);
  assert.deepEqual(series.get('A'), [{ week: '2026-W36', units: 1, orders: 1 }]);
  const native = (await pool.query(`select count(*)::int as n from brsteel_ops.sku_weekly_demand where import_run_id <> $1`, [NATIVE_RUN_ID])).rows[0].n;
  assert.equal(native, 0);
});

test('SQL weekly rollup keeps the description, is idempotent and does not rewrite unchanged SKUs', async () => {
  await reset();
  await seedOrder(1, '2026-08-25', [{ codigo: 'A', quantidade: 3, descricao: 'Ralo' }]);
  await seedOrder(2, '2026-09-01', [{ codigo: 'B', quantidade: 4 }]);
  const repository = createPostgresSkuWeeklyDemandRepository(writerPool);
  await repository.rollUpPendingWeeks(now, 600_000);
  const snapshot = async () => (await pool.query(
    `select source_id, source_version::text as version, payload->>'description' as description
       from brsteel_ops.sku_weekly_demand order by source_id`)).rows;
  const before = await snapshot();
  assert.equal(before[0].description, 'Ralo');
  // Reprocessa só W36 (a marca volta para W35): A não vendeu nela e tem as semanas intactas, então não é regravado.
  await pool.query(`update brsteel_ops.sku_weekly_demand set payload = payload - 'lastClosedWeek' where source_id = 'B'`);
  await repository.rollUpPendingWeeks(now, 600_000);
  const after = await snapshot();
  assert.equal(after.find(row => row.source_id === 'A')?.version, before.find(row => row.source_id === 'A')?.version);
  assert.equal(after.find(row => row.source_id === 'A')?.description, 'Ralo');
  assert.deepEqual((await repository.readWeeklyHistory(104)).get('A'), [{ week: '2026-W35', units: 3, orders: 1 }]);
  // Nova execução: só W36 em diante, nada além disso fica pendente.
  const again = await repository.rollUpPendingWeeks(now, 600_000);
  assert.ok(again.weeks.every(week => week >= '2026-W36'));
  assert.equal(again.remaining, 0);
  assert.deepEqual((await repository.readWeeklyHistory(104)).get('B'), [{ week: '2026-W36', units: 4, orders: 1 }]);
});

test('SQL weekly rollup prunes weeks outside the retention window, for SKUs not sold in the week too', async () => {
  await reset();
  const oldest = closedWeeksSince(null, now)[0];
  const [year, number] = oldest.split('-W').map(Number);
  const tooOld = `${year - 1}-W${String(number).padStart(2, '0')}`;
  const stale = { sku: 'OLD', weeks: { [tooOld]: { units: 9, orders: 1 }, [oldest]: { units: 1, orders: 1 } }, lastClosedWeek: oldest };
  const gone = { sku: 'GONE', weeks: { [tooOld]: { units: 9, orders: 1 } }, lastClosedWeek: tooOld };
  for (const payload of [stale, gone]) {
    await pool.query(`insert into brsteel_ops.sku_weekly_demand (source_id, payload, source_version, source_hash, import_run_id)
      values ($1, $2, 1, $3, $4)`, [payload.sku, JSON.stringify(payload), 'b'.repeat(64), NATIVE_RUN_ID]);
  }
  await seedOrder(1, '2026-09-01', [{ codigo: 'A', quantidade: 1 }]);
  const repository = createPostgresSkuWeeklyDemandRepository(writerPool);
  await repository.rollUpPendingWeeks(now, 600_000);
  const series = await repository.readWeeklyHistory(104);
  assert.deepEqual(series.get('OLD'), [{ week: oldest, units: 1, orders: 1 }]);
  assert.equal(series.get('GONE'), undefined);
  assert.deepEqual((await repository.readWeeklyHistory(0)).get('A'), []);
});

test('SQL weekly rollup stops at the time budget and reports what is left', async () => {
  await reset();
  await seedOrder(1, '2026-09-01', [{ codigo: 'A', quantidade: 1 }]);
  const repository = createPostgresSkuWeeklyDemandRepository(writerPool);
  const partial = await repository.rollUpPendingWeeks(now, 0);
  assert.equal(partial.weeks.length, 1);
  assert.ok(partial.remaining > 0);
});
