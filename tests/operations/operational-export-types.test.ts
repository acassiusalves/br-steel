import { expect, it } from 'vitest';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { exportOperationalSnapshot } from '@/server/migration/operational-export';
import type { OperationalCollection } from '@/server/migration/operational-snapshot';

const timestamp = new Timestamp(1789207200,123456000);
function source(collection: OperationalCollection, data: Record<string,unknown>) {
  return { collection(name: string) { return { orderBy() { return { limit() { return { async get() {
    const docs = name === collection ? [{ id:'native',updateTime:timestamp,data:()=>data }] : [];
    return { docs,size:docs.length };
  } }; } }; } }; } } as unknown as Firestore;
}
it.each([
  ['stockUpdates',{estoqueAtual:5,webhookReceivedAt:timestamp}],
  ['stockUpdates',{sku:timestamp,estoqueAtual:5,webhookReceivedAt:'2026-09-12T10:00:00Z'}],
  ['salesOrders',{updatedAt:timestamp}],
  ['supplies',{createdAt:timestamp}],
  ['productionColumns',{createdAt:timestamp}],
] as [OperationalCollection,Record<string,unknown>][])('rejects native timestamps affecting %s read parity before exporting', async (collection,data) => {
  await expect(exportOperationalSnapshot(source(collection,data),'demo-brsteel-auth')).rejects.toThrow(/Source timestamp requires explicit normalization/);
});
it('still preserves precise timestamps in stock metadata that never affects read projections', async () => {
  const exported = await exportOperationalSnapshot(source('stockUpdates',{createdAt:timestamp}),'demo-brsteel-auth');
  expect(exported.records[0].data.createdAt).toBe('2026-09-12T10:00:00.123456000Z');
});
