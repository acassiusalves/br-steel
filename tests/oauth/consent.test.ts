import { actor, AUTH_ID, CLIENT_ID, oauthFixture, provider, req } from '../helpers/oauth-provider';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST as establish } from '@/app/api/mcp-auth/session/route';
import { POST as decide } from '@/app/api/mcp-auth/decision/route';
import { GET as authorization } from '@/app/api/mcp-auth/authorization/route';
import { createSessionToken } from '@/lib/server-auth';
import { adminDb } from '../helpers/firestore';
let cookie: string;
beforeEach(async () => {
  await oauthFixture();
  const local = `brsteel_session=${createSessionToken(actor)}`;
  const response = await establish(req('session', { authorization_id: AUTH_ID }, local));
  expect(response.status).toBe(200);
  cookie = `${local}; ${response.headers.get('set-cookie')!.split(';')[0]}`;
});
afterEach(() => vi.unstubAllEnvs());
it('shows the real provider client and currently eligible capabilities', async () => {
  const response = await authorization(req(`authorization?authorization_id=${AUTH_ID}`, undefined, cookie));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.authorization.client.id).toBe(CLIENT_ID);
  expect(body.authorization.redirect_uri).toBe('https://client.example.test/callback');
  expect(body.capabilities.map((c: {key: string}) => c.key)).toContain('producao:write');
  expect(JSON.stringify(body)).not.toContain('private-access-token');
});
it('rechecks current role, inactive pages and capability selection before approval', async () => {
  await adminDb.collection('users').doc(actor.id).update({ role: 'Vendedor' });
  expect((await decide(req('decision', { authorization_id: AUTH_ID, decision: 'approve', capabilities: ['producao:write'] }, cookie))).status).toBe(403);
  await adminDb.collection('appSettings').doc('general').set({ inactivePages: ['/vendas'] });
  expect((await decide(req('decision', { authorization_id: AUTH_ID, decision: 'approve', capabilities: ['vendas:read'] }, cookie))).status).toBe(403);
  expect(provider.approveAuthorization).not.toHaveBeenCalled();
});
it('persists pending before provider approval and activates only after success', async () => {
  provider.approveAuthorization.mockImplementationOnce(async () => {
    const pending = await adminDb.collection('mcpConnections').get();
    expect(pending.docs[0].data().status).toBe('pending');
    return 'https://client.example.test/callback?code=provider-code';
  });
  const response = await decide(req('decision', { authorization_id: AUTH_ID, decision: 'approve', capabilities: ['vendas:read'] }, cookie));
  expect(response.status).toBe(200);
  const connection = (await adminDb.collection('mcpConnections').get()).docs[0].data();
  expect(connection.status).toBe('active');
  expect(connection.capabilities).toEqual(['vendas:read']);
  expect(connection.userId).toBe(actor.id);
});
it('rolls back failed or uncertain approval and blocks while provider revocation fails', async () => {
  provider.approveAuthorization.mockRejectedValueOnce(new Error('provider timeout with secret'));
  provider.revokeGrant.mockRejectedValueOnce(new Error('unreachable'));
  const response = await decide(req('decision', { authorization_id: AUTH_ID, decision: 'approve', capabilities: ['vendas:read'] }, cookie));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('with secret');
  expect((await adminDb.collection('mcpConnections').get()).docs[0].data().status).toBe('revocation_pending');
});
it('rejects concurrent duplicate decisions and does not issue two approvals', async () => {
  const body = { authorization_id: AUTH_ID, decision: 'approve', capabilities: ['vendas:read'] };
  const responses = await Promise.all([decide(req('decision', body, cookie)), decide(req('decision', body, cookie))]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  expect(provider.approveAuthorization).toHaveBeenCalledTimes(1);
});
it('denial calls provider and creates no active grant', async () => {
  const response = await decide(req('decision', { authorization_id: AUTH_ID, decision: 'deny', capabilities: [] }, cookie));
  expect(response.status).toBe(200);
  expect(provider.denyAuthorization).toHaveBeenCalledTimes(1);
  expect((await adminDb.collection('mcpConnections').get()).size).toBe(0);
});
it('rejects redirect substitution even in a malformed provider response', async () => {
  provider.approveAuthorization.mockResolvedValueOnce('https://attacker.test/steal?code=secret');
  const response = await decide(req('decision', { authorization_id: AUTH_ID, decision: 'approve', capabilities: ['vendas:read'] }, cookie));
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(await response.text()).not.toContain('attacker');
  expect((await adminDb.collection('mcpConnections').get()).docs[0].data().status).not.toBe('active');
});
