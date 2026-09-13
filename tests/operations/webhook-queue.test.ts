import { beforeEach, expect, it, vi } from 'vitest';
import { seedOperations } from './fixtures';
import { adminDb } from '../helpers/firestore';
import { WEBHOOK_EVENTS, drainWebhookEvents, enqueueWebhookEvent, webhookEventId, type QueuedEvent } from '@/server/ingest/webhook-queue';

beforeEach(seedOperations);
const event = (id: string, payload: unknown = { id: 1 }) =>
  ({ id, topic: 'order' as const, payload, receivedAt: new Date().toISOString() });

it('collapses a retried delivery but keeps a later change to the same record', () => {
  const body = JSON.stringify({ event: 'pedido_venda.updated', data: { id: 1 } });
  const at = Date.now();
  expect(webhookEventId('order', body, at)).toBe(webhookEventId('order', body, at + 500));
  // A byte-identical payload arriving in a later window is a different change, not a retry.
  expect(webhookEventId('order', body, at)).not.toBe(webhookEventId('order', body, at + 120_000));
  expect(webhookEventId('order', body, at)).not.toBe(webhookEventId('stock', body, at));
});

it('persists before acknowledging and ignores a duplicate id', async () => {
  expect((await enqueueWebhookEvent(event('e1'))).created).toBe(true);
  expect((await enqueueWebhookEvent(event('e1', { id: 999 }))).created).toBe(false);
  const stored = (await adminDb.collection(WEBHOOK_EVENTS).doc('e1').get()).data();
  expect(stored).toMatchObject({ status: 'received', attempts: 0 });
  expect(stored?.payload).toEqual({ id: 1 });
});

it('keeps a failed event retryable instead of losing it', async () => {
  await enqueueWebhookEvent(event('e2'));
  const handler = vi.fn().mockRejectedValueOnce(new Error('Bling indisponível')).mockResolvedValueOnce(undefined);

  expect(await drainWebhookEvents(10, handler)).toEqual({ processed: 0, failed: 1, suspended: false });
  const failed = (await adminDb.collection(WEBHOOK_EVENTS).doc('e2').get()).data();
  expect(failed).toMatchObject({ status: 'failed', attempts: 1 });
  expect(failed?.error).toContain('Bling indisponível');

  expect(await drainWebhookEvents(10, handler)).toEqual({ processed: 1, failed: 0, suspended: false });
  expect((await adminDb.collection(WEBHOOK_EVENTS).doc('e2').get()).data())
    .toMatchObject({ status: 'processed', attempts: 2, error: null });
});

it('accumulates while the drain is suspended and resumes in order without reprocessing', async () => {
  for (const id of ['a', 'b', 'c']) await enqueueWebhookEvent(event(id));
  // Suspended: nothing runs, nothing is lost.
  const seen: string[] = [];
  const handler = async (queued: QueuedEvent) => { seen.push(queued.id); };
  expect((await adminDb.collection(WEBHOOK_EVENTS).where('status', '==', 'received').get()).size).toBe(3);

  expect(await drainWebhookEvents(2, handler)).toEqual({ processed: 2, failed: 0, suspended: false });
  expect(await drainWebhookEvents(10, handler)).toEqual({ processed: 1, failed: 0, suspended: false });
  expect(seen).toHaveLength(3);
  expect(new Set(seen).size).toBe(3);
  // A further drain finds nothing: processed events are never handled twice.
  expect(await drainWebhookEvents(10, handler)).toEqual({ processed: 0, failed: 0, suspended: false });
  expect(seen).toHaveLength(3);
});

it('accumulates without applying anything while the core is blocked', async () => {
  for (const id of ['m1', 'm2']) await enqueueWebhookEvent(event(id));
  await adminDb.collection('appConfig').doc('coreWriteMode').set({ mode: 'blocked' });

  const handler = vi.fn();
  expect(await drainWebhookEvents(10, handler)).toEqual({ processed: 0, failed: 0, suspended: true });
  expect(handler).not.toHaveBeenCalled();
  // Suspended is not lost: the events stay exactly as they were, ready to resume.
  expect((await adminDb.collection(WEBHOOK_EVENTS).where('status', '==', 'received').get()).size).toBe(2);

  await adminDb.collection('appConfig').doc('coreWriteMode').set({ mode: 'open' });
  expect(await drainWebhookEvents(10, handler)).toEqual({ processed: 2, failed: 0, suspended: false });
  expect(handler).toHaveBeenCalledTimes(2);
});
