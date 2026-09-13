import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { exportOperationalSnapshot } from '../../src/server/migration/operational-export';
import { createLocalImportPool, importSnapshot, verifySnapshot } from '../../src/server/migration/operational-import';
import type { OperationalSnapshot, SourceRecord } from '../../src/server/migration/operational-snapshot';
import { createPostgresStockRepository } from '../../src/server/persistence/postgres-stock';
import { firestoreStockReadRepository } from '../../src/server/persistence/firestore-stock';
import { createPostgresProductionDemandRepository } from '../../src/server/persistence/postgres-production-demand';
import { firestoreProductionDemandReadRepository } from '../../src/server/persistence/firestore-production-demand';
import { createPostgresProductionRepository } from '../../src/server/persistence/postgres-production';
import { firestoreProductionReadRepository } from '../../src/server/persistence/firestore-production';
import { createPostgresSuppliesRepository } from '../../src/server/persistence/postgres-supplies';
import { firestoreSuppliesReadRepository } from '../../src/server/persistence/firestore-supplies';
import { createStoredStockOperations } from '../../src/server/operations/stock';
import { createProductionDemandOperation } from '../../src/server/operations/production-demand';
import { createProductionReadOperations } from '../../src/server/operations/production';
import { createSuppliesReadOperations } from '../../src/server/operations/supplies';
import { withPilotSnapshot } from '../../src/server/persistence/pilot-snapshot';
import { createPostgresReadTools } from '../../src/server/mcp/postgres-pilot';
import { prepareSnapshot } from '../../src/server/migration/operational-snapshot';
import { pagePermissions } from '../../src/lib/permissions';
import type { AccessContext } from '../../src/server/access/types';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
assert.ok(process.env.BRSTEEL_PG_LOCAL_URL);
const pool = createLocalImportPool(process.env.BRSTEEL_PG_LOCAL_URL);
const readerPool = new Pool({ connectionString: process.env.BRSTEEL_PG_LOCAL_URL, max: 2, options: '-c role=brsteel_ops_reader' });
const stock = createPostgresStockRepository(readerPool), demand = createPostgresProductionDemandRepository(readerPool);
const production = createPostgresProductionRepository(readerPool), supplies = createPostgresSuppliesRepository(readerPool);
const app = initializeApp({ projectId: 'demo-brsteel-auth' }, 'readers-integration'), db = getFirestore(app);
const at = '2026-09-12T10:00:00.000Z', range = { from: '2026-09-01', to: '2026-09-02' };
const record = (collection: SourceRecord['collection'], id: string, data: Record<string,unknown>): SourceRecord => ({ collection,id,data,version:'1' });
const item = (codigo: string, quantidade: unknown, descricao = codigo) => ({ codigo,quantidade,descricao,valor:42,private:'PRIVATE-READER-MARKER' });
const order = (id: unknown, itens: unknown[], extra = {}) => ({ id,numero:123,data:'2026-09-01',notaFiscal:{id:1,xml:'PRIVATE-READER-MARKER'},
  contato:{nome:'PRIVATE-READER-MARKER'},total:999,itens,...extra });
