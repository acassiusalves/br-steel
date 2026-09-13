import 'server-only';
import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';

export const WEBHOOK_EVENTS = 'blingWebhookEvents';
export type WebhookTopic = 'order' | 'stock' | 'other';
export type WebhookStatus = 'received' | 'processing' | 'processed' | 'failed' | 'ignored';
export type QueuedEvent = {
  id: string; topic: WebhookTopic; payload: unknown; receivedAt: string;
  status: WebhookStatus; attempts: number; error?: string | null;
};

/** Retries of one delivery collapse; a later change to the same record does not. */
const RETRY_WINDOW_MS = 60_000;

/**
 * Derived from the delivery content plus a coarse time bucket, never from a random value or the clock
 * alone. Bling sends no delivery identifier, and an order payload is just `{ id }`, so two genuine
 * updates to the same order are byte-identical: deduplicating on content alone would silently drop the
 * second one. This does not claim exactly-once delivery — the handlers are idempotent, which is what
 * actually protects the data. The queue's job is durability and retry.
 */
export function webhookEventId(topic: WebhookTopic, rawBody: string, receivedAtMs = Date.now()) {
  const bucket = Math.floor(receivedAtMs / RETRY_WINDOW_MS);
  return `${topic}-${createHash('sha256').update(`${topic}:${rawBody}`).digest('hex').slice(0, 32)}-${bucket}`;
}

/** Resolves only once the event is durable. The caller must not acknowledge before it does. */
export async function enqueueWebhookEvent(event: { id: string; topic: WebhookTopic; payload: unknown; receivedAt: string }) {
  const ref = adminDb.collection(WEBHOOK_EVENTS).doc(event.id);
  const created = await adminDb.runTransaction(async tx => {
    if ((await tx.get(ref)).exists) return false;
    tx.create(ref, { ...event, status: 'received' satisfies WebhookStatus, attempts: 0, error: null });
    return true;
  });
  return { created };
}

export async function markWebhookEvent(id: string, status: WebhookStatus, error?: string) {
  await adminDb.collection(WEBHOOK_EVENTS).doc(id).set(
    { status, error: error ?? null, updatedAt: new Date().toISOString() }, { merge: true });
}

/**
 * Processes pending events one at a time. A failure leaves the event in `failed` with its cause, so it
 * stays retryable instead of depending on Bling deciding to deliver again.
 */
export async function drainWebhookEvents(limit: number, handle: (event: QueuedEvent) => Promise<void>) {
  const pending = await adminDb.collection(WEBHOOK_EVENTS)
    .where('status', 'in', ['received', 'failed']).limit(limit).get();
  let processed = 0, failed = 0;
  for (const doc of pending.docs) {
    const event = { id: doc.id, ...doc.data() } as QueuedEvent;
    const claimed = await adminDb.runTransaction(async tx => {
      const current = await tx.get(doc.ref);
      if (!['received', 'failed'].includes(String(current.data()?.status))) return false;
      tx.update(doc.ref, { status: 'processing', attempts: (Number(current.data()?.attempts) || 0) + 1 });
      return true;
    });
    if (!claimed) continue;
    try {
      await handle(event);
      await markWebhookEvent(event.id, 'processed');
      processed++;
    } catch (error) {
      await markWebhookEvent(event.id, 'failed', error instanceof Error ? error.message : 'Falha ao processar evento.');
      failed++;
    }
  }
  return { processed, failed };
}
