import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type DocumentData, type DocumentReference, type Firestore,
  type Transaction, type WriteBatch } from 'firebase-admin/firestore';
import { NATIVE_RUN_ID, contentHash } from '../../src/server/migration/operational-snapshot';
import { createLocalImportPool, importSnapshot } from '../../src/server/migration/operational-import';
import { exportOperationalSnapshot, jsonValue } from '../../src/server/migration/operational-export';
import { RETURN_COLLECTIONS, applyReturn, planReturn, returnBatches, timestampFromIso, verifyReturn,
  type ReturnPlan } from '../../src/server/migration/operational-return';
import { runReturn } from '../../src/server/migration/operational-return-run';
import { describeReturnTarget, openReturnTarget, returnIdentityRefusal } from '../../scripts/lib/return-target';

const url = process.env.BRSTEEL_PG_LOCAL_URL;
assert.ok(url, 'Run through scripts/operational-postgres-local.mjs');
const pool = new Pool({ connectionString: url, max: 2 });
const importPool = createLocalImportPool(url);
/**
 * The hosted return runs as `brsteel_pilot_importer`, which is NOINHERIT and holds no privilege of its own.
 * Its login is enabled only for this file, with a throwaway password, and disabled again in `after`.
 */
const PILOT_PASSWORD = randomBytes(18).toString('hex');
const pilotPool = (role: string) => {
  const login = new URL(url);
  login.username = role;
  login.password = PILOT_PASSWORD;
  return new Pool({ connectionString: login.toString(), max: 1 });
};
const PILOT_ROLES = ['brsteel_pilot_importer', 'brsteel_pilot_reader'];
let importerLogin: Pool, readerLogin: Pool;
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