const fixture: SourceRecord[] = [
  record('salesOrders','a',order(101,[item('ZERO',2,'First name'),item('ZERO',1,'Second name'),item('MISSING',4),item('TIE',4),item('NEG',-1),item('BAD','2'),item('',3)])),
  record('salesOrders','a-',order(101,[item('ZERO',4,'Later name')])),
  record('salesOrders','b',order(102,[item('ZERO',7)],{data:'2026-09-02'})),
  record('salesOrders','draft',order(103,[item('ZERO',100)],{notaFiscal:{id:0}})),
  record('salesOrders','old',order(104,[item('ZERO',100)],{data:'2026-08-31'})),
  record('stockUpdates','01', {sku:'ZERO',estoqueAtual:99,webhookReceivedAt:'2026-09-12T07:00:00-03:00'}),
  record('stockUpdates','02', {sku:'ZERO',produtoId:42,nome:'Stored name',estoqueAtual:0,webhookReceivedAt:at}),
  record('stockUpdates','03', {sku:'ZERO',estoqueAtual:500,webhookReceivedAt:'2026-09-01T00:00:00Z'}),
  ...['Z','á','a','A'].map((sku,index)=>record('stockUpdates',`sort-${index}`,{sku,estoqueAtual:1,webhookReceivedAt:at})),
  ...[{estoqueAtual:'0'},{webhookReceivedAt:'bad'},{isSimulated:true},{source:'simulated'},{lastEvent:'event (test)'}]
    .map((patch,index)=>record('stockUpdates',`invalid-${index}`,{sku:'INVALID',estoqueAtual:0,webhookReceivedAt:at,...patch})),
  record('supplies','0-empty',{codigo:'THRESHOLD',estoqueMinimo:1}),
  record('supplies','s-a',{codigo:'ZERO',nome:'First',estoqueMinimo:5,estoqueMaximo:10}),
  record('supplies','s-z',{codigo:'ZERO',nome:'Last',estoqueMinimo:0,estoqueMaximo:20}),
  record('productionColumns','queue',{name:'Queue',order:0,color:'#000000',secret:'PRIVATE-READER-MARKER'}),
  record('productionLots','lot',{columnId:'queue',linkedOrderIds:Array(101).fill('a'),lotNumber:'LOT-1',title:'Lot',
    assignedTo:{userId:'operator',userName:'Operator',password:'PRIVATE-READER-MARKER'},createdBy:{userId:'operator',userName:'Operator',secret:'PRIVATE-READER-MARKER'},invoiceXml:'PRIVATE-READER-MARKER'}),
  record('productionLotItems','i1',{lotId:'lot',sourceOrderId:'a',sku:'ZERO',quantity:1,customerName:'PRIVATE-READER-MARKER'}),
  record('productionLotItems','i2',{lotId:'lot',sourceOrderId:'b',sku:'ZERO',quantity:2,customerName:'PRIVATE-READER-MARKER'}),
  record('productionComments','c',{lotId:'lot',content:'Note',author:{userId:'operator',userName:'Operator',email:'PRIVATE-READER-MARKER'}}),
  ...['2026-09-12T02:59:59.999Z','2026-09-12T03:00:00.000Z','2026-09-13T02:59:59.999Z','2026-09-13T03:00:00.000Z']
    .map((createdAt,index)=>record('inventoryMovements',`m${index}`,{supplyId:'s-z',createdAt,quantity:1,type:'entrada'})),
  record('inventoryMovements','m1-tie',{supplyId:'s-z',createdAt:'2026-09-12T03:00:00.000Z',quantity:1,type:'entrada'}),
  record('inventoryMovements','m-undated',{supplyId:'s-z',quantity:1,type:'entrada'}),
];
let snapshot: OperationalSnapshot;
const normalize = (response: any) => {
  const copy = structuredClone(response); delete copy.asOf;
  return JSON.parse(JSON.stringify(copy).replaceAll('"postgres"','"firestore"'));
};
const operator: AccessContext = { actor:{userId:'operator',role:'Operador',source:'mcp'},active:true,
  capabilities:['producao:read'],permissions:pagePermissions,inactivePages:[] };

before(async () => {
  // Both services were created by the harness and contain only synthetic test data.
  await pool.query('truncate brsteel_import.runs cascade');
  const reset = await fetch('http://127.0.0.1:8188/emulator/v1/projects/demo-brsteel-auth/databases/(default)/documents',{method:'DELETE'});
  assert.ok(reset.ok);
  for (const row of fixture) await db.collection(row.collection).doc(row.id).set(row.data);
  snapshot = await exportOperationalSnapshot(db,'demo-brsteel-auth');
  // Leave room for the later synthetic captures without placing them in the future.
  snapshot.capturedAt = new Date(Date.now()-600000).toISOString();
});
after(async () => { await deleteApp(app); await readerPool.end(); await pool.end(); });

