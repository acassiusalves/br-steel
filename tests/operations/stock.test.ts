import { vi, beforeEach, expect, it } from 'vitest';
import { adminDb } from '../helpers/firestore';
import { seedOperations, context } from './fixtures';
const provider = vi.hoisted(() => ({ blingGetPaged: vi.fn(), blingFetchWithRefresh: vi.fn() }));
vi.mock('@/server/integrations/bling', () => provider);
import { listProductStock, invalidateProductStockCache } from '@/server/operations/stock';
import { productionDemand } from '@/server/operations/production-demand';
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
