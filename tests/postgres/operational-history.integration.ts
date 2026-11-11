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
