import 'server-only';
import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import { readCoreWriteMode } from '@/server/operations/maintenance';

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
  return adminDb.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists) return { created: false, status: String(existing.data()?.status) as WebhookStatus };
    tx.create(ref, { ...event, status: 'received' satisfies WebhookStatus, attempts: 0, error: null });
    return { created: true, status: 'received' as WebhookStatus };
  });
}

/** Only a terminal outcome means the delivery is done with; anything else may still need work. */
export const TERMINAL: WebhookStatus[] = ['processed', 'ignored'];
export const MAX_ATTEMPTS = 5;

export async function markWebhookEvent(id: string, status: WebhookStatus, error?: string) {
  await adminDb.collection(WEBHOOK_EVENTS).doc(id).set(
    { status, error: error ?? null, updatedAt: new Date().toISOString() }, { merge: true });
}

/**
 * Processes pending events one at a time. A failure leaves the event in `failed` with its cause, so it
 * stays retryable instead of depending on Bling deciding to deliver again.
 *
 * Inside a maintenance window (`draining` or `blocked`) the queue accumulates instead: nothing is
 * applied, and the next run after the window resumes. The mode is read again before every event, so a
 * window that opens mid-run stops the loop and leaves the remaining events exactly as they were.
 */
export async function drainWebhookEvents(limit: number, handle: (event: QueuedEvent) => Promise<void>) {
  const open = async () => await readCoreWriteMode() === 'open';
  if (!await open()) return { processed: 0, failed: 0, suspended: true };
  // New deliveries first, then retryable failures. An exhausted failure is skipped without being touched:
  // reclaiming it every run only inflated its attempts and, sorting ahead, starved new events of slots.
  const events = adminDb.collection(WEBHOOK_EVENTS);
  const fresh = (await events.where('status', '==', 'received').limit(limit).get()).docs;
  const retryable = fresh.length < limit
    ? (await events.where('status', '==', 'failed').limit(limit * 4).get()).docs
      .filter(doc => (Number(doc.data().attempts) || 0) < MAX_ATTEMPTS)
    : [];
  let processed = 0, failed = 0;
  for (const doc of [...fresh, ...retryable].slice(0, limit)) {
    if (!await open()) return { processed, failed, suspended: true };
    const event = { id: doc.id, ...doc.data() } as QueuedEvent;
    const claimed = await adminDb.runTransaction(async tx => {
      const current = await tx.get(doc.ref);
      if (!['received', 'failed'].includes(String(current.data()?.status))) return false;
      tx.update(doc.ref, { status: 'processing', attempts: (Number(current.data()?.attempts) || 0) + 1 });
      return true;
    });
    if (!claimed) continue;
    if ((Number(event.attempts) || 0) >= MAX_ATTEMPTS) {
      await markWebhookEvent(event.id, 'failed', 'Limite de tentativas atingido; retomada exige ação explícita.');
      failed++;
      continue;
    }
    try {
      await handle(event);
      await markWebhookEvent(event.id, 'processed');
      processed++;
    } catch (error) {
      await markWebhookEvent(event.id, 'failed', error instanceof Error ? error.message : 'Falha ao processar evento.');
      failed++;
    }
  }
  return { processed, failed, suspended: false };
}
