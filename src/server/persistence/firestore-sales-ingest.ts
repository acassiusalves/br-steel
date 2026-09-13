import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { documentIdSchema, serialize } from '@/server/operations/common';
import type { IngestCounts, SalesIngestRepository, SourceOrder } from './sales-ingest-contract';

// Firestore allows ~500 operations per batch; 100 keeps margin for large orders.
const BATCH_SIZE = 100;

async function existingOrderIds(ids: string[]) {
  const numeric = ids.map(Number).filter(Number.isFinite);
  const found = new Set<string>();
  for (let index = 0; index < numeric.length; index += 30) {
    const chunk = numeric.slice(index, index + 30);
    if (!chunk.length) continue;
    const snapshot = await adminDb.collection('salesOrders').where('id', 'in', chunk).get();
    snapshot.docs.forEach(doc => found.add(String(doc.data().id)));
  }
  return found;
}

async function upsertOrders(orders: SourceOrder[]): Promise<IngestCounts> {
  if (!orders.length) return { count: 0, created: 0, updated: 0 };
  const collection = adminDb.collection('salesOrders');
  const existing = await existingOrderIds(orders.map(order => String(order.id)));
  let created = 0, updated = 0;
  for (let start = 0; start < orders.length; start += BATCH_SIZE) {
    const batch = adminDb.batch();
    for (const order of orders.slice(start, start + BATCH_SIZE)) {
      const at = new Date().toISOString();
      batch.set(collection.doc(documentIdSchema.parse(String(order.id))),
        serialize({ ...order, importedAt: at, lastUpdated: at, isImported: true }), { merge: true });
      if (existing.has(String(order.id))) updated++; else created++;
    }
    await batch.commit();
  }
  return { count: orders.length, created, updated };
}

async function applyStockObservation(sku: string, observation: Record<string, unknown>) {
  await adminDb.collection('stockUpdates').doc(documentIdSchema.parse(sku)).set(observation, { merge: true });
}

async function markOrderDeleted(orderId: string, at: string) {
  const ref = adminDb.collection('salesOrders').doc(documentIdSchema.parse(orderId));
  if ((await ref.get()).exists) await ref.set({ deleted: true, deletedAt: at }, { merge: true });
}

export const firestoreSalesIngestRepository: SalesIngestRepository = {
  upsertOrders, applyStockObservation, markOrderDeleted,
};
