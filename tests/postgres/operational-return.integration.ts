import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { NATIVE_RUN_ID, contentHash } from '../../src/server/migration/operational-snapshot';
import { createLocalImportPool, importSnapshot } from '../../src/server/migration/operational-import';
import { exportOperationalSnapshot, jsonValue } from '../../src/server/migration/operational-export';
import { RETURN_COLLECTIONS, applyReturn, planReturn, timestampFromIso, verifyReturn,
  type ReturnPlan } from '../../src/server/migration/operational-return';

const url = process.env.BRSTEEL_PG_LOCAL_URL;
assert.ok(url, 'Run through scripts/operational-postgres-local.mjs');
const pool = new Pool({ connectionString: url, max: 2 });
const importPool = createLocalImportPool(url);
const app = initializeApp({ projectId: 'demo-brsteel-auth' }, 'return-integration');
const db = getFirestore(app);
const PROJECT = 'demo-brsteel-auth';

const order = (id: number, total: number) => ({ id, numero: id, data: '2026-09-01', total,
  contato: { id }, loja: { id: 0 }, situacao: { id: 0 }, itens: [{ codigo: 'A', descricao: 'Steel', quantidade: 1, valor: total }] });
const stockCreatedAt = new Timestamp(1789207200, 123456000);
const stockUpdate = (sku: string, estoqueAtual: number) => ({ sku, nome: 'Chapa', estoqueAtual,
  webhookReceivedAt: '2026-09-12T10:00:00.000Z', createdAt: stockCreatedAt });
const weeklyDemand = { sku: 'A', weeks: { '2026-W35': { units: 4, orders: 2 } }, lastClosedWeek: '2026-W35' };
const outOfDomainCounter = { value: 7 };
const nativeSupply = { nome: 'Tubo', codigo: 'TUBO', estoqueAtual: 2 };
const OBSERVATION_ID = '6f1c2a4e-8b3d-4c5e-9f7a-1b2c3d4e5f60';
const OBSERVATION_EXPIRES_AT = '2028-11-11T12:00:00.000Z';
const nativeObservation = { sku: 'A', estoqueAtual: 4, observedAt: '2026-11-11T11:00:00.000Z', event: 'stock.updated',
  source: 'webhook', expiresAt: OBSERVATION_EXPIRES_AT };

async function resetBoth() {
  await pool.query('truncate brsteel_import.runs cascade');
  const wiped = await fetch('http://127.0.0.1:8188/emulator/v1/projects/demo-brsteel-auth/databases/(default)/documents', { method: 'DELETE' });
  assert.ok(wiped.ok);
}
const seedNativeRun = () => pool.query(
  `insert into brsteel_import.runs (id, source_project, captured_at, status, next_index, total_records, completed_at)
   values ($1, 'brsteel-native', '-infinity', 'complete', 0, 0, '-infinity') on conflict (id) do nothing`, [NATIVE_RUN_ID]);
// Half an hour back: the Node clock can run ahead of the container's `now()`, which stamps completed_at.
const backdated = <T extends { capturedAt: string }>(snapshot: T): T =>
  ({ ...snapshot, capturedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString() });
const setSwitches = async (source: string | null, mode: string | null) => {
  const config = db.collection('appConfig');
  await (source === null ? config.doc('operationalSource').delete() : config.doc('operationalSource').set({ source }));
  await (mode === null ? config.doc('coreWriteMode').delete() : config.doc('coreWriteMode').set({ mode }));
};

