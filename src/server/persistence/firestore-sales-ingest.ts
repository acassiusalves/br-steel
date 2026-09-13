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

/** 24 meses, casando com a janela de 104 semanas do rollup de demanda. */
const OBSERVATION_TTL_MS = 730 * 86_400_000;

/**
 * Grava o saldo observado em dois lugares com propósitos diferentes.
 *
 * `stockUpdates/{sku}` continua sendo a projeção "último valor" — é o que readStockSnapshot,
 * readStoredStockSnapshot, a projeção Postgres e o MCP consomem, e seu formato não muda.
 * `stockObservations` é o log append-only, que antes não existia: até aqui cada webhook sobrescrevia
 * a leitura anterior e o histórico de saldo era perdido de forma irrecuperável.
 *
 * Só registra quando o saldo muda. Um webhook que repete o mesmo número não é observação nova, e o
 * Bling reentrega com frequência.
 */
async function applyStockObservation(sku: string, observation: Record<string, unknown>) {
  const id = documentIdSchema.parse(sku);
  const latest = adminDb.collection('stockUpdates').doc(id);
  try {
    await adminDb.runTransaction(async tx => {
      const previous = (await tx.get(latest)).data();
      tx.set(latest, observation, { merge: true });
      const balance = observation.estoqueAtual;
      if (typeof balance !== 'number' || !Number.isFinite(balance)) return;
      if (previous && previous.estoqueAtual === balance) return;
      const observedAt = String(observation.webhookReceivedAt ?? '');
      const at = Date.parse(observedAt);
      if (!Number.isFinite(at)) return;
      tx.create(adminDb.collection('stockObservations').doc(), {
        sku: id, estoqueAtual: balance, observedAt,
        event: String(observation.lastEvent ?? ''), source: 'webhook',
        expiresAt: new Date(at + OBSERVATION_TTL_MS),
      });
    });
  } catch (error) {
    // O log é acessório; o último saldo não é. Uma falha ao registrar a observação não pode impedir
    // a atualização que o webhook já confirmou ao Bling — mesmo princípio de
    // invalidateProductStockCache().catch(() => undefined) em src/app/api/webhook/bling/route.ts.
    console.error('[STOCK-OBSERVATION]', error);
    await latest.set(observation, { merge: true });
  }
}

async function markOrderDeleted(orderId: string, at: string) {
  const ref = adminDb.collection('salesOrders').doc(documentIdSchema.parse(orderId));
  if ((await ref.get()).exists) await ref.set({ deleted: true, deletedAt: at }, { merge: true });
}

export const firestoreSalesIngestRepository: SalesIngestRepository = {
  upsertOrders, applyStockObservation, markOrderDeleted,
};
