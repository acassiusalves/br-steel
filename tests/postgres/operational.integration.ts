import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import { COLLECTIONS, type OperationalSnapshot } from '../../src/server/migration/operational-snapshot';
import { createLocalImportPool, importSnapshot, verifySnapshot } from '../../src/server/migration/operational-import';
import { createPostgresSalesRepository } from '../../src/server/persistence/postgres-sales';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { exportOperationalSnapshot } from '../../src/server/migration/operational-export';
import { firestoreSalesReadRepository } from '../../src/server/persistence/firestore-sales';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.env.BRSTEEL_PG_LOCAL_URL;
assert.ok(url, 'Run through scripts/operational-postgres-local.mjs');
const pool = createLocalImportPool(url);
const readerPool = new Pool({ connectionString: url, max: 2, options: '-c role=brsteel_ops_reader' });
const sales = createPostgresSalesRepository(readerPool);
before(async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
  await pool.query('truncate brsteel_import.runs cascade');
  const reset = await fetch('http://127.0.0.1:8188/emulator/v1/projects/demo-brsteel-auth/databases/(default)/documents', { method: 'DELETE' });
  assert.ok(reset.ok);
});
after(async () => { await readerPool.end(); await pool.end(); });

const snapshot = (): OperationalSnapshot => ({ formatVersion: 1, sourceProject: 'demo-brsteel-auth', capturedAt: '2026-09-12T12:00:00.000Z',
  completeCollections: [...COLLECTIONS], records: [
    ...[[1, '2026-09-01', 100], [2, '2026-09-02', 200], [3, '2026-08-31', 150]].map(([n, date, amount]) => ({
      collection: 'salesOrders' as const, id: String(n), version: '100', data: { id: n, data: date, total: amount, contato: { id: n },
        loja: { id: 0 }, situacao: { id: 0 }, itens: [{ codigo: 'A', descricao: 'Steel', quantidade: 2, valor: Number(amount) / 2 }] },
    })),
    { collection: 'stockUpdates', id: 'A', version: '100', data: { sku: 'A', estoqueAtual: 0, webhookReceivedAt: '2026-09-12T10:00:00Z' } },
    { collection: 'supplies', id: 's', version: '100', data: { nome: 'Steel', codigo: 'A', estoqueAtual: 0, estoqueMinimo: null } },
    { collection: 'supplyCodes', id: 'code', version: '100', data: { supplyId: 's' } },
    { collection: 'inventoryMovements', id: 'm', version: '100', data: { supplyId: 's', quantity: 1, type: 'entrada' } },
    { collection: 'productionColumns', id: 'c', version: '100', data: { name: 'Fila', order: 0 } },
    { collection: 'operationsMetadata', id: 'production-lots-2026', version: '100', data: { sequence: 1 } },
    { collection: 'productionLots', id: 'l', version: '100', data: { columnId: 'c', linkedOrderIds: ['1'], lotNumber: 'LOT-2026-0001' } },
    { collection: 'productionLotItems', id: 'i', version: '100', data: { lotId: 'l', sourceOrderId: '1', quantity: 1, sku: 'A' } },
    { collection: 'productionComments', id: 'comment', version: '100', data: { lotId: 'l', content: 'Local test', author: { userId: 'local' } } },
  ] });
let exportedSnapshot: OperationalSnapshot;
const baseline = () => structuredClone(exportedSnapshot);
const later = (minutes: number) => new Date(Date.parse(exportedSnapshot.capturedAt)+minutes*60000).toISOString();

test('local destination guard rejects hosted and ambiguous connections', () => {
  for (const candidate of ['postgresql://postgres@example.com/brsteel_ops_local', 'postgresql://postgres@127.0.0.1:5432/postgres',
    'postgresql://postgres@127.0.0.1:55436/brsteel_ops_local?options=unsafe']) assert.throws(() => createLocalImportPool(candidate));
});