before(async () => { assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188'); });
after(async () => {
  // The files share the emulator, and a later one would read a blocked core served from PostgreSQL.
  await setSwitches(null, null);
  await importPool.end(); await pool.end(); await deleteApp(app);
});

/**
 * Loads the copy from Firestore, then plays in PostgreSQL what the application would do after the
 * cutover: native rows, an edited order, a lot deleted for real, an edited stock document that carries a
 * Firestore timestamp, and an edited weekly demand row the return must leave alone.
 */
async function seedScenario() {
  await resetBoth();
  await db.collection('salesOrders').doc('1').set(order(1, 100));
  await db.collection('salesOrders').doc('2').set(order(2, 200));
  await db.collection('productionColumns').doc('queue').set({ name: 'Fila', order: 0, color: '#000000' });
  await db.collection('productionLots').doc('lot-1').set({ columnId: 'queue', linkedOrderIds: [1], lotNumber: 1 });
  await db.collection('productionLots').doc('lot-2').set({ columnId: 'queue', linkedOrderIds: [2], lotNumber: 2 });
  await db.collection('productionLotItems').doc('item-1').set({ lotId: 'lot-1', sourceOrderId: '1', sku: 'A' });
  await db.collection('productionLotItems').doc('item-2').set({ lotId: 'lot-1', sourceOrderId: '1', sku: 'B' });
  await db.collection('operationsMetadata').doc('production-lots-2026').set({ lastNumber: 2 });
  await db.collection('operationsMetadata').doc('outro-contador').set(outOfDomainCounter);
  await db.collection('supplies').doc('s1').set({ nome: 'Chapa', codigo: 'SKU', estoqueAtual: 5 });
  await db.collection('stockUpdates').doc('still').set(stockUpdate('A', 3));
  await db.collection('stockUpdates').doc('changed').set(stockUpdate('B', 7));
  await db.collection('skuWeeklyDemand').doc('A').set(weeklyDemand);
  await importSnapshot(importPool, backdated(await exportOperationalSnapshot(db, PROJECT)));
  await seedNativeRun();

  await pool.query(`insert into brsteel_ops.supplies (source_id, payload, source_version, source_hash, import_run_id, lookup_sku)
    values ('native-supply', $1, 1, $2, $3, 'TUBO')`, [JSON.stringify(nativeSupply), contentHash(nativeSupply), NATIVE_RUN_ID]);
  await pool.query(`insert into brsteel_ops.stock_observation_log (source_id, payload, source_version, source_hash, import_run_id)
    values ($1, $2, 1, $3, $4)`, [OBSERVATION_ID, JSON.stringify(nativeObservation), contentHash(nativeObservation), NATIVE_RUN_ID]);
  const edited = { ...order(1, 100), total: 150 };
  await pool.query(`update brsteel_ops.sales_orders set payload = $1, source_hash = $2 where source_id = '1'`,
    [JSON.stringify(edited), contentHash(edited)]);
  await pool.query(`delete from brsteel_ops.production_lot_items where lot_id = 'lot-1'`);
  await pool.query(`delete from brsteel_ops.production_lots where source_id = 'lot-1'`);
  const changedStock = { ...jsonValue(stockUpdate('B', 7)) as Record<string, unknown>, estoqueAtual: 9 };
  await pool.query(`update brsteel_ops.stock_observations set payload = $1, source_hash = $2 where source_id = 'changed'`,
    [JSON.stringify(changedStock), contentHash(changedStock)]);
  await pool.query(`update brsteel_ops.sku_weekly_demand set payload = jsonb_set(payload, '{lastClosedWeek}', '"2026-W36"')
    where source_id = 'A'`);
}

const EXPECTED_CHANGES = [
  'productionLotItems/item-1:delete',
  'productionLotItems/item-2:delete',
  'productionLots/lot-1:delete',
  'salesOrders/1:update',
  `stockObservations/${OBSERVATION_ID}:create`,
  'stockUpdates/changed:update',
  'supplies/native-supply:create',
];
const listed = (plan: ReturnPlan) => plan.changes.map(change => `${change.collection}/${change.id}:${change.kind}`).sort();
const updateTime = async (ref: DocumentReference) => (await ref.get()).updateTime;

test('the plan lists exactly what diverged and nothing outside the return domain', async () => {
  await seedScenario();
  const plan = await planReturn(pool, db);
  assert.deepEqual(listed(plan), EXPECTED_CHANGES);
  assert.deepEqual(Object.keys(plan.counts), RETURN_COLLECTIONS);
  assert.ok(!RETURN_COLLECTIONS.includes('skuWeeklyDemand'));
  assert.deepEqual(plan.counts.salesOrders, { postgres: 2, firestore: 2, create: 0, update: 1, delete: 0 });
  assert.deepEqual(plan.counts.productionLotItems, { postgres: 0, firestore: 2, create: 0, update: 0, delete: 2 });
  assert.deepEqual(plan.counts.supplies, { postgres: 2, firestore: 1, create: 1, update: 0, delete: 0 });
  assert.deepEqual(plan.counts.stockUpdates, { postgres: 2, firestore: 2, create: 0, update: 1, delete: 0 });
  // The counter outside `production-lots-YYYY` is neither counted nor touched.
  assert.deepEqual(plan.counts.operationsMetadata, { postgres: 1, firestore: 1, create: 0, update: 0, delete: 0 });
});

test('apply refuses unless the target serves from PostgreSQL with the core blocked, and writes nothing', async () => {
  await seedScenario();
  const before = await planReturn(pool, db);

  await setSwitches(null, 'blocked');
  await assert.rejects(applyReturn(pool, db), {
    message: 'O retorno só grava num Firestore cuja fonte ativa é postgres; a fonte é firestore.' });
  for (const mode of [null, 'open', 'draining']) {
    await setSwitches('postgres', mode);
    await assert.rejects(applyReturn(pool, db), {
      message: `O retorno exige o núcleo bloqueado; o modo é ${mode ?? 'open'}.` });
  }
  assert.deepEqual(await planReturn(pool, db), before, 'a refusal must not write anything');
});

test('apply makes Firestore equal to PostgreSQL and restores Firestore timestamps', async () => {
  await seedScenario();
  const untouched = [db.collection('stockUpdates').doc('still'), db.collection('operationsMetadata').doc('outro-contador'),
    db.collection('skuWeeklyDemand').doc('A')];
  const untouchedTimes = await Promise.all(untouched.map(updateTime));
  await setSwitches('postgres', 'blocked');

  const applied = await applyReturn(pool, db);
  assert.deepEqual(listed(applied), EXPECTED_CHANGES);

  assert.equal((await db.collection('salesOrders').doc('1').get()).data()?.total, 150);
  assert.equal((await db.collection('productionLots').doc('lot-1').get()).exists, false);
  assert.equal((await db.collection('productionLotItems').doc('item-1').get()).exists, false);
  assert.equal((await db.collection('productionLotItems').doc('item-2').get()).exists, false);
  assert.equal((await db.collection('productionLots').doc('lot-2').get()).exists, true);
  assert.deepEqual((await db.collection('supplies').doc('native-supply').get()).data(), nativeSupply);

  const observation = (await db.collection('stockObservations').doc(OBSERVATION_ID).get()).data();
  assert.ok(observation?.expiresAt instanceof Timestamp, 'the TTL policy ignores strings');
  assert.ok(observation.expiresAt.isEqual(Timestamp.fromMillis(Date.parse(OBSERVATION_EXPIRES_AT))));
  assert.equal(observation.observedAt, nativeObservation.observedAt);

  const still = (await db.collection('stockUpdates').doc('still').get()).data();
  assert.ok(still?.createdAt instanceof Timestamp && still.createdAt.isEqual(stockCreatedAt));
  const changed = (await db.collection('stockUpdates').doc('changed').get()).data();
  assert.equal(changed?.estoqueAtual, 9);
  assert.ok(changed?.createdAt instanceof Timestamp && changed.createdAt.isEqual(stockCreatedAt),
    'an update keeps a top-level Firestore timestamp a timestamp');
  assert.equal(changed.webhookReceivedAt, '2026-09-12T10:00:00.000Z');

  assert.deepEqual((await untouched[1].get()).data(), outOfDomainCounter);
  assert.deepEqual((await untouched[2].get()).data(), weeklyDemand);
  const afterTimes = await Promise.all(untouched.map(updateTime));
  untouched.forEach((ref, index) => assert.ok(afterTimes[index]?.isEqual(untouchedTimes[index]!), `${ref.path} was rewritten`));
});

test('after a complete apply the verification is clean and repeating changes nothing', async () => {
  await seedScenario();
  await setSwitches('postgres', 'blocked');
  await applyReturn(pool, db);

  const verified = await verifyReturn(pool, db);
  assert.deepEqual(verified.changes, []);
  assert.deepEqual(verified.counts.supplies, { postgres: 2, firestore: 2, create: 0, update: 0, delete: 0 });
  assert.deepEqual((await applyReturn(pool, db)).changes, []);
});

test('a document that cannot be compared is named by collection and id only', async () => {
  await seedScenario();
  await db.collection('supplies').doc('s1').set({ nome: 'segredo-do-cliente', codigo: 'SKU', estoqueAtual: Number.NaN });
  await assert.rejects(planReturn(pool, db), (error: Error) => {
    assert.match(error.message, /supplies\/s1/);
    assert.doesNotMatch(error.message, /segredo-do-cliente/);
    return true;
  });
});

test('a timestamp string the export would never produce stays a string so the return converges', async () => {
  await seedScenario();
  const id = '7a2d3b5f-9c4e-4d6f-8a1b-2c3d4e5f6a70';
  const observation = { ...nativeObservation, expiresAt: '2028-11-11T12:00:00Z' };
  await pool.query(`insert into brsteel_ops.stock_observation_log (source_id, payload, source_version, source_hash, import_run_id)
    values ($1, $2, 1, $3, $4)`, [id, JSON.stringify(observation), contentHash(observation), NATIVE_RUN_ID]);
  await setSwitches('postgres', 'blocked');
  await applyReturn(pool, db);
  assert.equal((await db.collection('stockObservations').doc(id).get()).data()?.expiresAt, '2028-11-11T12:00:00Z');
  assert.deepEqual((await verifyReturn(pool, db)).changes, []);
});

test('ISO strings become timestamps as the exact inverse of the export normalization', () => {
  const seconds = Date.UTC(2026, 8, 12, 3, 0, 0) / 1000;
  const parts = (value: string) => {
    const timestamp = timestampFromIso(value);
    return timestamp && { seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds };
  };
  assert.deepEqual(parts('2026-09-12T03:00:00.123Z'), { seconds, nanoseconds: 123000000 });
  assert.deepEqual(parts('2026-09-12T03:00:00.123456789Z'), { seconds, nanoseconds: 123456789 });
  assert.deepEqual(parts('2026-09-12T03:00:00Z'), { seconds, nanoseconds: 0 });
  assert.equal(timestampFromIso('2026-09-12T03:00:00-03:00'), null);
  assert.equal(timestampFromIso('x'), null);
  assert.equal(jsonValue(timestampFromIso('2026-09-12T03:00:00.123456789Z')), '2026-09-12T03:00:00.123456789Z');
});
