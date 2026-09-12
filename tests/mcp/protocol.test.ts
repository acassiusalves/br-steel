import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { handleMcp } from '@/server/mcp/server';
import { consumeRateLimit } from '@/server/mcp/rate-limit';
import { authenticateMcp } from '@/server/mcp/auth';
import { adminDb, loadRules } from '../helpers/firestore';
import { startIssuer, stopIssuer, mcpFixture, token, request, grantId } from './fixtures';
import { assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
beforeAll(startIssuer); afterAll(stopIssuer); beforeEach(() => mcpFixture()); afterEach(() => vi.unstubAllEnvs());
async function sdkClient() {
  const bearer = await token();
  const responses: Response[] = [];
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/api/mcp'), {
    requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    fetch: async (url, init) => { const response = await handleMcp(new Request(url, init)); responses.push(response.clone()); return response; },
  });
  const client = new Client({ name: 'integration-test', version: '1.0.0' }); await client.connect(transport);
  return { client, responses, bearer };
}
it('official SDK initializes, lists only read tools, calls real data, notifies and validates schemas', async () => {
  const { client, responses } = await sdkClient();
  try {
    expect(client.getServerVersion()?.name).toBe('br-steel');
    const list = await client.listTools(); expect(list.tools).toHaveLength(12);
    expect(list.tools.every(t => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(list.tools.find(t => t.name === 'listar_pedidos')?.inputSchema.additionalProperties).toBe(false);
    const summary = await client.callTool({ name: 'resumir_vendas', arguments: { from: '2026-09-01', to: '2026-09-02' } });
    expect(summary.isError).not.toBe(true); expect(JSON.stringify(summary)).toContain('300');
    const bad = await client.callTool({ name: 'listar_pedidos', arguments: { userId: 'forged' } }); expect(bad.isError).toBe(true);
    const missing = await client.callTool({ name: 'consultar_pedido', arguments: { id: 'missing' } }); expect(missing.isError).toBe(true);
    await client.notification({ method: 'notifications/initialized' });
    expect(responses.some(r => r.status === 202)).toBe(true); expect(responses.every(r => !r.headers.has('mcp-session-id'))).toBe(true);
    const audit = await adminDb.collection('mcpAuditLogs').get(); expect(audit.size).toBe(3);
    expect(audit.docs.map(d => d.data().result)).toEqual(expect.arrayContaining(['success', 'error']));
    expect(audit.docs.find(d => d.data().tool === 'consultar_pedido')?.data().entity).toEqual({ type: 'order', id: 'missing' });
    expect(audit.docs.find(d => d.data().tool === 'resumir_vendas')?.data().entity).toBeNull();
    expect(audit.docs.every(d => d.data().userId === 'ops-admin' && d.data().argumentsHash.length === 64 && d.data().expiresAt.toMillis() > Date.now())).toBe(true);
    expect(JSON.stringify(audit.docs.map(d => d.data()))).not.toMatch(/DOCUMENTO-PRIVADO|XML-PRIVADO|forged/);
    expect((await adminDb.collection('mcpConnections').doc(grantId).get()).data()?.lastSeenAt).toBeGreaterThan(0);
  } finally { await client.close(); }
});
it('reloads role, capability, inactive page and revocation between requests, refusing a hidden name', async () => {
  const { client, bearer } = await sdkClient();
  try {
    await adminDb.collection('users').doc('ops-admin').update({ role: 'Operador' });
    const list = await client.listTools(); expect(list.tools.some(t => t.name === 'listar_pedidos')).toBe(false); expect(list.tools.some(t => t.name === 'listar_lotes_producao')).toBe(true);
    expect((await client.callTool({ name: 'listar_pedidos', arguments: {} })).isError).toBe(true);
    await adminDb.collection('appSettings').doc('general').set({ inactivePages: ['/producao/kanban'] });
    expect((await client.listTools()).tools.some(t => t.name === 'listar_lotes_producao')).toBe(false);
    await adminDb.collection('mcpConnections').doc(grantId).update({ capabilities: [] }); expect((await client.listTools()).tools.map(t => t.name)).toEqual(['consultar_meu_acesso']);
    await adminDb.collection('mcpConnections').doc(grantId).update({ status: 'revoked' }); expect((await handleMcp(request(bearer))).status).toBe(401);
  } finally { await client.close(); }
});
it('bounds bodies and outputs and negotiates protocol through SDK', async () => {
  const bearer = await token();
  expect((await handleMcp(request(bearer, { payload: 'a'.repeat(65536) }))).status).toBe(413);
  const huge = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('a'.repeat(65537))); controller.close(); } });
  const chunked = new Request('http://localhost/api/mcp', { method: 'POST', headers: { authorization: `Bearer ${bearer}` }, body: huge, duplex: 'half' } as RequestInit);
  expect((await handleMcp(chunked)).status).toBe(413);
  const badProtocol = await handleMcp(request(bearer, undefined, { 'mcp-protocol-version': 'invalid' })); expect(badProtocol.status).toBe(400);
  await adminDb.collection('supplies').doc('steel').update({ nome: 'a'.repeat(270000) });
  const response = await handleMcp(request(bearer, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'listar_insumos', arguments: {} } }));
  const text = await response.text(); expect(Buffer.byteLength(text)).toBeLessThan(262144); expect(JSON.parse(text).result.isError).toBe(true); expect(text).toContain('OUTPUT_LIMIT');
});
it('uses a durable shared limit, rejects the next call with Retry-After, and rolls to next minute', async () => {
  const bearer = await token(); const principal = await authenticateMcp(request(bearer));
  const now = 1_800_000_000_000;
  const { rateLimitId } = await import('@/server/mcp/rate-limit');
  const counter = adminDb.collection('mcpRateLimits').doc(rateLimitId(principal, 'read', Math.floor(now / 60000)));
  await counter.set({ count: 59 });
  const lastSlot = await Promise.allSettled([consumeRateLimit(principal, 'read', now), consumeRateLimit(principal, 'read', now)]);
  expect(lastSlot.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(lastSlot.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 429 } });
  expect((await counter.get()).data()?.count).toBe(60);
  await expect(consumeRateLimit(principal, 'read', now + 60000)).resolves.toBeUndefined();
  const currentMinute = Math.floor(Date.now() / 60000);
  await adminDb.collection('mcpRateLimits').doc(rateLimitId(principal, 'read', currentMinute)).set({ count: 60 });
  const response = await handleMcp(request(bearer, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'listar_insumos', arguments: {} } }));
  expect(response.status).toBe(429); expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
});
it('denies direct browser access to new durable state', async () => {
  const rules = await loadRules();
  try { for (const collection of ['mcpAuditLogs', 'mcpRateLimits']) {
    const ref = doc(rules.unauthenticatedContext().firestore(), collection, 'test');
    await assertFails(getDoc(ref)); await assertFails(setDoc(ref, { allowed: true }));
  } } finally { await rules.cleanup(); }
});
