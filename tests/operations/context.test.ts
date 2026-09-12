import { beforeEach, expect, it } from 'vitest';
import { resetDatabase, seedUser, adminDb, cookieJar } from '../helpers/firestore';
import { createSessionToken, hashPassword } from '@/lib/server-auth';
import { requireWebContext } from '@/server/operations/context';
import { requireOperation } from '@/server/operations/common';
const user = { id: 'operations-user', email: 'operations@example.test', name: 'Operations', role: 'Vendedor' };
beforeEach(async () => { await resetDatabase(); const { hash, salt } = hashPassword('individual-operations-password'); await seedUser(user.id, { ...user, passwordHash: hash, passwordSalt: salt }); });
it('derives current identity and role from the cookie, never request data', async () => {
  const request = new Request('http://localhost/api/operations/sales', { method: 'POST', headers: { cookie: `brsteel_session=${createSessionToken(user)}` }, body: JSON.stringify({ role: 'Administrador', userId: 'someone-else' }) });
  expect((await requireWebContext(request)).actor).toEqual({ userId: user.id, role: 'Vendedor', source: 'web' });
  await adminDb.collection('users').doc(user.id).update({ role: 'Operador' });
  expect((await requireWebContext(request)).actor.role).toBe('Operador');
  await expect(requireWebContext(new Request('http://localhost/api/operations/sales'))).rejects.toThrow();
});
it('refuses temporary credentials, inactive pages and unauthorized writes', async () => {
  cookieJar.value = createSessionToken(user);
  const context = await requireWebContext();
  expect(() => requireOperation(context, 'producao:write', '/producao/kanban')).toThrow();
  await adminDb.collection('appSettings').doc('general').set({ inactivePages: ['/vendas'] });
  expect(() => requireOperation({ ...context, inactivePages: ['/vendas'] }, 'vendas:read')).toThrow();
  await adminDb.collection('users').doc(user.id).update({ mustChangePassword: true });
  await expect(requireWebContext()).rejects.toThrow();
});
