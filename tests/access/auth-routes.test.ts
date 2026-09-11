import { beforeEach, expect, it } from 'vitest';
import { POST as login } from '@/app/api/auth/login/route';
import { GET as me } from '@/app/api/auth/me/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { PATCH as profile } from '@/app/api/auth/profile/route';
import { createSessionToken, hashPassword, getSessionFromRequest } from '@/lib/server-auth';
import { adminDb, resetDatabase, seedUser } from '../helpers/firestore';
const actor = { id: 'seller', name: 'Seller', email: 'seller@example.test', role: 'Vendedor' };
const password = 'original-unique-password';
const request = (path: string, method: string, body?: unknown, token?: string, origin = 'http://localhost') => new Request(`http://localhost/api/auth/${path}`, {
  method, headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { cookie: `brsteel_session=${token}` } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
beforeEach(async () => {
  await resetDatabase();
  const { hash, salt } = hashPassword(password);
  await seedUser(actor.id, { ...actor, passwordHash: hash, passwordSalt: salt });
});
it.each(['Administrador', 'Vendedor', 'Operador'])('logs in and loads the current %s profile without secrets', async role => {
  await adminDb.collection('users').doc(actor.id).update({ role });
  const response = await login(request('login', 'POST', { email: 'SELLER@example.test', password }));
  expect(response.status).toBe(200);
  expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  const token = response.headers.get('set-cookie')!.split(';')[0].slice('brsteel_session='.length);
  const result = await me(request('me', 'GET', undefined, token));
  expect(result.status).toBe(200);
  const data = await result.json();
  expect(data.user.role).toBe(role);
  expect(data.user).not.toHaveProperty('passwordHash');
});
it('rejects login for inactive accounts', async () => {
  await adminDb.collection('users').doc(actor.id).update({ active: false });
  expect((await login(request('login', 'POST', { email: actor.email, password }))).status).toBe(401);
});
it('rejects cross-origin login and profile mutations', async () => {
  expect((await login(request('login', 'POST', { email: actor.email, password }, undefined, 'https://attacker.test'))).status).toBe(403);
  const response = await profile(request('profile', 'PATCH', { name: 'Injected' }, createSessionToken(actor), 'https://attacker.test'));
  expect(response.status).toBe(403);
  expect((await adminDb.collection('users').doc(actor.id).get()).data()?.name).toBe('Seller');
});
it('changes password, invalidates previous sessions and preserves identity/role', async () => {
  const token = createSessionToken(actor);
  const response = await profile(request('profile', 'PATCH', {
    name: 'New name', currentPassword: password, newPassword: 'replacement-unique-password',
    role: 'Administrador', id: 'other-user',
  }, token));
  expect(response.status).toBe(200);
  expect(await getSessionFromRequest(request('me', 'GET', undefined, token))).toBeNull();
  const saved = (await adminDb.collection('users').doc(actor.id).get()).data()!;
  expect(saved.role).toBe('Vendedor');
  expect(saved.name).toBe('New name');
  const newCookie = response.headers.get('set-cookie')!.split(';')[0];
  const current = await me(new Request('http://localhost/api/auth/me', { headers: { cookie: newCookie } }));
  expect(current.status).toBe(200);
});
it('requires the old password for established accounts and refuses the shared initial password as a new password', async () => {
  const token = createSessionToken(actor);
  expect((await profile(request('profile', 'PATCH', { name: 'Seller', newPassword: 'different-long-password', currentPassword: 'wrong' }, token))).status).toBe(401);
  expect((await profile(request('profile', 'PATCH', { name: 'Seller', newPassword: '123456', currentPassword: password }, token))).status).toBe(400);
});
it('returns 401 for a deleted identity even when another identity has its email', async () => {
  const token = createSessionToken(actor);
  await adminDb.collection('users').doc(actor.id).delete();
  await seedUser('new-id', { email: actor.email, role: 'Administrador' });
  expect((await me(request('me', 'GET', undefined, token))).status).toBe(401);
});

it('allows only profile setup for a temporary password and revokes its session after setup', async () => {
  await adminDb.collection('users').doc(actor.id).update({ mustChangePassword: true });
  const token = createSessionToken(actor);
  expect((await profile(request('profile', 'PATCH', { name: 'Seller' }, token))).status).toBe(400);
  const result = await profile(request('profile', 'PATCH', { name: 'Seller', newPassword: 'my-personal-long-password' }, token));
  expect(result.status).toBe(200);
  expect((await result.json()).user.mustChangePassword).toBe(false);
  expect((await me(request('me', 'GET', undefined, token))).status).toBe(401);
  expect((await login(request('login', 'POST', { email: actor.email, password }))).status).toBe(401);
  expect((await login(request('login', 'POST', { email: actor.email, password: 'my-personal-long-password' }))).status).toBe(200);
});
it('does not change profiles without a session and bounds password input', async () => {
  expect((await profile(request('profile', 'PATCH', { name: 'Injected' }))).status).toBe(401);
  expect((await profile(request('profile', 'PATCH', { name: 'Seller', newPassword: 'x'.repeat(1025) }, createSessionToken(actor)))).status).toBe(400);
});
it('protects logout against cross-origin requests and clears the cookie for the application', async () => {
  expect((await logout(request('logout', 'POST', undefined, undefined, 'https://attacker.test'))).status).toBe(403);
  expect((await logout(request('logout', 'POST'))).headers.get('set-cookie')).toContain('Max-Age=0');
});
