import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { discoverOAuthProtectedResourceMetadata, discoverAuthorizationServerMetadata } from '@modelcontextprotocol/sdk/client/auth.js';
import { adminDb } from '../src/lib/firebase-admin';
/** Called only by the guarded local OAuth proof after real login/consent/code exchange. */
export async function verifyLocalMcp(bearer: string, userId: string) {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
  const resource = 'http://localhost:9003/api/mcp';
  assert.equal(process.env.MCP_PUBLIC_URL, resource);
  assert.equal(userId, process.env.MCP_LOCAL_VERIFY_USER_ID);
  const prm = await discoverOAuthProtectedResourceMetadata(resource);
  assert.equal(prm.resource, resource);
  assert.deepEqual(prm.authorization_servers, ['http://127.0.0.1:55321/auth/v1']);
  const issuer = await discoverAuthorizationServerMetadata(prm.authorization_servers![0]);
  assert.equal(issuer?.issuer, prm.authorization_servers![0]);
  assert.ok(issuer?.code_challenge_methods_supported?.includes('S256'));
  const unauthorized = await fetch(resource);
  assert.equal(unauthorized.status, 401); assert.ok(unauthorized.headers.get('www-authenticate')?.includes('resource_metadata'));
  const id = Number.parseInt(randomBytes(6).toString('hex'), 16);
  const sku = `MCP-LOCAL-${id}`;
  const owned: FirebaseFirestore.DocumentReference[] = [];
  async function create(collection: string, key: string, data: Record<string, unknown>) {
    const ref = adminDb.collection(collection).doc(key); await ref.create(data); owned.push(ref);
  }
  const client = new Client({ name: 'br-steel-real-oauth-proof', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { authorization: `Bearer ${bearer}` } } });
  const roles: Record<string, string[]> = {};
  try {
    for (const [offset, data, total, quantidade] of [[0, '2071-09-01', 100, 2], [1, '2071-09-02', 200, 4], [2, '2071-08-31', 150, 3]] as const) {
      await create('salesOrders', String(id + offset), { id: id + offset, numero: id + offset, data, total,
        contato: { id: 1, nome: 'Cliente sintético', numeroDocumento: 'PRIVATE-DOCUMENT' }, notaFiscal: { id: id + offset, xml: 'PRIVATE-XML' },
        itens: [{ id: id + offset, codigo: sku, descricao: 'Chapa local', quantidade, valor: 50, unidade: 'UN' }] });
    }
    await create('stockUpdates', sku, { sku, nome: 'Chapa local', estoqueAtual: 0, webhookReceivedAt: new Date().toISOString() });
    await client.connect(transport);
    for (const role of ['Administrador', 'Vendedor', 'Operador']) {
      await adminDb.collection('users').doc(userId).update({ role });
      const tools = (await client.listTools()).tools.map(tool => tool.name); roles[role] = tools;
      const access = await client.callTool({ name: 'consultar_meu_acesso', arguments: {} });
      assert.equal(access.isError, undefined); assert.equal((access.structuredContent as any).data.role, role);
      if (role !== 'Operador') {
        const summary = await client.callTool({ name: 'resumir_vendas', arguments: { from: '2071-09-01', to: '2071-09-02' } });
        assert.equal(summary.isError, undefined);
        const data = (summary.structuredContent as any).data; assert.equal(data.totalRevenue, 300); assert.equal(data.stats.totalRevenue.change, 100);
        const stock = await client.callTool({ name: 'consultar_estoque_produtos', arguments: { sku } });
        assert.equal(stock.isError, undefined); const row = (stock.structuredContent as any).data[0];
        assert.equal(row.saldoVirtualTotal, 0); assert.equal(row.saldoFisicoTotal, null); assert.equal(row.source, 'webhook');
      } else {
        assert.ok(!tools.includes('listar_pedidos'));
        assert.equal((await client.callTool({ name: 'listar_pedidos', arguments: {} })).isError, true);
        const demand = await client.callTool({ name: 'consultar_demanda_producao', arguments: { from: '2071-09-01', to: '2071-09-02' } });
        assert.equal(demand.isError, undefined); const serialized = JSON.stringify(demand);
        assert.ok(!serialized.includes('PRIVATE-') && !serialized.includes('Cliente sintético'));
        assert.ok((demand.structuredContent as any).data.some((row: any) => row.sku === sku && row.stockLevel === 0), 'Invoiced fixture SKU must appear in production demand with real zero stock');
      }
      if (role === 'Vendedor') {
        assert.ok(!tools.includes('listar_lotes_producao'));
        assert.equal((await client.callTool({ name: 'listar_lotes_producao', arguments: {} })).isError, true);
      }
    }
    const logs = await adminDb.collection('mcpAuditLogs').where('userId', '==', userId).get();
    assert.ok(logs.size >= 8); assert.ok(logs.docs.some(doc => doc.data().result === 'error'));
    const text = JSON.stringify(logs.docs.map(doc => doc.data())); assert.ok(!text.includes(bearer) && !text.includes('PRIVATE-'));
    return { sdkDiscovery: true, realHttpAndOAuth: true, salesTotal: 300, revenueChangePercent: 100, zeroStock: true, restrictedProductionProjection: true, roles, hostedClaude: false };
  } finally {
    await client.close();
    await adminDb.collection('users').doc(userId).update({ role: 'Administrador' });
    for (const ref of owned) await ref.delete();
    for (const doc of (await adminDb.collection('mcpAuditLogs').where('userId', '==', userId).get()).docs) await doc.ref.delete();
  }
}
