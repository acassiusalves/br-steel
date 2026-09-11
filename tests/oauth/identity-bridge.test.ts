import { actor, AUTH_ID, oauthFixture, provider, req } from '../helpers/oauth-provider';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST as establish } from '@/app/api/mcp-auth/session/route';
import { GET as authorization } from '@/app/api/mcp-auth/authorization/route';
import { ensureOAuthIdentity } from '@/server/oauth/identity-bridge';
import { adminDb } from '../helpers/firestore';
import { createSessionToken } from '@/lib/server-auth';

beforeEach(oauthFixture);
afterEach(() => vi.unstubAllEnvs());
it('requires a current local session, completed first access, and same-origin request', async () => {
  expect((await establish(req('session', { authorization_id: AUTH_ID }, ''))).status).toBe(401);
  expect((await establish(req('session', { authorization_id: AUTH_ID }, undefined, 'https://attacker.test'))).status).toBe(403);
  await adminDb.collection('users').doc(actor.id).update({ mustChangePassword: true });
  expect((await establish(req('session', { authorization_id: AUTH_ID }))).status).toBe(403);
  expect(provider.ensureIdentity).not.toHaveBeenCalled();
});
it('derives identity server-side and sends no OTP or Supabase token in JSON', async () => {
  const response = await establish(req('session', { authorization_id: AUTH_ID, userId: 'victim', email: 'victim@example.test', role: 'Administrador' }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  const cookie = response.headers.get('set-cookie')!;
  expect(cookie).toContain('HttpOnly');
  expect(cookie).not.toContain('private-access-token');
  expect(cookie).not.toContain('private-refresh-token');
  const identities = await adminDb.collection('mcpIdentities').get();
  expect(identities.docs.map(d => d.data().userId)).toEqual([actor.id]);
  expect(provider.ensureIdentity.mock.calls[0][1].email).toBe(actor.email);
});
it('reserves one immutable sub across concurrent provisioning and retry', async () => {
  const [first, second] = await Promise.all([ensureOAuthIdentity(actor), ensureOAuthIdentity(actor)]);
  expect(first.sub).toBe(second.sub);
  expect((await adminDb.collection('mcpIdentities').get()).size).toBe(1);
  expect((await adminDb.collection('mcpIdentityBindings').get()).size).toBe(1);
});
it('fails closed on identity collision and does not adopt a preexisting email', async () => {
  provider.ensureIdentity.mockRejectedValueOnce(new Error('provider email collision'));
  expect((await establish(req('session', { authorization_id: AUTH_ID }))).status).toBeGreaterThanOrEqual(400);
  expect((await adminDb.collection('mcpIdentities').get()).size).toBe(0);
  const identity = await ensureOAuthIdentity(actor);
  await adminDb.collection('mcpIdentities').doc(identity.sub).update({ userId: 'someone-else' });
  await expect(ensureOAuthIdentity(actor)).rejects.toThrow();
});
it('rejects a bridge cookie after switching the local account', async () => {
  const response = await establish(req('session', { authorization_id: AUTH_ID }));
  const bridgeCookie = response.headers.get('set-cookie')!.split(';')[0];
  await adminDb.collection('users').doc('other-user').set({ ...(await adminDb.collection('users').doc(actor.id).get()).data(), name: 'Other', email: 'other@example.test' });
  const cookie = `brsteel_session=${createSessionToken({ ...actor, id: 'other-user' })}; ${bridgeCookie}`;
  expect((await authorization(req(`authorization?authorization_id=${AUTH_ID}`, undefined, cookie))).status).toBe(401);
});
it('does not follow provider auto-consent redirects or widen an existing connection', async () => {
  provider.getAuthorizationDetails.mockResolvedValueOnce({ redirect_url: 'https://client.example.test/callback?code=hidden' });
  const response = await establish(req('session', { authorization_id: AUTH_ID }));
  expect(response.status).toBe(409);
  expect((await adminDb.collection('mcpConnections').get()).size).toBe(0);
  expect(await response.text()).not.toContain('hidden');
});
