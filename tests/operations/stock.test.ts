import { vi, beforeEach, expect, it } from 'vitest';
import { adminDb } from '../helpers/firestore';
import { seedOperations, context } from './fixtures';
const provider = vi.hoisted(() => ({ blingGetPaged: vi.fn(), blingFetchWithRefresh: vi.fn() }));
vi.mock('@/server/integrations/bling', () => provider);
import { listProductStock, invalidateProductStockCache } from '@/server/operations/stock';
import { productionDemand } from '@/server/operations/production-demand';
const mcpContext = (role = 'Administrador') => { const ctx = context(role); return { ...ctx, actor: { ...ctx.actor, source: 'mcp' as const, clientId: 'claude-test' } }; };
beforeEach(async () => { await seedOperations(); invalidateProductStockCache(); provider.blingGetPaged.mockReset(); provider.blingGetPaged.mockResolvedValue([{ id: 20, codigo: 'ZERO', nome: 'Chapa', estoque: { saldoVirtualTotal: 0, saldoVirtual: 9, saldoFisicoTotal: 0, saldoFisico: 7 } }]); });
it('preserves a real zero and the observation time when serving cached data', async () => {
  const first = await listProductStock(context(), {});
  expect(first.data[0].saldoVirtualTotal).toBe(0); expect(first.data[0].saldoFisicoTotal).toBe(0);
  expect(first.data[0].source).toBe('bling');
  const second = await listProductStock(context(), {});
  expect(second.data[0].source).toBe('cache'); expect(second.data[0].asOf).toBe(first.data[0].asOf);
  expect(provider.blingGetPaged).toHaveBeenCalledTimes(1);
});
it('returns explicit unavailability instead of fake balances, while retaining real webhooks', async () => {
  provider.blingGetPaged.mockRejectedValue(new Error('Bling offline with private provider details'));
  let response = await listProductStock(context(), {});
  expect(response.data).toEqual([]); expect(response.source).toBe('unavailable'); expect(response.warnings.join(' ')).not.toContain('private');
  await adminDb.collection('stockUpdates').doc('ZERO').set({ sku: 'ZERO', estoqueAtual: 0, lastEvent: 'stock.updated', webhookReceivedAt: new Date().toISOString() });
  await adminDb.collection('stockUpdates').doc('FAKE').set({ sku: 'FAKE', estoqueAtual: 999, lastEvent: 'stock.updated (test)' });
  response = await listProductStock(context(), {});
  expect(response.data).toHaveLength(1); expect(response.data[0].saldoVirtualTotal).toBe(0); expect(response.data[0].saldoFisicoTotal).toBeNull(); expect(response.data[0].source).toBe('webhook');
});
it('rejects simulated input and unknown balances are never zero', async () => {
  provider.blingGetPaged.mockResolvedValue([{ id: 20, codigo: 'ZERO', isSimulated: true, estoque: { saldoVirtualTotal: 100 } }]);
  expect((await listProductStock(context(), {})).data).toHaveLength(0);
  invalidateProductStockCache(); provider.blingGetPaged.mockResolvedValue([{ id: 20, codigo: 'ZERO', nome: 'Chapa' }]);
  expect((await listProductStock(context(), {})).data[0].saldoVirtualTotal).toBeNull();
});
it('allows an operational demand projection without granting access to sales documents', async () => {
  const response = await productionDemand(context('Operador'), { from: '2026-09-01', to: '2026-09-02' });
  expect(response.data[0].totalQuantitySold).toBe(6); expect(response.data[0].stockLevel).toBe(0);
  expect(JSON.stringify(response)).not.toMatch(/DOCUMENTO-PRIVADO|XML-PRIVADO|numeroDocumento|contato|"valor"/);
  await expect(productionDemand({ ...context('Operador'), inactivePages: ['/producao'] }, { from: '2026-09-01', to: '2026-09-02' })).rejects.toThrow();
});
it('never treats a deposit balance as a missing product total', async () => {
  provider.blingGetPaged.mockResolvedValue([{ id: 20, codigo: 'ZERO', estoque: { saldoVirtual: 7, saldoFisico: 8 } }]);
  const row = (await listProductStock(context(), {})).data[0];
  expect(row.saldoVirtual).toBe(7); expect(row.saldoFisico).toBe(8);
  expect(row.saldoVirtualTotal).toBeNull(); expect(row.saldoFisicoTotal).toBeNull();
});
it('preserves the stock observation time and cache origin in successive production projections', async () => {
  const first = await productionDemand(context('Operador'), { from: '2026-09-01', to: '2026-09-02' });
  const second = await productionDemand(context('Operador'), { from: '2026-09-01', to: '2026-09-02' });
  expect(first.data[0]).toMatchObject({ stockSource: 'bling', stockAsOf: expect.any(String) });
  expect(second.data[0]).toMatchObject({ stockSource: 'cache', stockAsOf: first.data[0].stockAsOf });
});
it('reads MCP stock only from the database, ignoring even a warm ERP cache', async () => {
  await listProductStock(context(), {});
  provider.blingGetPaged.mockClear(); provider.blingFetchWithRefresh.mockClear();
  const at = '2026-09-01T12:00:00.000Z';
  await adminDb.collection('stockUpdates').doc('ZERO').set({ sku: 'ZERO', nome: 'Chapa salva', produtoId: 42, estoqueAtual: 8, webhookReceivedAt: at });
  const response = await listProductStock(mcpContext(), {});
  expect(response.source).toBe('firestore');
  expect(response.data).toHaveLength(1);
  expect(response.data[0]).toMatchObject({ produto: { id: 42, codigo: 'ZERO', nome: 'Chapa salva' }, saldoVirtualTotal: 8, saldoFisicoTotal: null, physicalAsOf: null, source: 'firestore', asOf: at, virtualAsOf: at });
  expect(response.asOf).toBe(at);
  expect(provider.blingGetPaged).not.toHaveBeenCalled(); expect(provider.blingFetchWithRefresh).not.toHaveBeenCalled();
});
it('keeps persisted zero and observation times, excluding invalid and simulated stock', async () => {
  const at = '2026-09-02T12:00:00.000Z';
  for (const [id, extra] of Object.entries({ ZERO: {}, OLDER: { webhookReceivedAt: '2026-09-01T12:00:00.000Z' }, INVALID_DATE: { webhookReceivedAt: 'invalid' }, INVALID_BALANCE: { estoqueAtual: '9' }, SIMULATED: { isSimulated: true }, SIMULATED_SOURCE: { source: 'simulated' }, TEST: { lastEvent: 'stock.updated (test)' } })) {
    await adminDb.collection('stockUpdates').doc(id).set({ sku: id, estoqueAtual: 0, webhookReceivedAt: at, ...extra });
  }
  const first = await listProductStock(mcpContext(), { limit: 1 });
  const second = await listProductStock(mcpContext(), { limit: 1, cursor: first.nextCursor });
  expect([...first.data, ...second.data].map(row => row.produto.codigo)).toEqual(['OLDER', 'ZERO']);
  expect(first.asOf).toBe(at); expect(second.asOf).toBe(at); expect(second.nextCursor).toBeNull();
  expect(second.data[0]).toMatchObject({ saldoVirtual: 0, saldoVirtualTotal: 0, saldoFisico: null, saldoFisicoTotal: null, virtualAsOf: at });
  expect(provider.blingGetPaged).not.toHaveBeenCalled();
});
it('projects MCP production from saved orders and stock without contacting the ERP', async () => {
  const at = '2026-09-01T12:00:00.000Z';
  await adminDb.collection('stockUpdates').doc('ZERO').set({ sku: 'ZERO', estoqueAtual: 0, webhookReceivedAt: at });
  const operator = { ...mcpContext('Operador'), capabilities: ['producao:read' as const] };
  const response = await productionDemand(operator, { from: '2026-09-01', to: '2026-09-02' });
  expect(response.source).toBe('firestore');
  expect(response.data[0]).toMatchObject({ totalQuantitySold: 6, stockLevel: 0, stockSource: 'firestore', stockAsOf: at, stockMin: 2, stockMax: 20 });
  expect(JSON.stringify(response)).not.toMatch(/DOCUMENTO-PRIVADO|XML-PRIVADO|numeroDocumento|contato|"valor"/);
  expect(provider.blingGetPaged).not.toHaveBeenCalled(); expect(provider.blingFetchWithRefresh).not.toHaveBeenCalled();
  await expect(listProductStock(operator, {})).rejects.toThrow();
});
it('reports absent persisted stock as missing data without an ERP outage', async () => {
  provider.blingGetPaged.mockRejectedValue(new Error('Bling unavailable'));
  const stock = await listProductStock(mcpContext(), {});
  expect(stock.data).toEqual([]); expect(stock.source).toBe('firestore');
  expect(stock.warnings.join(' ')).toMatch(/Nenhum saldo.*banco/);
  const demand = await productionDemand(mcpContext('Operador'), { from: '2026-09-01', to: '2026-09-02' });
  expect(demand.source).toBe('firestore'); expect(demand.data[0].stockLevel).toBeNull();
  expect(demand.warnings.join(' ')).toMatch(/não encontrado no banco/);
  expect([...stock.warnings, ...demand.warnings].join(' ')).not.toMatch(/Bling indisponível|falha.*ERP/i);
  expect(provider.blingGetPaged).not.toHaveBeenCalled();
});
