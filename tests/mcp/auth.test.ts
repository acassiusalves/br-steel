import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair } from 'jose';
import { handleMcp, protectedResourceMetadata } from '@/server/mcp/server';
import { authenticateMcp } from '@/server/mcp/auth';
import { adminDb } from '../helpers/firestore';
import { startIssuer, stopIssuer, mcpFixture, token, request, grantId } from './fixtures';
beforeAll(startIssuer); afterAll(stopIssuer); beforeEach(() => mcpFixture()); afterEach(() => vi.unstubAllEnvs());
describe('MCP resource authentication', () => {
  it('discovers the canonical public resource without trusting Host and challenges missing Bearer', async () => {
    const metadata = protectedResourceMetadata(new Request('http://malicious.test/.well-known/oauth-protected-resource/api/mcp'));
    expect(metadata.status).toBe(200);
    const body = await metadata.json(); expect(body.resource).toBe('http://localhost/api/mcp'); expect(body.authorization_servers[0]).toContain('/auth/v1');
    for (const method of ['POST', 'GET', 'DELETE']) {
      const response = await handleMcp(request(undefined, undefined, { cookie: 'brsteel_session=ignored' }, method));
      expect(response.status).toBe(401); expect(response.headers.get('www-authenticate')).toContain('resource_metadata="http://localhost/.well-known/oauth-protected-resource/api/mcp"');
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
  });
  it('accepts only a signed access token bound to the local identity and client', async () => {
    const valid = await token(); const principal = await authenticateMcp(request(valid));
    expect(principal.context.actor).toMatchObject({ userId: 'ops-admin', source: 'mcp' }); expect(principal.connectionId).toBe(grantId);
    const wrong = await generateKeyPair('ES256');
    for (const bad of [await token({}, wrong.privateKey), await token({ iss: 'https://wrong.test/auth/v1' }), await token({ aud: 'authenticated' }), await token({ exp: 1 }), await token({ client_id: 'cccc0000-0000-4000-8000-000000000001' }), await token({ client_id: undefined }), 'not-a-token']) {
      const response = await handleMcp(request(bad)); expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(bad);
    }
  });
  it('enforces revocation, inactive user, authVersion and explicit pilot allowlist', async () => {
    const valid = await token();
    await adminDb.collection('mcpConnections').doc(grantId).update({ status: 'revoked' }); expect((await handleMcp(request(valid))).status).toBe(401);
    await adminDb.collection('mcpConnections').doc(grantId).update({ status: 'active' });
    await adminDb.collection('users').doc('ops-admin').update({ active: false }); expect((await handleMcp(request(valid))).status).toBe(401);
    await adminDb.collection('users').doc('ops-admin').update({ active: true, authVersion: 1 }); expect((await handleMcp(request(valid))).status).toBe(401);
    await adminDb.collection('users').doc('ops-admin').update({ authVersion: 0 }); vi.stubEnv('MCP_ALLOWED_USER_IDS', ''); expect((await handleMcp(request(valid))).status).toBe(403);
    vi.stubEnv('MCP_ENABLED', 'false'); expect((await handleMcp(request(valid))).status).toBe(503);
  });
  it('checks explicit origins, permits preflight, and does not stream GET', async () => {
    const valid = await token();
    expect((await handleMcp(request(valid, undefined, { origin: 'https://evil.test' }))).status).toBe(403);
    const preflight = await handleMcp(request(undefined, undefined, { origin: 'https://claude.ai' }, 'OPTIONS'));
    expect(preflight.status).toBe(204); expect(preflight.headers.get('access-control-allow-origin')).toBe('https://claude.ai');
    expect((await handleMcp(request(valid, undefined, undefined, 'GET'))).status).toBe(405);
    vi.stubEnv('MCP_PUBLIC_URL', 'https://wrong.test/api/mcp'); expect((await handleMcp(request(valid))).status).toBe(503);
  });
});

it('authenticated access mode still requires a valid current grant and user', async () => {
  vi.stubEnv('MCP_USER_ACCESS_MODE', 'authenticated'); vi.stubEnv('MCP_ALLOWED_USER_IDS', '');
  const valid = await token();
  expect((await authenticateMcp(request(valid))).context.actor.userId).toBe('ops-admin');
  await adminDb.collection('mcpConnections').doc(grantId).update({ status: 'revoked' });
  expect((await handleMcp(request(valid))).status).toBe(401);
  await adminDb.collection('mcpConnections').doc(grantId).update({ status: 'active' });
  await adminDb.collection('users').doc('ops-admin').update({ active: false });
  expect((await handleMcp(request(valid))).status).toBe(401);
});
it('fails closed on malformed access modes', async () => {
  for (const mode of ['', 'Authenticated', 'all', ' allowlist']) {
    vi.stubEnv('MCP_USER_ACCESS_MODE', mode);
    expect((await handleMcp(request(await token()))).status).toBe(503);
  }
});
it('authenticated mode cannot widen current roles or consent capabilities', async () => {
  await mcpFixture('Operador'); vi.stubEnv('MCP_USER_ACCESS_MODE', 'authenticated'); vi.stubEnv('MCP_ALLOWED_USER_IDS', '');
  const valid = await token();
  const list = await (await handleMcp(request(valid))).json();
  expect(list.result.tools.map((tool: { name: string }) => tool.name)).not.toContain('listar_pedidos');
  await adminDb.collection('mcpConnections').doc(grantId).update({ capabilities: [] });
  const limited = await (await handleMcp(request(valid))).json();
  expect(limited.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['consultar_meu_acesso']);
});
