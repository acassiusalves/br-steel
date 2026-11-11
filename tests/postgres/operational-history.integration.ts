import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { COLLECTIONS, type OperationalSnapshot } from '../../src/server/migration/operational-snapshot';
import { createLocalImportPool, importSnapshot, verifySnapshot } from '../../src/server/migration/operational-import';

const url = process.env.BRSTEEL_PG_LOCAL_URL;
assert.ok(url);
const pool = new Pool({ connectionString: url, max: 2 });
const importPool = createLocalImportPool(url);
after(async () => { await importPool.end(); await pool.end(); });

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
