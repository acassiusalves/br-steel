import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { handleMcp } from '@/server/mcp/server';
import { adminDb } from '../helpers/firestore';
import { startIssuer, stopIssuer, mcpFixture, token, request } from './fixtures';

beforeAll(startIssuer);
afterAll(stopIssuer);
beforeEach(() => mcpFixture());
afterEach(() => vi.unstubAllEnvs());

it('preserves a valid slash-containing SKU in the audit entity of a real zero-stock read', async () => {
  await adminDb.collection('stockUpdates').doc('slash-sku').set({ sku: 'CHAPA/10', estoqueAtual: 0, webhookReceivedAt: new Date().toISOString() });
  const response = await handleMcp(request(await token(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'consultar_estoque_produtos', arguments: { sku: 'CHAPA/10' } } }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.result.isError).not.toBe(true);
  const output = body.result.structuredContent ?? JSON.parse(body.result.content[0].text);
  expect(output.data).toHaveLength(1);
  expect(output.data[0]).toMatchObject({ produto: { codigo: 'CHAPA/10' }, saldoVirtualTotal: 0 });
  const audits = await adminDb.collection('mcpAuditLogs').get();
  expect(audits.size).toBe(1);
  expect(audits.docs[0].data()).toMatchObject({ tool: 'consultar_estoque_produtos', result: 'success', entity: { type: 'product', id: 'CHAPA/10' } });
});

it('accepts a slash-containing SKU in consultar_historico_sku and records it in the audit entity', async () => {
  const response = await handleMcp(request(await token(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'consultar_historico_sku', arguments: { sku: 'CHAPA/10' } } }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.result.isError).not.toBe(true);
  const output = body.result.structuredContent ?? JSON.parse(body.result.content[0].text);
  expect(output.data).toEqual([]);
  const audits = await adminDb.collection('mcpAuditLogs').get();
  expect(audits.size).toBe(1);
  expect(audits.docs[0].data()).toMatchObject({ tool: 'consultar_historico_sku', result: 'success', entity: { type: 'product', id: 'CHAPA/10' } });
});

it('keeps malformed document selectors out of audit entities', async () => {
  const response = await handleMcp(request(await token(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'consultar_pedido', arguments: { id: 'bad/id' } } }));
  expect((await response.json()).result.isError).toBe(true);
  const audits = await adminDb.collection('mcpAuditLogs').get();
  expect(audits.size).toBe(1);
  expect(audits.docs[0].data()).toMatchObject({ result: 'error', entity: null });
});