test('exports the allowlisted Firestore data and SQL matches the same source', async () => {
  const app=initializeApp({ projectId:'demo-brsteel-auth' },'export-integration');
  try {
    const db=getFirestore(app), input=snapshot();
    for (const row of input.records) await db.collection(row.collection).doc(row.id).set(row.data);
    await db.collection('users').doc('private').set({ passwordHash:'DO-NOT-EXPORT' });
    await db.collection('operationsMetadata').doc('other-module').set({ secret:'DO-NOT-EXPORT' });
    const seconds = Date.parse('2026-09-12T10:00:00Z') / 1000;
    await db.collection('stockUpdates').doc('A').update({ createdAt: new Timestamp(seconds, 0),
      preciseFirst: new Timestamp(seconds, 1000), preciseSecond: new Timestamp(seconds, 2000),
      beforeMidnight: new Timestamp(Date.parse('2026-09-12T23:59:59Z') / 1000, 999500000) });
    const exported=await exportOperationalSnapshot(db,'demo-brsteel-auth');
    exportedSnapshot=exported;
    assert.equal(exported.records.length,12);
    assert.ok(!JSON.stringify(exported).includes('DO-NOT-EXPORT'));
    assert.equal(exported.records.find(r=>r.collection==='stockUpdates')!.data.createdAt,'2026-09-12T10:00:00.000Z');
    assert.equal(exported.records.find(r=>r.collection==='stockUpdates')!.data.preciseFirst,'2026-09-12T10:00:00.000001000Z');
    assert.equal(exported.records.find(r=>r.collection==='stockUpdates')!.data.preciseSecond,'2026-09-12T10:00:00.000002000Z');
    assert.equal(exported.records.find(r=>r.collection==='stockUpdates')!.data.beforeMidnight,'2026-09-12T23:59:59.999500000Z');
    assert.ok(exported.records.every(r=>/^\d+$/.test(r.version)));
    // Compare against the emulator before the independent import lifecycle tests below.
    const actual=await firestoreSalesReadRepository.summarize({ from:'2026-09-01',to:'2026-09-02' },{ databaseOnly:true });
    assert.equal(actual.data.totalRevenue,300);
  } finally { await deleteApp(app); }
});

test('imports every collection, resumes checkpoints, reconciles and serves consistent sales', async () => {
  await assert.rejects(sales.list({ limit: 50 }), /not ready/i);
  const input = baseline();
  await pool.query("alter table brsteel_ops.sales_orders add constraint reject_second_test_row check(source_id<>'2')");
  await assert.rejects(importSnapshot(pool,input,{ batchSize:2 }), /check constraint/);
  assert.equal((await pool.query('select count(*)::int as n from brsteel_ops.sales_orders')).rows[0].n,0);
  assert.equal((await pool.query('select next_index from brsteel_import.runs')).rows[0].next_index,0);
  await pool.query('alter table brsteel_ops.sales_orders drop constraint reject_second_test_row');
  await assert.rejects(importSnapshot(pool, input, { batchSize: 2, onProgress: () => { throw new Error('Interrupted after commit'); } }), /Interrupted/);
  assert.equal((await pool.query('select next_index from brsteel_import.runs')).rows[0].next_index, 2);
  await assert.rejects(sales.list({ limit: 50 }), /not ready/i);
  const loaded = await importSnapshot(pool, input, { batchSize: 2 });
  assert.equal(loaded.records, 12);
  assert.equal((await verifySnapshot(pool, input)).records, 12);
  assert.equal((await importSnapshot(pool, input)).alreadyComplete, true);
  const summary = await sales.summarize({ from: '2026-09-01', to: '2026-09-02' }, { databaseOnly: true });
  const firestore = await firestoreSalesReadRepository.summarize({ from:'2026-09-01',to:'2026-09-02' },{ databaseOnly:true });
  assert.deepEqual(summary.data,firestore.data);
  assert.equal(summary.source, 'postgres');
  assert.equal(summary.data.totalRevenue, 300);
  assert.deepEqual(summary.data.stats.totalRevenue, { value: 300, change: 100 });
  assert.deepEqual(summary.data.topProducts, [{ name: 'Steel', total: 4, revenue: 300 }]);
  const a = await sales.list({ limit: 1, storeId: 0, statusId: 0 });
  const b = await sales.list({ limit: 1, cursor: a.nextCursor! });
  const sourceA = await firestoreSalesReadRepository.list({ limit: 1, storeId: 0, statusId: 0 });
  const sourceB = await firestoreSalesReadRepository.list({ limit: 1, cursor: sourceA.nextCursor! });
  assert.deepEqual(a.data, sourceA.data);
  assert.equal(a.nextCursor, sourceA.nextCursor);
  assert.deepEqual(b.data, sourceB.data);
  assert.equal(b.nextCursor, sourceB.nextCursor);
  assert.deepEqual([a.data[0].id, b.data[0].id], [2, 1]);
  assert.deepEqual((await sales.get('1')).data, input.records[0].data);
  assert.deepEqual((await sales.get('1')).data, (await firestoreSalesReadRepository.get('1')).data);
  const range = { from: '2026-09-01', to: '2026-09-02' };
  assert.deepEqual(await sales.readOrdersForPeriod(range), await firestoreSalesReadRepository.readOrdersForPeriod(range));
  const empty = await sales.summarize({ from: '2020-01-01', to: '2020-01-31' }, { databaseOnly: true });
  const sourceEmpty = await firestoreSalesReadRepository.summarize({ from: '2020-01-01', to: '2020-01-31' }, { databaseOnly: true });
  assert.deepEqual(empty.data, sourceEmpty.data);
  assert.deepEqual(empty.warnings, sourceEmpty.warnings);
  assert.equal(empty.data.totalSales, 0);
  assert.equal(empty.data.stats.totalRevenue.change, null);
  assert.ok(empty.warnings.some(w => w.includes('Nenhum pedido')));
  await assert.rejects(sales.list({ limit: 50, cursor: 'bad' }), /Paginação/);
  await assert.rejects(readerPool.query('delete from brsteel_ops.sales_orders'), /permission denied/);
  await assert.rejects(readerPool.query('select * from brsteel_import.runs'), /permission denied/);
  const checks = await pool.query("select bool_and(c.relrowsecurity) as rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('brsteel_ops','brsteel_import') and c.relkind='r'");
  assert.equal(checks.rows[0].rls, true);
});

