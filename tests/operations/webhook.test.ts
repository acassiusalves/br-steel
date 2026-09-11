import { beforeEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { seedOperations } from './fixtures';
import { adminDb } from '../helpers/firestore';
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
