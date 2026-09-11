import { actor, AUTH_ID, CLIENT_ID, oauthFixture, provider, req } from '../helpers/oauth-provider';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST as establish } from '@/app/api/mcp-auth/session/route';
import { POST as decide } from '@/app/api/mcp-auth/decision/route';
import { DELETE as revoke, GET as connections } from '@/app/api/mcp-auth/connections/route';
import { RevocationNotSentError } from '@/server/oauth/errors';
import { authorizeOAuthClaims } from '@/server/oauth/access-token';
import { createSessionToken } from '@/lib/server-auth';
import { adminDb } from '../helpers/firestore';
let cookie: string;
let id: string;
let grant: Record<string, any>;
beforeEach(async () => {
  await oauthFixture();
  const local = `brsteel_session=${createSessionToken(actor)}`;
  const response = await establish(req('session', { authorization_id: AUTH_ID }, local));
  cookie = `${local}; ${response.headers.get('set-cookie')!.split(';')[0]}`;
  expect((await decide(req('decision', { authorization_id: AUTH_ID, decision: 'approve', capabilities: ['vendas:read'] }, cookie))).status).toBe(200);
  const doc = (await adminDb.collection('mcpConnections').get()).docs[0]; id = doc.id; grant = doc.data();
});
afterEach(() => vi.unstubAllEnvs());
const claims = () => ({ sub: grant.sub, client_id: CLIENT_ID, iat: grant.validAfter, exp: grant.validAfter + 900 });
it('checks the durable grant and current local user for verified claims', async () => {
  const context = await authorizeOAuthClaims(claims());
  expect(context.actor.userId).toBe(actor.id);
  expect(context.capabilities).toEqual(['vendas:read']);
  await adminDb.collection('users').doc(actor.id).update({ role: 'Operador' });
  expect((await authorizeOAuthClaims(claims())).actor.role).toBe('Operador');
  await adminDb.collection('users').doc(actor.id).update({ active: false });
  await expect(authorizeOAuthClaims(claims())).rejects.toThrow();
});
it('rejects old generations and old authentication versions', async () => {
  await expect(authorizeOAuthClaims({ ...claims(), iat: grant.validAfter - 1 })).rejects.toThrow();
  await adminDb.collection('users').doc(actor.id).update({ authVersion: 1 });
  await expect(authorizeOAuthClaims(claims())).rejects.toThrow();
});
it('blocks locally before contacting the provider and stays blocked on provider failure', async () => {
  provider.revokeGrant.mockImplementationOnce(async () => {
    await expect(authorizeOAuthClaims(claims())).rejects.toThrow();
    throw new RevocationNotSentError();
  });
  const response = await revoke(req('connections', { connection_id: id }, cookie));
  expect(response.status).toBe(503);
  expect((await adminDb.collection('mcpConnections').doc(id).get()).data()?.status).toBe('revocation_pending');
  await expect(authorizeOAuthClaims(claims())).rejects.toThrow();
  expect((await revoke(req('connections', { connection_id: id }, cookie))).status).toBe(200);
  expect((await adminDb.collection('mcpConnections').doc(id).get()).data()?.status).toBe('revoked');
});
it('does not reactivate a grant while provider revocation remains pending', async () => {
  provider.revokeGrant.mockRejectedValue(new Error('unreachable'));
  await revoke(req('connections', { connection_id: id }, cookie));
  const nextId = 'aaaa0000-0000-4000-8000-000000000002';
  const session = await establish(req('session', { authorization_id: nextId }, cookie));
  const newCookie = `${cookie.split(';')[0]}; ${session.headers.get('set-cookie')!.split(';')[0]}`;
  expect((await decide(req('decision', { authorization_id: nextId, decision: 'approve', capabilities: ['vendas:read'] }, newCookie))).status).toBe(409);
});
it('rejects another user connection and never calls provider revocation for it', async () => {
  const ref = adminDb.collection('mcpConnections').doc('a'.repeat(64));
  await ref.set({ ...grant, userId: 'another-user' });
  expect((await revoke(req('connections', { connection_id: ref.id }, cookie))).status).toBe(404);
  expect(provider.revokeGrant).not.toHaveBeenCalled();
  const listed = await (await connections(req('connections', undefined, cookie))).json();
  expect(listed.connections.map((item: {id: string}) => item.id)).toEqual([id]);
});
it('serializes concurrent revocations so a late retry cannot revoke a new connection', async () => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  provider.revokeGrant.mockImplementationOnce(async () => { entered(); await waiting; });
  const first = revoke(req('connections', { connection_id: id }, cookie));
  await started;
  const duplicate = await revoke(req('connections', { connection_id: id }, cookie));
  release();
  expect(duplicate.status).toBe(409);
  expect((await first).status).toBe(200);
  expect(provider.revokeGrant).toHaveBeenCalledTimes(1);
});
it('blocks local access even when provider session establishment fails', async () => {
  provider.createSession.mockRejectedValueOnce(new Error('OTP unavailable'));
  expect((await revoke(req('connections', { connection_id: id }, cookie))).status).toBe(503);
  await expect(authorizeOAuthClaims(claims())).rejects.toThrow();
  expect((await adminDb.collection('mcpConnections').doc(id).get()).data()?.status).toBe('revocation_pending');
  expect(provider.revokeGrant).not.toHaveBeenCalled();
  expect((await revoke(req('connections', { connection_id: id }, cookie))).status).toBe(200);
});
it('keeps revocation ownership when a timed-out request may still finish at the provider', async () => {
  provider.revokeGrant.mockRejectedValueOnce(new Error('transport timed out after dispatch'));
  expect((await revoke(req('connections', { connection_id: id }, cookie))).status).toBe(503);
  expect((await adminDb.collection('mcpConnections').doc(id).get()).data()?.revocationAttempt).toBeTruthy();
  expect((await revoke(req('connections', { connection_id: id }, cookie))).status).toBe(409);
  expect(provider.revokeGrant).toHaveBeenCalledTimes(1);
  await expect(authorizeOAuthClaims(claims())).rejects.toThrow();
  // Even if the first external request completes later, local reconsent remains blocked.
  const nextId = 'aaaa0000-0000-4000-8000-000000000003';
  const session = await establish(req('session', { authorization_id: nextId }, cookie));
  const nextCookie = `${cookie.split(';')[0]}; ${session.headers.get('set-cookie')!.split(';')[0]}`;
  expect((await decide(req('decision', { authorization_id: nextId, decision: 'approve', capabilities: ['vendas:read'] }, nextCookie))).status).toBe(409);
});
