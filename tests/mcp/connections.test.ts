import { beforeEach, expect, it } from 'vitest';
import { oauthFixture, actor, CLIENT_ID } from '../helpers/oauth-provider';
import { adminDb, seedUser } from '../helpers/firestore';
import { createSessionToken } from '@/lib/server-auth';
import { GET, DELETE } from '@/app/api/mcp-auth/connections/route';
import { connectionId } from '@/server/oauth/grants';
import { identityBindingId } from '@/server/oauth/identity-bridge';

beforeEach(oauthFixture);

const other = { id: 'outro-usuario', name: 'Outro', email: 'outro@example.test', role: 'Administrador' };

const request = (method: 'GET' | 'DELETE', body?: unknown, who: typeof actor = actor) =>
  new Request('http://localhost/api/mcp-auth/connections', {
    method,
    headers: { origin: 'http://localhost', cookie: `brsteel_session=${createSessionToken(who)}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** Revocation checks that the bound identity matches the connection, so the binding is part of the state. */
async function bindIdentity(userId: string, sub: string, email: string) {
  await adminDb.collection('mcpIdentityBindings').doc(identityBindingId(userId)).set({ userId, sub, email, status: 'ready' });
  await adminDb.collection('mcpIdentities').doc(sub).set({ userId, email });
}

async function seedConnection(userId: string, sub: string, over: Record<string, unknown> = {}) {
  const id = connectionId(sub, CLIENT_ID);
  await adminDb.collection('mcpConnections').doc(id).set({
    userId, sub, clientId: CLIENT_ID, clientName: 'Claude de teste',
    capabilities: ['vendas:read', 'estoque:read'], status: 'active', authVersion: 1, validAfter: 0,
    approvedAt: Date.UTC(2026, 8, 11, 12), revokedAt: null, approvalId: 'a'.repeat(32), ...over,
  });
  return id;
}

it('lists only the connections the caller owns', async () => {
  await seedConnection(actor.id, 'sub-proprio');
  await seedConnection(other.id, 'sub-alheio');
  await seedUser(other.id, other);

  const body = await (await GET(request('GET'))).json();
  expect(body.ok).toBe(true);
  expect(body.connections).toHaveLength(1);
  expect(body.connections[0].clientName).toBe('Claude de teste');
});

it('distinguishes authorized, last use and revoked', async () => {
  const active = await seedConnection(actor.id, 'sub-ativo', { lastSeenAt: Date.UTC(2026, 8, 12, 18) });
  await seedConnection(actor.id, 'sub-revogado', {
    status: 'revoked', revokedAt: Date.UTC(2026, 8, 12, 20), lastSeenAt: null,
  });

  const { connections } = await (await GET(request('GET'))).json();
  const byId = Object.fromEntries(connections.map((c: { id: string }) => [c.id, c]));

  // Last use is what tells a person the connection is actually being used, not merely authorized.
  expect(byId[active]).toMatchObject({ status: 'active', approvedAt: Date.UTC(2026, 8, 11, 12), lastSeenAt: Date.UTC(2026, 8, 12, 18) });
  expect(byId[active].capabilities).toEqual(['vendas:read', 'estoque:read']);
  const revoked = connections.find((c: { status: string }) => c.status === 'revoked');
  expect(revoked).toMatchObject({ revokedAt: Date.UTC(2026, 8, 12, 20), lastSeenAt: null });
});

it('never reveals the provider subject or the approval identifier', async () => {
  await seedConnection(actor.id, 'sub-secreto');
  const { connections } = await (await GET(request('GET'))).json();
  const serialized = JSON.stringify(connections);
  expect(serialized).not.toContain('sub-secreto');
  expect(serialized).not.toContain('a'.repeat(32));
});

it('refuses to revoke a connection owned by someone else', async () => {
  const alheia = await seedConnection(other.id, 'sub-alheio');
  await seedUser(other.id, other);

  const response = await DELETE(request('DELETE', { connection_id: alheia }));
  expect(response.status).toBe(404);
  // The refusal must not even mark it as pending revocation.
  expect((await adminDb.collection('mcpConnections').doc(alheia).get()).data()?.status).toBe('active');
});

it('revokes the caller own connection', async () => {
  const propria = await seedConnection(actor.id, 'sub-proprio');
  await bindIdentity(actor.id, 'sub-proprio', actor.email);
  expect((await DELETE(request('DELETE', { connection_id: propria }))).status).toBe(200);
  expect((await adminDb.collection('mcpConnections').doc(propria).get()).data()?.status).toBe('revoked');
});

it('refuses revocation when the bound identity does not match the connection', async () => {
  const propria = await seedConnection(actor.id, 'sub-proprio');
  // A binding pointing elsewhere must stop the revocation instead of revoking someone else's grant.
  await bindIdentity(actor.id, 'sub-diferente', actor.email);
  expect((await DELETE(request('DELETE', { connection_id: propria }))).status).toBe(409);
});