before(async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
  for (const role of PILOT_ROLES) await pool.query(`alter role ${role} login password '${PILOT_PASSWORD}'`);
  importerLogin = pilotPool('brsteel_pilot_importer');
  readerLogin = pilotPool('brsteel_pilot_reader');
});
after(async () => {
  // The files share the emulator, and a later one would read a blocked core served from PostgreSQL.
  await setSwitches(null, null);
  await importerLogin.end(); await readerLogin.end();
  // Pilot logins start disabled, and a later file asserts it.
  for (const role of PILOT_ROLES) await pool.query(`alter role ${role} nologin password null`);
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

test('writes are split at 400 operations and before a batch would pass 4,000,000 bytes', () => {
  const lengths = (batches: number[][]) => batches.map(batch => batch.length);
  assert.deepEqual(lengths(returnBatches(Array<number>(801).fill(0), size => size)), [400, 400, 1]);
  assert.deepEqual(returnBatches([3_000_000, 1_000_000, 1], size => size), [[3_000_000, 1_000_000], [1]]);
  // A write larger than the cap still goes, alone, so Firestore is the one to judge it.
  assert.deepEqual(returnBatches([1, 4_500_000, 1], size => size), [[1], [4_500_000], [1]]);
  assert.deepEqual(returnBatches([], size => size), []);
});

test('an apply larger than one batch converges', async () => {
  await seedScenario();
  const bulk = Array.from({ length: 401 }, (_, index) => ({ id: `bulk-${String(index).padStart(3, '0')}`,
    payload: { nome: 'Lote', codigo: `BULK-${index}`, estoqueAtual: index } }));
  await pool.query(`insert into brsteel_ops.supplies (source_id, payload, source_version, source_hash, import_run_id, lookup_sku)
    select id, payload, 1, hash, $5, sku from unnest($1::text[], $2::jsonb[], $3::text[], $4::text[]) as row(id, payload, hash, sku)`,
  [bulk.map(row => row.id), bulk.map(row => JSON.stringify(row.payload)), bulk.map(row => contentHash(row.payload)),
    bulk.map(row => row.payload.codigo), NATIVE_RUN_ID]);
  await setSwitches('postgres', 'blocked');

  const applied = await applyReturn(pool, db);
  assert.equal(applied.changes.length, EXPECTED_CHANGES.length + bulk.length);
  assert.deepEqual((await verifyReturn(pool, db)).changes, []);
  assert.equal((await db.collection('supplies').get()).size, 2 + bulk.length);
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

test('a timestamp string Firestore could not store exactly stays a string so the return converges', async () => {
  await seedScenario();
  const strings = {
    // The export never writes a whole second without its fraction.
    '7a2d3b5f-9c4e-4d6f-8a1b-2c3d4e5f6a70': '2028-11-11T12:00:00Z',
    // Canonical, but Firestore keeps microseconds and would store .123456000Z.
    '8b3e4c6a-0d5f-4e7a-9b2c-3d4e5f6a7b81': '2028-11-11T12:00:00.123456789Z',
  };
  for (const [id, expiresAt] of Object.entries(strings)) {
    const observation = { ...nativeObservation, expiresAt };
    await pool.query(`insert into brsteel_ops.stock_observation_log (source_id, payload, source_version, source_hash, import_run_id)
      values ($1, $2, 1, $3, $4)`, [id, JSON.stringify(observation), contentHash(observation), NATIVE_RUN_ID]);
  }
  await setSwitches('postgres', 'blocked');
  await applyReturn(pool, db);
  for (const [id, expiresAt] of Object.entries(strings)) {
    assert.equal((await db.collection('stockObservations').doc(id).get()).data()?.expiresAt, expiresAt);
  }
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

const switchRecords = async () => {
  const [source, mode] = await Promise.all(['operationalSource', 'coreWriteMode'].map(id => db.collection('appConfig').doc(id).get()));
  return { source: source.data(), mode: mode.data() };
};

/** Stands in for the clock and the terminal, and records what the switches held at every pause. */
function recorder() {
  const waits: number[] = [], states: string[] = [], lines: string[] = [];
  const wait = async (seconds: number) => {
    waits.push(seconds);
    const { source, mode } = await switchRecords();
    states.push(`${source?.source ?? '-'}/${mode?.mode ?? '-'}`);
  };
  return { waits, states, lines, wait, log: (line: string) => { lines.push(line); } };
}

/** `target` with some members replaced; everything else is forwarded, bound to the real object. */
const forward = <T extends object>(target: T, overrides: object) => new Proxy(target, {
  get(object, property) {
    if (Object.prototype.hasOwnProperty.call(overrides, property)) return Reflect.get(overrides, property);
    const value = Reflect.get(object, property, object);
    return typeof value === 'function' ? value.bind(object) : value;
  },
});

/** The real database, except that every batch goes through `wrap`; reads and the appConfig records are untouched. */
function withBatches(real: Firestore, wrap: (batch: WriteBatch) => object): Firestore {
  return forward(real, { batch: () => { const batch = real.batch(); return forward(batch, wrap(batch)); } });
}

/** The real database, except that another window writes `coreWriteMode` just before the return creates it. */
function withRacingWindow(real: Firestore, seeded: DocumentData): Firestore {
  return forward(real, { collection: (name: string) => {
    const collection = real.collection(name);
    return name !== 'appConfig' ? collection : forward(collection, { doc: (id: string) => {
      const ref = collection.doc(id);
      return id !== 'coreWriteMode' ? ref
        : forward(ref, { create: async (data: DocumentData) => { await ref.set(seeded); return ref.create(data); } });
    } });
  } });
}

test('the automated return mirrors PostgreSQL, switches the source back and reopens the core', async () => {
  await seedScenario();
  await setSwitches('postgres', null);
  const run = recorder();
  const control = { aborted: false, opened: false, sourceDeleted: false };

  const outcome = await runReturn({ pool, db, wait: run.wait, log: run.log, control });
  assert.equal(outcome.status, 'returned');
  assert.deepEqual(control, { aborted: false, opened: true, sourceDeleted: true });
  assert.deepEqual(listed(outcome.plan!), EXPECTED_CHANGES);
  assert.deepEqual(run.waits, [20, 10, 10]);
  assert.deepEqual(run.states, ['postgres/draining', 'postgres/blocked', '-/blocked'],
    'the source goes back only after the apply, and the core stays blocked while the selector cache expires');
  assert.deepEqual(await switchRecords(), { source: undefined, mode: undefined });
  assert.deepEqual((await planReturn(pool, db)).changes, []);

  assert.ok(run.lines.some(line => /salesOrders\s+postgres 2 \| firestore 2 \| criar 0 \| atualizar 1 \| apagar 0/.test(line)),
    'every step reports counts per collection');
  assert.ok(run.lines.some(line => line.includes('productionLots/lot-1: delete')));
  assert.ok(!run.lines.some(line => /Chapa|Tubo|Steel/.test(line)), 'the log never carries document content');
});

test('the pre-flight aborts without writing when the maintenance record already exists', async () => {
  await seedScenario();
  await setSwitches('postgres', null);
  // `open` parses like an absent record; only the record's absence proves no other window is open.
  const seeded = { mode: 'open', updatedAt: '2026-11-11T10:00:00.000Z' };
  await db.collection('appConfig').doc('coreWriteMode').set(seeded);
  const before = await planReturn(pool, db);
  const run = recorder();

  const outcome = await runReturn({ pool, db, wait: run.wait, log: run.log });
  assert.equal(outcome.status, 'aborted');
  assert.match(outcome.reason!, /coreWriteMode/);
  assert.deepEqual(run.waits, []);
  assert.deepEqual(await switchRecords(), { source: { source: 'postgres' }, mode: seeded });
  assert.deepEqual(await planReturn(pool, db), before);
});

test('the pre-flight aborts when the target still serves from Firestore', async () => {
  await seedScenario();
  await setSwitches('firestore', null);
  const run = recorder();

  const outcome = await runReturn({ pool, db, wait: run.wait, log: run.log });
  assert.equal(outcome.status, 'aborted');
  assert.match(outcome.reason!, /firestore/);
  assert.deepEqual(run.waits, []);
  assert.deepEqual(await switchRecords(), { source: { source: 'firestore' }, mode: undefined });
});

test('the pre-flight aborts when the copy is not ready', async () => {
  await seedScenario();
  await setSwitches('postgres', null);
  await pool.query('update brsteel_import.state set ready = false');
  const run = recorder();

  const outcome = await runReturn({ pool, db, wait: run.wait, log: run.log });
  assert.equal(outcome.status, 'aborted');
  assert.match(outcome.reason!, /ready/);
  assert.deepEqual(run.waits, []);
  assert.deepEqual(await switchRecords(), { source: { source: 'postgres' }, mode: undefined });
});

test('a plan that fails in the pre-flight aborts without writing', async () => {
  await seedScenario();
  await setSwitches('postgres', null);
  await db.collection('supplies').doc('s1').set({ nome: 'segredo-do-cliente', codigo: 'SKU', estoqueAtual: Number.NaN });
  const run = recorder();

  const outcome = await runReturn({ pool, db, wait: run.wait, log: run.log });
  assert.equal(outcome.status, 'aborted');
  assert.match(outcome.reason!, /supplies\/s1/);
  assert.ok(!run.lines.some(line => line.includes('segredo-do-cliente')));
  assert.deepEqual(run.waits, []);
  assert.deepEqual(await switchRecords(), { source: { source: 'postgres' }, mode: undefined });
  assert.equal((await db.collection('supplies').doc('native-supply').get()).exists, false);
});

test('a failure during the apply keeps the source on PostgreSQL, hides the SDK error and reopens the core', async () => {
  await seedScenario();
  await setSwitches('postgres', null);
  const failing = withBatches(db, () => ({ commit: async () => { throw new Error('UNAVAILABLE segredo-do-cliente'); } }));
  const run = recorder();

  const outcome = await runReturn({ pool, db: failing, wait: run.wait, log: run.log });
  assert.equal(outcome.status, 'failed');
  assert.ok(outcome.reason);
  assert.ok(![outcome.reason, ...run.lines].some(line => line.includes('segredo-do-cliente')), 'a raw SDK error is never passed on');
  assert.deepEqual(run.waits, [20, 10]);
  assert.deepEqual(await switchRecords(), { source: { source: 'postgres' }, mode: undefined });
});

test('a divergence after the apply keeps the source on PostgreSQL, names the document and reopens the core', async () => {
  await seedScenario();
  await setSwitches('postgres', null);
  const dropped = 'supplies/native-supply';
  const dropping = withBatches(db, batch => ({
    set: (ref: DocumentReference, data: DocumentData) => ref.path === dropped ? batch : batch.set(ref, data) }));
  const run = recorder();

  const outcome = await runReturn({ pool, db: dropping, wait: run.wait, log: run.log });
  assert.equal(outcome.status, 'divergent');
  assert.deepEqual(outcome.divergences, [{ collection: 'supplies', id: 'native-supply', kind: 'create' }]);
  assert.ok(run.lines.some(line => line.includes(`${dropped}: create`)));
  assert.deepEqual(run.waits, [20, 10]);
  assert.deepEqual(await switchRecords(), { source: { source: 'postgres' }, mode: undefined });
});

test('a window opened by someone else after the pre-flight aborts the return and is left in place', async () => {
  await seedScenario();
  await setSwitches('postgres', null);
  const seeded = { mode: 'blocked', updatedAt: '2026-11-11T10:00:00.000Z' };
  const run = recorder();
  const control = { aborted: false, opened: false, sourceDeleted: false };

  const outcome = await runReturn({ pool, db: withRacingWindow(db, seeded), wait: run.wait, log: run.log, control });
  assert.equal(outcome.status, 'aborted');
  assert.match(outcome.reason!, /coreWriteMode/);
  assert.equal(control.opened, false, 'a signal handler must not reopen a window this run did not create');
  assert.deepEqual(run.waits, []);
  assert.deepEqual(await switchRecords(), { source: { source: 'postgres' }, mode: seeded });
});

test('an interruption before the switch keeps the source on PostgreSQL and reopens the core', async () => {
  await seedScenario();
  await setSwitches('postgres', null);
  const run = recorder();
  const control = { aborted: false, opened: false, sourceDeleted: false };
  // The signal arrives while the core is blocked; the run reaches the switch and must not take it.
  const wait = async (seconds: number) => { await run.wait(seconds); if (run.waits.length === 2) control.aborted = true; };

  const outcome = await runReturn({ pool, db, wait, log: run.log, control });
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.reason!, /interrompido/);
  assert.deepEqual(control, { aborted: true, opened: true, sourceDeleted: false });
  assert.deepEqual(run.waits, [20, 10]);
  assert.deepEqual(await switchRecords(), { source: { source: 'postgres' }, mode: undefined });
});

test('the source is switched only while the core is still blocked, read in the same transaction', async () => {
  await seedScenario();
  await setSwitches('postgres', null);
  // Someone reopens the core by hand while the return runs.
  const reopening = forward(db, { runTransaction: async (update: (transaction: Transaction) => Promise<unknown>) => {
    await db.collection('appConfig').doc('coreWriteMode').set({ mode: 'open' });
    return db.runTransaction(update);
  } });
  const run = recorder();
  const control = { aborted: false, opened: false, sourceDeleted: false };

  const outcome = await runReturn({ pool, db: reopening, wait: run.wait, log: run.log, control });
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.reason!, /não está mais bloqueado/);
  assert.equal(control.sourceDeleted, false);
  assert.deepEqual(await switchRecords(), { source: { source: 'postgres' }, mode: undefined });
});

test('an idle-connection error on the CLI pool cannot crash the process', async () => {
  const target = openReturnTarget(url, PROJECT);
  try {
    assert.doesNotThrow(() => target.pool.emit('error', new Error('idle client terminated')));
  } finally {
    await target.close();
  }
});

test('an invalid PostgreSQL id is quoted and shortened in the message', async () => {
  await seedScenario();
  const id = `a/b\n${'x'.repeat(150)}`;
  await pool.query(`insert into brsteel_ops.supplies (source_id, payload, source_version, source_hash, import_run_id, lookup_sku)
    values ($1, $2, 1, $3, $4, 'BAD')`, [id, JSON.stringify(nativeSupply), contentHash(nativeSupply), NATIVE_RUN_ID]);
  await assert.rejects(planReturn(pool, db), {
    message: `Identificador inválido no PostgreSQL: supplies/${JSON.stringify(id).slice(0, 80)}.` });
});

test('the plan and the whole return work through the NOINHERIT importer login', async () => {
  await seedScenario();
  const identity = (await importerLogin.query(`select session_user::text login,
    pg_has_role(session_user, 'brsteel_ops_importer', 'usage') inherited`)).rows[0];
  assert.deepEqual(identity, { login: 'brsteel_pilot_importer', inherited: false }, 'the login holds no privilege of its own');
  assert.deepEqual(listed(await planReturn(importerLogin, db)), EXPECTED_CHANGES);

  await setSwitches('postgres', null);
  const run = recorder();
  const outcome = await runReturn({ pool: importerLogin, db, wait: run.wait, log: run.log });
  assert.equal(outcome.status, 'returned', outcome.reason);
  assert.deepEqual((await verifyReturn(importerLogin, db)).changes, []);
});

test('the CLI reads the copy origin through the importer login', async () => {
  await seedScenario();
  const describe = async (project: string) => {
    const lines: string[] = [];
    await describeReturnTarget({ project, db, pool: importerLogin, close: async () => undefined }, line => { lines.push(line); });
    return lines;
  };
  assert.deepEqual(await describe(PROJECT), [`projeto de destino: ${PROJECT}`, `origem da cópia: ${PROJECT}`]);
  assert.deepEqual(await describe('demo-outro'),
    ['projeto de destino: demo-outro', `origem da cópia: ${PROJECT}`, 'destino diferente da origem da cópia: ensaio']);
});

test('the CLI identity check accepts only the importer login itself', async () => {
  assert.equal(await returnIdentityRefusal(importerLogin), null);
  assert.match((await returnIdentityRefusal(pool))!, /superuser=true/);
  assert.match((await returnIdentityRefusal(readerLogin))!, /brsteel_pilot_reader não é membro de brsteel_ops_importer/);
});
