import { expect, it } from 'vitest';
import { COLLECTIONS, prepareSnapshot } from '@/server/migration/operational-snapshot';

const snapshot = (records: unknown[] = []) => ({ formatVersion: 1, sourceProject: 'demo-brsteel-auth',
  capturedAt: '2026-09-12T12:00:00.000Z', completeCollections: [...COLLECTIONS], records });
const order = { collection: 'salesOrders', id: 'document-id', version: '1789214400000000001',
  data: { id: 123, data: '2026-09-01', total: 42, itens: [{ codigo: 'A', quantidade: 2, valor: 21 }] } };

it('preserves document identity and JSON values with a deterministic digest', () => {
  const a = prepareSnapshot(snapshot([order]));
  const b = prepareSnapshot(snapshot([{ ...order, data: { total: 42, itens: order.data.itens, data: '2026-09-01', id: 123 } }]));
  expect(a.hash).toBe(b.hash);
  expect(a.records[0].id).toBe('document-id');
  expect(a.records[0].data.id).toBe(123);
});
it('requires exactly the declared operational collections', () => {
  expect(() => prepareSnapshot({ ...snapshot(), completeCollections: ['salesOrders'] })).toThrow();
  expect(() => prepareSnapshot(snapshot([{ ...order, collection: 'users' }]))).toThrow();
  expect(() => prepareSnapshot(snapshot([{ ...order, collection: 'operationsMetadata', id: 'credentials' }]))).toThrow();
});
it('rejects ambiguous identity, invalid versions and non-JSON numbers', () => {
  for (const record of [{ ...order, id: 'a/b' }, { ...order, version: '1.2' }, { ...order, data: { total: NaN } },
    { ...order, data: { secret: '\u0000' } }, { ...order, data: { itens: {} } }]) {
    expect(() => prepareSnapshot(snapshot([record]))).toThrow();
  }
  expect(() => prepareSnapshot(snapshot([order, order]))).toThrow();
});
it('rejects orphan references before loading any rows', () => {
  expect(() => prepareSnapshot(snapshot([{ collection: 'productionLots', id: 'lot', version: '1',
    data: { columnId: 'missing', linkedOrderIds: [] } }]))).toThrow(/reference/i);
  expect(() => prepareSnapshot(snapshot([{ collection: 'inventoryMovements', id: 'move', version: '1',
    data: { supplyId: 'missing' } }]))).toThrow(/reference/i);
});
it('keeps unknown, null and zero fields in legacy supplies without inventing defaults', () => {
  const result = prepareSnapshot(snapshot([{ collection: 'supplies', id: 'legacy', version: '1',
    data: { nome: 'Steel', estoqueAtual: 0, estoqueMinimo: null, nested: { limits: [1, null] } } }]));
  expect(result.records[0].data).toEqual({ nome: 'Steel', estoqueAtual: 0, estoqueMinimo: null, nested: { limits: [1, null] } });
});

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
