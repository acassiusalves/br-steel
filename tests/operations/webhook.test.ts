import { beforeEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { seedOperations } from './fixtures';
import { adminDb } from '../helpers/firestore';
import { WEBHOOK_EVENTS } from '@/server/ingest/webhook-queue';
const provider = vi.hoisted(() => ({ fetch: vi.fn(), pages: vi.fn() }));
vi.mock('@/server/integrations/bling', () => ({ blingFetchWithRefresh: provider.fetch, blingGetPaged: provider.pages }));
import { POST, GET } from '@/app/api/webhook/bling/route';
const secret = 'local-webhook-only-secret';
function request(event: string, data: unknown, signed = true) {
  const body = JSON.stringify({ event, data });
  return new Request('http://localhost/api/webhook/bling', { method: 'POST', headers: signed ? { 'x-bling-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` } : {}, body });
}
beforeEach(async () => { await seedOperations(); vi.stubEnv('BLING_WEBHOOK_SECRET', secret); provider.fetch.mockReset(); });
it('fails closed for missing configuration or signature before any writes', async () => {
  expect((await POST(request('pedido_venda.deleted', { id: 1 }, false))).status).toBe(401);
  vi.stubEnv('BLING_WEBHOOK_SECRET', ''); expect((await POST(request('pedido_venda.deleted', { id: 1 }))).status).toBe(503);
  expect((await adminDb.collection('webhookDebugLogs').get()).size).toBe(0);
  expect((await adminDb.collection('salesOrders').doc('1').get()).data()?.deleted).toBeUndefined();
});
it('processes signed deletion using Admin persistence and keeps public health free of order details', async () => {
  expect((await POST(request('pedido_venda.deleted', { id: 1 }))).status).toBe(200);
  expect((await adminDb.collection('salesOrders').doc('1').get()).data()?.deleted).toBe(true);
  expect(JSON.stringify(await (await GET()).json())).not.toContain('lastOrderId');
});
it('preserves signed total zero, and never substitutes a deposit balance for an unknown total', async () => {
  provider.fetch.mockResolvedValue({ data: { codigo: 'ZERO', nome: 'Chapa' } });
  await POST(request('estoque.updated', { produto: { id: 20 }, saldoVirtualTotal: 0, deposito: { saldoVirtual: 9 } }));
  expect((await adminDb.collection('stockUpdates').doc('ZERO').get()).data()?.estoqueAtual).toBe(0);
  await POST(request('estoque.updated', { produto: { id: 20 }, deposito: { saldoVirtual: 100 } }));
  expect((await adminDb.collection('stockUpdates').doc('ZERO').get()).data()?.estoqueAtual).toBe(0);
});

it('persists the delivery before processing it and keeps a failure retryable', async () => {
  expect((await POST(request('pedido_venda.deleted', { id: 1 }))).status).toBe(200);
  const queued = (await adminDb.collection(WEBHOOK_EVENTS).get()).docs;
  expect(queued).toHaveLength(1);
  expect(queued[0].data()).toMatchObject({ topic: 'order', status: 'processed' });

  // An order the Bling API cannot return must not vanish: it stays queued as failed.
  provider.fetch.mockResolvedValue(null);
  const response = await POST(request('pedido_venda.updated', { id: 77 }));
  expect(response.status).toBe(200);
  const failed = (await adminDb.collection(WEBHOOK_EVENTS).where('status', '==', 'failed').get()).docs;
  expect(failed).toHaveLength(1);
  expect(failed[0].data().payload).toMatchObject({ data: { id: 77 } });
});

it('ignores a repeated delivery instead of processing it twice', async () => {
  await POST(request('pedido_venda.deleted', { id: 1 }));
  await adminDb.collection('salesOrders').doc('1').set({ deleted: false }, { merge: true });
  const repeated = await POST(request('pedido_venda.deleted', { id: 1 }));
  expect((await repeated.json()).message).toContain('repetida');
  // The second delivery did nothing, so the field we flipped by hand is untouched.
  expect((await adminDb.collection('salesOrders').doc('1').get()).data()?.deleted).toBe(false);
  expect((await adminDb.collection(WEBHOOK_EVENTS).get()).size).toBe(1);
});

it('does not queue anything when the signature fails', async () => {
  expect((await POST(request('pedido_venda.deleted', { id: 1 }, false))).status).toBe(401);
  expect((await adminDb.collection(WEBHOOK_EVENTS).get()).size).toBe(0);
});

it('accumulates the delivery counters instead of resetting them to one', async () => {
  await POST(request('pedido_venda.deleted', { id: 1 }));
  await POST(request('pedido_venda.deleted', { id: 2 }));
  const orders = (await adminDb.collection('appConfig').doc('webhookStatus').get()).data();
  // A set without merge replaces the document, so FieldValue.increment restarts from a missing
  // field and the counter sticks at 1 no matter how many deliveries arrive.
  expect(orders?.totalReceived).toBe(2);
  expect(orders?.lastOrderId).toBe(2);

  provider.fetch.mockResolvedValue({ data: { codigo: 'ZERO', nome: 'Chapa' } });
  await POST(request('estoque.updated', { produto: { id: 20 }, saldoVirtualTotal: 1 }));
  await POST(request('estoque.updated', { produto: { id: 20 }, saldoVirtualTotal: 2 }));
  const stock = (await adminDb.collection('appConfig').doc('stockWebhookStatus').get()).data();
  expect(stock?.totalReceived).toBe(2);
  expect(stock?.lastStock).toBe(2);
});