test('rejects partial copies for all candidate readers and reconciles read projections', async () => {
  await assert.rejects(importSnapshot(pool,snapshot,{batchSize:2,onProgress:()=>{throw new Error('pause')}}),/pause/);
  for (const read of [()=>stock.list({limit:1}),()=>demand.read(range),()=>production.list({view:'lots',limit:1}),()=>supplies.list({limit:1})]) {
    await assert.rejects(read(),/not ready/);
  }
  await importSnapshot(pool,snapshot);
  assert.equal((await verifySnapshot(pool,snapshot)).records,fixture.length);
});
test('stock matches latest persisted balances, date ties, locale order, filters, cursors and warnings', async () => {
  const expected = await firestoreStockReadRepository.snapshot(), actual = await stock.snapshot();
  assert.deepEqual(normalize(actual),normalize(expected)); assert.equal(actual.asOf,expected.asOf);
  assert.equal(actual.data.find(row=>row.produto.codigo==='ZERO')!.saldoVirtualTotal,0);
  assert.equal(actual.data.find(row=>row.produto.codigo==='ZERO')!.saldoFisicoTotal,null);
  let cursor: string | undefined;
  do {
    const page = await stock.list({limit:2,cursor}), source = await firestoreStockReadRepository.list({limit:2,cursor});
    assert.deepEqual(normalize(page),normalize(source)); cursor = page.nextCursor ?? undefined;
  } while (cursor);
  for (const input of [{limit:1,sku:'ZERO'},{limit:1,sku:'NONE'},{limit:1,sku:'ZERO',cursor:'100'},{limit:1,cursor:''}]) {
    assert.deepEqual(normalize(await stock.list(input)),normalize(await firestoreStockReadRepository.list(input)));
  }
  await assert.rejects(stock.list({limit:1,cursor:'no'}),/Paginação/);
});
test('SQL demand preserves billed quantities, distinct business IDs, first description, tie order and limits', async () => {
  const response = await demand.read(range), expected = await firestoreProductionDemandReadRepository.read(range);
  assert.deepEqual(normalize(response),normalize(expected));
  assert.deepEqual(response.data.map(row=>row.sku),['ZERO','MISSING','TIE']);
  assert.equal(response.data[0].totalQuantitySold,14); assert.equal(response.data[0].orderCount,2);
  assert.equal(response.data[0].description,'First name'); assert.equal(response.data[0].stockMin,0);
  assert.equal(response.data[1].stockLevel,null);
  assert.ok(!JSON.stringify(response).includes('PRIVATE-READER-MARKER'));
  const empty = {from:'2020-01-01',to:'2020-02-01'};
  assert.deepEqual(normalize(await demand.read(empty)),normalize(await firestoreProductionDemandReadRepository.read(empty)));
  const fortnight = {from:'2026-09-01',to:'2026-09-14'};
  assert.deepEqual(normalize(await demand.read(fortnight)),normalize(await firestoreProductionDemandReadRepository.read(fortnight)));
  assert.equal((await demand.read(fortnight)).data[0].weeklyAverage,7);
});
test('rejects native timestamp legacies before export can change stock or movement eligibility', async () => {
  const native = new Timestamp(Date.parse('2026-09-12T03:00:00Z')/1000,123456000);
  const temporary = db.collection('stockUpdates').doc('native-timestamp');
  try {
    await temporary.set({sku:'NATIVE',estoqueAtual:5,webhookReceivedAt:native});
    assert.ok(!(await firestoreStockReadRepository.snapshot()).data.some(row=>row.produto.codigo==='NATIVE'));
    await assert.rejects(exportOperationalSnapshot(db,'demo-brsteel-auth'),/Source timestamp requires explicit normalization/);
    assert.ok(!(await stock.snapshot()).data.some(row=>row.produto.codigo==='NATIVE'));
  } finally { await temporary.delete(); }
  for (const [collection,id] of [['inventoryMovements','m1'],['productionColumns','queue'],['supplies','s-z']] as const) {
    const ref = db.collection(collection).doc(id), original = fixture.find(row=>row.collection===collection && row.id===id)!.data;
    try {
      await ref.update({createdAt:native});
      if (collection === 'inventoryMovements') {
        const source = await firestoreSuppliesReadRepository.listMovements({supplyId:'s-z',limit:100,from:'2026-09-12',to:'2026-09-12'});
        assert.ok(!source.data.some(row=>row.id==='m1'));
      }
      await assert.rejects(exportOperationalSnapshot(db,'demo-brsteel-auth'),/Source timestamp requires explicit normalization/);
    } finally { await ref.set(original); }
  }
});
test('production SQL pages and details preserve projections and continuations without commercial data', async () => {
  for (const view of ['columns','lots','items','comments','orders'] as const) {
    let cursor: string | undefined;
    do {
      const input = {view,limit:1,lotId:'lot',cursor};
      const page = await production.list(input);
      assert.deepEqual(normalize(page),normalize(await firestoreProductionReadRepository.list(input)));
      assert.ok(!JSON.stringify(page).includes('PRIVATE-READER-MARKER'));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  const lot = await production.getLot({lotId:'lot',limit:1});
  assert.deepEqual(normalize(lot),normalize(await firestoreProductionReadRepository.getLot({lotId:'lot',limit:1})));
  assert.ok(Array.isArray(lot.data.lot.linkedOrderIds));
  assert.equal(lot.data.lot.linkedOrderIds.length,100); assert.ok(lot.warnings.length);
  const args = {orderId:'a',limit:2,cursor:'2'};
  assert.deepEqual(normalize(await production.getOrder(args)),normalize(await firestoreProductionReadRepository.getOrder(args)));
  await assert.rejects(production.list({view:'items',lotId:'missing',limit:1}),/encontrado/);
});
test('supplies advance through unnamed rows and movements preserve São Paulo day boundaries', async () => {
  let cursor: string | undefined;
  do {
    const input = {limit:1,cursor}, page = await supplies.list(input);
    assert.deepEqual(normalize(page),normalize(await firestoreSuppliesReadRepository.list(input)));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  for (const filters of [{},{from:'2026-09-12',to:'2026-09-12'}]) {
    let next: string | undefined; const ids: unknown[] = [];
    do {
      const input = {supplyId:'s-z',limit:1,cursor:next,...filters}, page = await supplies.listMovements(input);
      assert.deepEqual(normalize(page),normalize(await firestoreSuppliesReadRepository.listMovements(input)));
      ids.push(...page.data.map(row=>row.id)); next=page.nextCursor ?? undefined;
    } while (next);
    assert.deepEqual(ids,filters.from ? ['m1','m1-tie','m2'] : ['m-undated','m0','m1','m1-tie','m2','m3']);
  }
});
test('SQL-backed operation factories preserve per-user authorization and minimal production access', async () => {
  const stockOps = createStoredStockOperations(stock), prodOps = createProductionReadOperations(production);
  const supplyOps = createSuppliesReadOperations(supplies), demandOp = createProductionDemandOperation(demand);
  await assert.rejects(stockOps.listProductStock(operator,{}),/permissão/);
  await assert.rejects(supplyOps.listSupplies(operator,{}),/permissão/);
  assert.equal((await demandOp(operator,range)).data[0].totalQuantitySold,14);
  assert.ok(!JSON.stringify(await prodOps.listProduction(operator,{view:'orders'})).includes('PRIVATE-READER-MARKER'));
  const inactive = {...operator,active:false};
  await assert.rejects(demandOp(inactive,range),/permissão/);
  await assert.rejects(prodOps.listProduction({...operator,inactivePages:['/producao/kanban']},{view:'lots'}),/permissão/);
});
test('exposes an authorized MCP copy and rejects stale metadata without an alternate source', async () => {
  const hash = prepareSnapshot(snapshot).hash;
  const policy = { sourceProject:'demo-brsteel-auth',snapshotHash:hash,expiresAt:Date.now()+3600000 };
  const tools = createPostgresReadTools(readerPool,policy);
  const call = (name: string, input: unknown, ctx = operator) => tools.find(t=>t.name===name)!.run(ctx,input);
  const admin: AccessContext = {...operator,actor:{...operator.actor,role:'Administrador'},capabilities:['vendas:read','estoque:read','insumos:read','producao:read']};
  const sales = await call('resumir_vendas',range,admin);
  assert.equal(sales.source,'postgres'); assert.equal(sales.readCopy?.snapshotHash,hash);
  assert.equal(sales.asOf,snapshot.capturedAt); assert.match(sales.warnings.join(' '),/cópia de piloto/);
  const demandPage = await call('consultar_demanda_producao',{...range,limit:1});
  assert.equal(demandPage.source,'postgres'); assert.equal((demandPage.data as any[]).length,1);
  const orderPage = await call('listar_pedidos_para_producao',{limit:1});
  assert.equal(JSON.stringify(orderPage).includes('PRIVATE-READER-MARKER'),false);
  await assert.rejects(call('listar_pedidos',{}),{code:'FORBIDDEN'});
  await assert.rejects(call('listar_lotes_producao',{}, {...operator,inactivePages:['/producao/kanban']}),{code:'FORBIDDEN'});
  const state = (await pool.query('select captured_at,completed_at from brsteel_import.state')).rows[0];
  assert.equal(state.captured_at.toISOString(),snapshot.capturedAt); assert.ok(state.completed_at instanceof Date);
  await assert.rejects(withPilotSnapshot({...policy,snapshotHash:'0'.repeat(64)},()=>stock.list({limit:1})),/unavailable/);
  await pool.query('update brsteel_import.state set ready=false');
  try { await assert.rejects(call('consultar_demanda_producao',range),/not ready/); }
  finally { await pool.query('update brsteel_import.state set ready=true'); }
  await assert.rejects(pool.query('update brsteel_import.state set completed_at=null'),{code:'23514'});
});

test('read model corruption is detected and new snapshots reconcile stock updates and deletions', async () => {
  await pool.query("update brsteel_ops.stock_observations set stock_read=jsonb_set(stock_read,'{saldoVirtualTotal}','99') where source_id='02'");
  await assert.rejects(verifySnapshot(pool,snapshot),/Stock read model mismatch/);
  const updated = structuredClone(snapshot); updated.capturedAt = new Date(Date.parse(snapshot.capturedAt)+30000).toISOString();
  const observation = updated.records.find(row=>row.collection==='stockUpdates' && row.id==='02')!;
  observation.version = (BigInt(observation.version)+BigInt(1)).toString();
  observation.data = {...observation.data,estoqueAtual:7,webhookReceivedAt:'2026-09-13T10:00:00Z'};
  await db.collection('stockUpdates').doc('02').set(observation.data);
  await importSnapshot(pool,updated);
  assert.equal((await verifySnapshot(pool,updated)).records,updated.records.length);
  assert.equal((await demand.read(range)).data[0].stockLevel,7);
  assert.deepEqual(normalize(await stock.snapshot()),normalize(await firestoreStockReadRepository.snapshot()));
  const next = structuredClone(snapshot); next.capturedAt = new Date(Date.parse(snapshot.capturedAt)+60000).toISOString();
  next.records = next.records.filter(row=>row.collection!=='stockUpdates');
  await importSnapshot(pool,next);
  assert.equal((await stock.snapshot()).data.length,0);
  assert.equal((await demand.read(range)).data[0].stockLevel,null);
  assert.equal((await verifySnapshot(pool,next)).records,next.records.length);
});
