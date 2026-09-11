import { beforeEach, expect, it } from 'vitest';
import { seedOperations } from './fixtures';
import { adminDb } from '../helpers/firestore';
import { createSessionToken } from '@/lib/server-auth';
import { GET as sales } from '@/app/api/operations/sales/route';
import { GET as finance } from '@/app/api/operations/finance-orders/route';
import { POST as supplies } from '@/app/api/operations/supplies/route';
const user = { id: 'ops-admin', name: 'Admin de teste', email: 'ops-admin@example.test', role: 'Administrador' };
function request(path: string, body?: unknown, origin = 'http://localhost') {
  return new Request(`http://localhost${path}`, { method: body ? 'POST' : 'GET', headers: { cookie: `brsteel_session=${createSessionToken(user)}`, origin, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
beforeEach(seedOperations);
it('denies anonymous access, validates pages, and reloads roles instead of trusting the cookie', async () => {
  expect((await sales(new Request('http://localhost/api/operations/sales'))).status).toBe(401);
  expect((await sales(request('/api/operations/sales?limit=101'))).status).toBe(400);
  const res = await sales(request('/api/operations/sales?view=summary&from=2026-09-01&to=2026-09-02'));
  expect((await res.json()).data.totalRevenue).toBe(300);
  await adminDb.collection('users').doc(user.id).update({ role: 'Operador' });
  expect((await sales(request('/api/operations/sales'))).status).toBe(403);
});
it('rejects cross-origin writes and derives movement author from the authenticated user', async () => {
  const body = { action: 'movement', data: { supplyId: 'steel', type: 'saida', quantity: 3, createdBy: 'forged' } };
  expect((await supplies(request('/api/operations/supplies', body, 'https://attacker.invalid'))).status).toBe(403);
  expect((await adminDb.collection('inventoryMovements').get()).size).toBe(0);
  const response = await supplies(request('/api/operations/supplies', body)); expect(response.status).toBe(200);
  const movement = (await adminDb.collection('inventoryMovements').get()).docs[0].data();
  expect(movement.createdBy).toBe(user.id); expect(movement.balanceAfter).toBe(7);
  await adminDb.collection('users').doc(user.id).update({ role: 'Vendedor' });
  expect((await supplies(request('/api/operations/supplies', body))).status).toBe(403);
});
it('preserves a finance-only web permission and honors immediate page deactivation', async () => {
  await adminDb.collection('users').doc(user.id).update({ role: 'Operador' });
  await adminDb.collection('appSettings').doc('general').set({ permissions: { '/financeiro/conciliacao': ['Operador'] } });
  expect((await finance(request('/api/operations/finance-orders'))).status).toBe(200);
  expect((await sales(request('/api/operations/sales'))).status).toBe(403);
  await adminDb.collection('appSettings').doc('general').update({ inactivePages: ['/financeiro/conciliacao'] });
  expect((await finance(request('/api/operations/finance-orders'))).status).toBe(403);
});
