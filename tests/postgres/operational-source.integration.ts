import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { NATIVE_RUN_ID } from '../../src/server/migration/operational-snapshot';
import { operationalPoolConfig, readOperationalSource, resetOperationalSource } from '../../src/server/persistence/source';
import { salesReadRepository } from '../../src/server/persistence/sales';

const url = process.env.BRSTEEL_PG_LOCAL_URL;
assert.ok(url, 'Run through scripts/operational-postgres-local.mjs');
const pool = new Pool({ connectionString: url, max: 2 });
const app = initializeApp({ projectId: 'demo-brsteel-auth' }, 'source-integration');
const db = getFirestore(app);
const RUN = 'f'.repeat(64);

const setSource = async (source?: string) => {
  const ref = db.collection('appConfig').doc('operationalSource');
  if (source === undefined) await ref.delete(); else await ref.set({ source });
  resetOperationalSource();
};

after(async () => { await pool.end(); await deleteApp(app); resetOperationalSource(); });

test('the source defaults to Firestore and only changes for a value it recognises', async () => {
  await setSource(undefined);
  assert.equal(await readOperationalSource(), 'firestore', 'an absent record is not a switch');
  await setSource('mysql');
  assert.equal(await readOperationalSource(), 'firestore', 'a typo must not move the source');
  await setSource('postgres');
  assert.equal(await readOperationalSource(), 'postgres');
  await setSource('firestore');
  assert.equal(await readOperationalSource(), 'firestore');
});

test('a repository follows the record without a redeploy', async () => {
  await pool.query('truncate brsteel_import.runs cascade');
  await pool.query(`insert into brsteel_import.runs (id, source_project, captured_at, status, next_index, total_records, completed_at)
    values ($1, 'demo-brsteel-auth', now() - interval '1 hour', 'complete', 0, 0, now() - interval '1 hour')`, [RUN]);
  await pool.query(`insert into brsteel_import.state (singleton, source_project, active_run, ready, captured_at, completed_at)
    values (true, 'demo-brsteel-auth', $1, true, now() - interval '1 hour', now() - interval '1 hour')
    on conflict (singleton) do update set active_run = excluded.active_run, ready = true,
      captured_at = excluded.captured_at, completed_at = excluded.completed_at`, [RUN]);
  await pool.query(`insert into brsteel_import.runs (id, source_project, captured_at, status, next_index, total_records, completed_at)
    values ($1, 'brsteel-native', '-infinity', 'complete', 0, 0, '-infinity') on conflict (id) do nothing`, [NATIVE_RUN_ID]);
  await pool.query(`insert into brsteel_ops.sales_orders (source_id, payload, source_version, source_hash, import_run_id)
    values ('7', $1, 1, $2, $3)`,
    [JSON.stringify({ id: 7, numero: 7, data: '2026-09-01', total: 700, itens: [] }), 'a'.repeat(64), RUN]);
  await db.collection('salesOrders').doc('7').set({ id: 7, numero: 7, data: '2026-09-01', total: 999, itens: [] });

  process.env.BRSTEEL_OPERATIONAL_DATABASE_URL = url;
  await setSource('firestore');
  const before = await salesReadRepository.get('7');
  assert.equal(before.source, 'firestore');
  assert.equal(before.data.total, 999, 'Firestore holds 999');

  // The same module-level binding now answers from the other store: nothing was reimported.
  await setSource('postgres');
  const after = await salesReadRepository.get('7');
  assert.equal(after.source, 'postgres');
  assert.equal(after.data.total, 700, 'PostgreSQL holds 700');

  await setSource('firestore');
  assert.equal((await salesReadRepository.get('7')).source, 'firestore');
});

test('selecting PostgreSQL without a connection is unavailability, never a silent fall back', async () => {
  delete process.env.BRSTEEL_OPERATIONAL_DATABASE_URL;
  await setSource('postgres');
  await assert.rejects(salesReadRepository.get('7'), (error: unknown) => {
    const failure = error as { code?: string; status?: number };
    // Falling back to Firestore here would send reads — and later writes — to the store everyone
    // believes has been retired.
    return failure.code === 'UNAVAILABLE' && failure.status === 503;
  });
  process.env.BRSTEEL_OPERATIONAL_DATABASE_URL = url;
  await setSource('firestore');
});

test('the connection refuses a superuser, a missing password and a non-disposable local database', async () => {
  const refuses = (connection: string) => assert.throws(() => operationalPoolConfig(connection),
    (error: unknown) => (error as { code?: string }).code === 'UNAVAILABLE', connection);

  refuses('postgres://postgres:x@db.exemplo.supabase.co:5432/postgres');
  refuses('postgres://postgres.projeto:x@aws-0-sa-east-1.pooler.supabase.com:5432/postgres');
  refuses('postgres://brsteel_ops_writer@db.exemplo.supabase.co:5432/postgres');
  refuses('postgres://brsteel_ops_writer:x@db.exemplo.supabase.co:5432/postgres?sslmode=disable');
  refuses('postgres://alguem:x@127.0.0.1:5432/producao');
  refuses('mysql://brsteel_ops_writer:x@db.exemplo.supabase.co:5432/postgres');

  // A dedicated role over verified TLS is accepted, and TLS is not optional off loopback.
  const accepted = operationalPoolConfig('postgres://brsteel_ops_writer:senha@db.exemplo.supabase.co:5432/postgres');
  assert.equal(accepted.user, 'brsteel_ops_writer');
  assert.deepEqual(accepted.ssl, { rejectUnauthorized: true });
  assert.equal(accepted.statement_timeout, 30000);
});
