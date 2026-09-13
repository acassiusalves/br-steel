import { beforeEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { seedOperations } from './fixtures';
import { adminDb } from '../helpers/firestore';
const provider = vi.hoisted(() => ({ fetch: vi.fn(), pages: vi.fn() }));
vi.mock('@/server/integrations/bling', () => ({ blingFetchWithRefresh: provider.fetch, blingGetPaged: provider.pages }));
import { POST } from '@/app/api/webhook/bling/route';
import { GET as drain } from '@/app/api/cron/bling-webhook-drain/route';
import { WEBHOOK_EVENTS } from '@/server/ingest/webhook-queue';

const secret = 'local-webhook-only-secret';
const cronSecret = 'local-cron-only-secret';
const signed = (event: string, data: unknown) => {
  const body = JSON.stringify({ event, data });
  return new Request('http://localhost/api/webhook/bling', { method: 'POST',
    headers: { 'x-bling-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` }, body });
};
const cron = (auth?: string) => new Request('http://localhost/api/cron/bling-webhook-drain',
  { headers: auth ? { authorization: auth } : {} });

beforeEach(async () => {
  await seedOperations();
  vi.stubEnv('BLING_WEBHOOK_SECRET', secret);
  vi.stubEnv('CRON_SECRET', cronSecret);
  provider.fetch.mockReset();
});

it('refuses an unauthenticated or unconfigured drain before touching the queue', async () => {
  expect((await drain(cron())).status).toBe(401);
  expect((await drain(cron('Bearer errado'))).status).toBe(401);
  vi.stubEnv('CRON_SECRET', '');
  expect((await drain(cron('Bearer ' + cronSecret))).status).toBe(503);
});

it('retries an event the webhook left failed and marks it processed', async () => {
  // The Bling API does not return the order, so the delivery is queued as failed.
  provider.fetch.mockResolvedValue(null);
  expect((await POST(signed('pedido_venda.updated', { id: 77 }))).status).toBe(200);
  const queued = (await adminDb.collection(WEBHOOK_EVENTS).where('status', '==', 'failed').get()).docs;
  expect(queued).toHaveLength(1);

  // The order shows up on the next attempt; the drain is what gets it in.
  provider.fetch.mockResolvedValue({ data: { id: 77, numero: 4242, itens: [] } });
  const response = await drain(cron('Bearer ' + cronSecret));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, processed: 1, failed: 0, suspended: false });
  expect((await adminDb.collection(WEBHOOK_EVENTS).doc(queued[0].id).get()).data())
    .toMatchObject({ status: 'processed', attempts: 1 });
  expect((await adminDb.collection('salesOrders').doc('77').get()).data()?.numero).toBe(4242);
});

it('applies nothing while the core is blocked and resumes afterwards', async () => {
  provider.fetch.mockResolvedValue(null);
  await POST(signed('pedido_venda.updated', { id: 78 }));
  await adminDb.collection('appConfig').doc('coreWriteMode').set({ mode: 'blocked' });

  provider.fetch.mockResolvedValue({ data: { id: 78, numero: 99, itens: [] } });
  expect(await (await drain(cron('Bearer ' + cronSecret))).json()).toMatchObject({ suspended: true, processed: 0 });
  expect((await adminDb.collection('salesOrders').doc('78').get()).exists).toBe(false);

  await adminDb.collection('appConfig').doc('coreWriteMode').set({ mode: 'open' });
  expect(await (await drain(cron('Bearer ' + cronSecret))).json()).toMatchObject({ suspended: false, processed: 1 });
  expect((await adminDb.collection('salesOrders').doc('78').get()).data()?.numero).toBe(99);
});
