import { createHash } from 'node:crypto';
import { z } from 'zod';

export const TABLES = {
  salesOrders: 'sales_orders', stockUpdates: 'stock_observations', supplies: 'supplies',
  productionColumns: 'production_columns', operationsMetadata: 'production_counters',
  supplyCodes: 'supply_codes', inventoryMovements: 'inventory_movements',
  productionLots: 'production_lots', productionLotItems: 'production_lot_items', productionComments: 'production_comments',
} as const;
export type OperationalCollection = keyof typeof TABLES;
export const COLLECTIONS = Object.keys(TABLES) as OperationalCollection[];
export type SourceRecord = { collection: OperationalCollection; id: string; version: string; data: Record<string, unknown> };
export type OperationalSnapshot = { formatVersion: 1; sourceProject: string; capturedAt: string;
  completeCollections: OperationalCollection[]; records: SourceRecord[] };
export type PreparedSnapshot = OperationalSnapshot & { hash: string };

const id = z.string().min(1).max(200).refine(v => !['.', '..'].includes(v) && !/[\/\u0000]/.test(v));
const recordSchema = z.object({ collection: z.enum(COLLECTIONS as [OperationalCollection, ...OperationalCollection[]]),
  id, version: z.string().regex(/^(0|[1-9]\d{0,29})$/), data: z.record(z.unknown()) }).strict();
const schema = z.object({ formatVersion: z.literal(1), sourceProject: z.string().regex(/^[a-z][a-z0-9-]{3,62}$/),
  capturedAt: z.string().datetime(), completeCollections: z.array(z.string()), records: z.array(recordSchema) }).strict();

/** A deterministic JSON representation; unsupported values fail instead of silently changing business data. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value === 'string' && !value.includes('\u0000') && value.isWellFormed()) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(k => canonicalJson(k) + ':' + canonicalJson((value as Record<string, unknown>)[k])).join(',') + '}';
  }
  throw new Error('Unsupported JSON value in snapshot');
}
export const contentHash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');

export function prepareSnapshot(raw: unknown): PreparedSnapshot {
  const parsed = schema.parse(raw);
  if (parsed.completeCollections.length !== COLLECTIONS.length
    || new Set(parsed.completeCollections).size !== COLLECTIONS.length
    || COLLECTIONS.some(c => !parsed.completeCollections.includes(c))) throw new Error('Complete collection manifest required');
  const records = parsed.records;
  const keys = new Set<string>();
  for (const row of records) {
    const key = `${row.collection}/${row.id}`;
    if (keys.has(key)) throw new Error(`Duplicate document: ${key}`);
    keys.add(key);
    try { canonicalJson(row.data); } catch { throw new Error(`Unsupported JSON value: ${key}`); }
    if (row.collection === 'operationsMetadata' && !/^production-lots-\d{4}$/.test(row.id)) throw new Error(`Invalid counter ID: ${key}`);
    if (row.collection === 'salesOrders') {
      if (row.data.data !== undefined && (typeof row.data.data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.data.data)
        || !Number.isFinite(Date.parse(row.data.data)) || new Date(row.data.data).toISOString().slice(0, 10) !== row.data.data)) throw new Error(`Invalid sales date: ${key}`);
      if (row.data.itens != null && (!Array.isArray(row.data.itens)
        || row.data.itens.some((item: unknown) => !item || typeof item !== 'object' || Array.isArray(item)))) throw new Error(`Invalid order items: ${key}`);
    }
  }
  function reference(row: SourceRecord, collection: OperationalCollection, value: unknown) {
    if ((typeof value !== 'string' && typeof value !== 'number') || !keys.has(`${collection}/${String(value)}`)) {
      throw new Error(`Invalid reference: ${row.collection}/${row.id} -> ${collection}`);
    }
  }
  for (const row of records) {
    if (row.collection === 'supplyCodes' || row.collection === 'inventoryMovements') reference(row, 'supplies', row.data.supplyId);
    if (row.collection === 'productionLots') {
      reference(row, 'productionColumns', row.data.columnId);
      if (!Array.isArray(row.data.linkedOrderIds)) throw new Error(`Invalid linked orders: ${row.id}`);
      for (const order of row.data.linkedOrderIds) reference(row, 'salesOrders', order);
    }
    if (row.collection === 'productionLotItems' || row.collection === 'productionComments') reference(row, 'productionLots', row.data.lotId);
    if (row.collection === 'productionLotItems') reference(row, 'salesOrders', row.data.sourceOrderId);
  }
  records.sort((a, b) => COLLECTIONS.indexOf(a.collection) - COLLECTIONS.indexOf(b.collection)
    || Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)));
  const snapshot: OperationalSnapshot = { ...parsed, completeCollections: [...COLLECTIONS], records };
  return { ...snapshot, hash: contentHash(snapshot) };
}
