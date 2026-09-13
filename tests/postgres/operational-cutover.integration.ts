import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { NATIVE_RUN_ID } from '../../src/server/migration/operational-snapshot';
import { createLocalImportPool, importSnapshot } from '../../src/server/migration/operational-import';
import { exportOperationalSnapshot } from '../../src/server/migration/operational-export';
import { compareSources, reconcileFromFirestore } from '../../src/server/migration/operational-reconcile';
import { resetCoreWriteModeCache } from '../../src/server/operations/maintenance';

const url = process.env.BRSTEEL_PG_LOCAL_URL;
assert.ok(url, 'Run through scripts/operational-postgres-local.mjs');
const pool = new Pool({ connectionString: url, max: 2 });
const importPool = createLocalImportPool(url);
const app = initializeApp({ projectId: 'demo-brsteel-auth' }, 'cutover-integration');
const db = getFirestore(app);
const PROJECT = 'demo-brsteel-auth';

const order = (id: number, total: number) => ({ id, numero: id, data: '2026-09-01', total,
  contato: { id }, loja: { id: 0 }, situacao: { id: 0 }, itens: [{ codigo: 'A', descricao: 'Steel', quantidade: 1, valor: total }] });

async function resetBoth() {
  await pool.query('truncate brsteel_import.runs cascade');
  const wiped = await fetch('http://127.0.0.1:8188/emulator/v1/projects/demo-brsteel-auth/databases/(default)/documents', { method: 'DELETE' });
  assert.ok(wiped.ok);
  await db.collection('appConfig').doc('coreWriteMode').set({ mode: 'blocked' });
  resetCoreWriteModeCache();
}
const seedNativeRun = () => pool.query(
  `insert into brsteel_import.runs (id, source_project, captured_at, status, next_index, total_records, completed_at)
   values ($1, 'brsteel-native', '-infinity', 'complete', 0, 0, '-infinity') on conflict (id) do nothing`, [NATIVE_RUN_ID]);

before(async () => { assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188'); });
after(async () => { await importPool.end(); await pool.end(); await deleteApp(app); });

test('the comparator finds every seeded divergence and never invents one', async () => {
  await resetBoth();
  await db.collection('salesOrders').doc('1').set(order(1, 100));
  await db.collection('salesOrders').doc('2').set(order(2, 200));
  await db.collection('supplies').doc('s1').set({ nome: 'Chapa', codigo: 'SKU', estoqueAtual: 5 });
  await importSnapshot(importPool, await exportOperationalSnapshot(db, PROJECT));
  await seedNativeRun();

  // Identical sides: anything reported here would be the comparator inventing a difference.
  const clean = await compareSources(pool, db, PROJECT);
  assert.deepEqual(clean.divergences, [], JSON.stringify(clean.divergences));
  assert.deepEqual(clean.counts.salesOrders, { source: 2, copy: 2, native: 0 });

  // Four deliberate divergences, one of each kind the cutover can produce.
  await db.collection('salesOrders').doc('3').set(order(3, 300));                       // só na origem
  await db.collection('salesOrders').doc('1').set({ ...order(1, 100), total: 999 });    // conteúdo diferente
  await db.collection('supplies').doc('s1').delete();                                   // removido da origem
  await pool.query(`insert into brsteel_ops.stock_observations (source_id, payload, source_version, source_hash, import_run_id)
    values ('fantasma', '{"sku":"fantasma"}'::jsonb, 1, $1, $2)`, ['b'.repeat(64), NATIVE_RUN_ID]);  // nativo: não é divergência

  const dirty = await compareSources(pool, db, PROJECT);
  const found = dirty.divergences.map(d => `${d.collection}/${d.id}:${d.kind}`).sort();
  assert.deepEqual(found, [
    'salesOrders/1:content',
    'salesOrders/3:missing-in-copy',
    'supplies/s1:missing-in-source',
  ], JSON.stringify(dirty.divergences));

  // A native row is counted, not reported: it has no counterpart in Firestore by construction.
  assert.deepEqual(dirty.counts.stockUpdates, { source: 0, copy: 0, native: 1 });
});

test('reconciliation refuses unless the core is blocked, then brings divergence to zero', async () => {
  await resetBoth();
  await db.collection('salesOrders').doc('1').set(order(1, 100));
  await importSnapshot(importPool, await exportOperationalSnapshot(db, PROJECT));
  await seedNativeRun();

  // Changes that happened after the previous load, including a deletion.
  await db.collection('salesOrders').doc('1').set({ ...order(1, 100), total: 150 });
  await db.collection('salesOrders').doc('2').set(order(2, 200));

  for (const mode of ['open', 'draining']) {
    await db.collection('appConfig').doc('coreWriteMode').set({ mode });
    resetCoreWriteModeCache();
    await assert.rejects(reconcileFromFirestore(importPool, db, PROJECT), /blocked/i,
      `reconciling while ${mode} would describe a moment that never existed`);
  }
  assert.equal((await compareSources(pool, db, PROJECT)).divergences.length, 2, 'refusal must change nothing');

  await db.collection('appConfig').doc('coreWriteMode').set({ mode: 'blocked' });
  resetCoreWriteModeCache();
  await reconcileFromFirestore(importPool, db, PROJECT);
  const after = await compareSources(pool, db, PROJECT);
  assert.deepEqual(after.divergences, [], JSON.stringify(after.divergences));
  assert.deepEqual(after.counts.salesOrders, { source: 2, copy: 2, native: 0 });
});