test('rejects changed content at the same version and source mismatch without corrupting the ready copy', async () => {
  const changed = baseline(); changed.capturedAt = later(1); changed.records[0].data.total = 999;
  await assert.rejects(importSnapshot(pool, changed), /version/i);
  assert.equal((await sales.get('1')).data.total, 100);
  await assert.rejects(importSnapshot(pool, { ...baseline(), sourceProject: 'other-project' }), /source/i);
});

test('CLI exports a private snapshot, imports it and verifies without printing source payloads', () => {
  const directory=mkdtempSync(join(tmpdir(),'brsteel-operational-cli-'));
  try {
    const file=join(directory,'snapshot.json');
    for (const command of ['export-local','import-local','verify-local']) {
      const child=spawnSync(process.execPath,['--import','tsx','scripts/operational-import.ts',command,file],{ env:process.env,encoding:'utf8' });
      assert.equal(child.status,0,child.stderr);
      assert.ok(!child.stdout.includes('DO-NOT-EXPORT'));
    }
    assert.equal(statSync(file).mode & 0o777,0o600);
    const invalid=join(directory,'invalid.json'); writeFileSync(invalid,'DO-NOT-LOG-PAYLOAD');
    const child=spawnSync(process.execPath,['--import','tsx','scripts/operational-import.ts','import-local',invalid],{ env:process.env,encoding:'utf8' });
    assert.equal(child.status,1);
    assert.ok(!child.stderr.includes('DO-NOT-LOG-PAYLOAD'));
  } finally { rmSync(directory,{ recursive:true,force:true }); }
});

test('serializes importers instead of interleaving checkpoints', async () => {
  const next=baseline(); next.capturedAt=later(1);
  let release!: () => void, started!: () => void;
  const paused=new Promise<void>(resolve=>{ started=resolve; });
  const unblock=new Promise<void>(resolve=>{ release=resolve; });
  const first=importSnapshot(pool,next,{ batchSize:2,onProgress:async()=>{ started(); await unblock; } });
  await paused;
  try { await assert.rejects(importSnapshot(pool,next), /Another import/); }
  finally { release(); }
  await first;
});

test('preserves Firestore product tie order across document ID prefixes and the top-ten boundary', async () => {
  const app = initializeApp({ projectId: 'demo-brsteel-auth' }, 'ties-integration');
  const db = getFirestore(app);
  const items = Array.from({ length: 10 }, (_, index) => ({ descricao: `Product ${index}`, quantidade: 1, valor: index < 9 ? 2 : 1 }));
  const orders = [
    { collection: 'salesOrders' as const, id: 'a', version: '100', data: { data: '2026-07-01', total: 19, itens: items } },
    { collection: 'salesOrders' as const, id: 'a-', version: '100', data: { data: '2026-07-01', total: 1,
      itens: [{ descricao: 'Product 10', quantidade: 1, valor: 1 }] } },
  ];
  try {
    for (const row of orders) await db.collection(row.collection).doc(row.id).set(row.data);
    const input = baseline(); input.capturedAt = later(1.5); input.records.push(...orders);
    await importSnapshot(pool, input);
    const range = { from: '2026-07-01', to: '2026-07-01' };
    const expected = await firestoreSalesReadRepository.summarize(range, { databaseOnly: true });
    assert.equal(expected.data.topProducts.at(-1)!.name, 'Product 9');
    assert.deepEqual((await sales.summarize(range, { databaseOnly: true })).data, expected.data);
  } finally {
    for (const row of orders) await db.collection(row.collection).doc(row.id).delete();
    await deleteApp(app);
  }
});

test('applies newer versions and reconciles documents absent from a complete snapshot', async () => {
  const updated = baseline(); updated.capturedAt = later(2);
  updated.records = updated.records.filter(r => !(r.collection === 'salesOrders' && r.id === '2'));
  updated.records[0].version = (BigInt(updated.records[0].version)+BigInt(1)).toString(); updated.records[0].data.total = 250;
  updated.records[0].data.itens = [];
  await importSnapshot(pool, updated);
  assert.equal((await sales.get('1')).data.total, 250);
  await assert.rejects(sales.get('2'), /Pedido não encontrado/);
  assert.equal((await verifySnapshot(pool, updated)).records, 11);
  assert.equal((await pool.query("select count(*)::int as n from brsteel_ops.sales_order_items where order_id in ('1','2')")).rows[0].n, 0);
  await pool.query("update brsteel_ops.sales_orders set payload=jsonb_set(payload,'{total}','999') where source_id='1'");
  await assert.rejects(verifySnapshot(pool, updated), /Content mismatch/);
});
