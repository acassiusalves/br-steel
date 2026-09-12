import { createServer, type Server } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT, type JWTPayload } from 'jose';
import { vi } from 'vitest';
import { seedOperations } from '../operations/fixtures';
import { adminDb } from '../helpers/firestore';
import { identityBindingId } from '@/server/oauth/identity-bridge';
import { connectionId } from '@/server/oauth/grants';
import { mcpCapabilities } from '@/lib/mcp-capabilities';
export const sub = 'aaaa0000-0000-4000-8000-000000000001';
export const clientId = 'bbbb0000-0000-4000-8000-000000000001';
export const grantId = connectionId(sub, clientId);
let issuer: string;
let key: CryptoKey;
let server: Server;
export async function startIssuer() {
  const pair = await generateKeyPair('ES256'); key = pair.privateKey;
  const jwk = { ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'ES256', use: 'sig' };
  server = createServer((req, res) => {
    if (req.url !== '/auth/v1/.well-known/jwks.json') { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Invalid test listener');
  issuer = `http://127.0.0.1:${address.port}/auth/v1`;
}
export async function stopIssuer() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
export async function mcpFixture(role = 'Administrador') {
  await seedOperations();
  vi.stubEnv('MCP_ENABLED', 'true'); vi.stubEnv('MCP_OAUTH_ENABLED', 'true'); vi.stubEnv('MCP_WRITES_ENABLED', 'false');
  vi.stubEnv('MCP_ALLOWED_USER_IDS', 'ops-admin'); vi.stubEnv('MCP_ALLOWED_ORIGINS', 'https://claude.ai');
  vi.stubEnv('MCP_PUBLIC_URL', 'http://localhost/api/mcp');
  vi.stubEnv('SUPABASE_URL', issuer.replace('/auth/v1', '')); vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-public'); vi.stubEnv('SUPABASE_SECRET_KEY', 'test-private');
  await adminDb.collection('users').doc('ops-admin').update({ role });
  await adminDb.collection('mcpIdentities').doc(sub).set({ userId: 'ops-admin' });
  await adminDb.collection('mcpIdentityBindings').doc(identityBindingId('ops-admin')).set({ userId: 'ops-admin', sub, status: 'ready' });
  await adminDb.collection('mcpConnections').doc(grantId).set({ userId: 'ops-admin', sub, clientId, status: 'active', authVersion: 0, validAfter: 0, capabilities: mcpCapabilities.map(c => c.key) });
}
export async function token(overrides: JWTPayload = {}, otherKey?: CryptoKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub, client_id: clientId, iat: now, exp: now + 900, iss: issuer, aud: 'http://localhost/api/mcp', ...overrides })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' }).sign(otherKey ?? key);
}
export function request(bearer?: string, body?: unknown, extraHeaders?: Record<string, string>, method = 'POST') {
  return new Request('http://localhost/api/mcp', { method, headers: {
    'content-type': 'application/json', accept: 'application/json, text/event-stream',
    ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...extraHeaders,
  }, ...(method === 'POST' ? { body: JSON.stringify(body ?? { jsonrpc: '2.0', id: 1, method: 'tools/list' }) } : {}) });
}
