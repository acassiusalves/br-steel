import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { adminDb } from '../helpers/firestore';
import { context, seedOperations } from './fixtures';
import { getSale, listSales, readOrdersForPeriod, summarizeSales } from '@/server/operations/sales';

beforeEach(seedOperations);
afterEach(() => vi.restoreAllMocks());

it('denies commercial reads before consulting persistence', async () => {
  const collections = vi.spyOn(adminDb, 'collection');
  await expect(getSale(context('Operador'), '1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(listSales(context('Operador'), {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(summarizeSales(context('Operador'), { from: '2026-09-01', to: '2026-09-02' }))
    .rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(collections).not.toHaveBeenCalled();
});

it('preserves zero without a comparison base and database warnings for MCP', async () => {
  const ctx = context();
  const response = await summarizeSales({ ...ctx, actor: { ...ctx.actor, source: 'mcp' } },
    { from: '2020-01-01', to: '2020-01-31' });
  expect(response.source).toBe('firestore');
  expect(response.data.totalRevenue).toBe(0);
  expect(response.data.stats.totalRevenue.change).toBeNull();
  expect(response.warnings).toEqual(expect.arrayContaining([
    expect.stringContaining('Nenhum pedido encontrado no banco'),
  ]));
  expect(response.nextCursor).toBeNull();
});

it('preserves missing record and invalid cursor errors', async () => {
  await expect(getSale(context(), 'inexistente')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  await expect(listSales(context(), { cursor: 'cursor-invalido' }))
    .rejects.toMatchObject({ code: 'INVALID_CURSOR' });
});

it('rejects invalid dates, ranges and IDs before consulting persistence', async () => {
  const collections = vi.spyOn(adminDb, 'collection');
  await expect(getSale(context(), 'parent/child')).rejects.toThrow();
  await expect(listSales(context(), { from: '2026-09-02', to: '2026-09-01' })).rejects.toThrow();
  await expect(listSales(context(), { limit: 101 })).rejects.toThrow();
  await expect(summarizeSales(context(), { from: '2026-02-31', to: '2026-03-01' })).rejects.toThrow();
  await expect(readOrdersForPeriod({ from: '2026-09-02', to: '2026-09-01' })).rejects.toThrow();
  expect(collections).not.toHaveBeenCalled();
});

it('keeps finance access separate from the sales page and unavailable to MCP', async () => {
  const ctx = { ...context(), inactivePages: ['/vendas'] };
  const page = await listSales(ctx, { limit: 1 }, true);
  expect(page.data).toHaveLength(1);
  const collections = vi.spyOn(adminDb, 'collection');
  await expect(listSales(ctx, {}, false)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(listSales({ ...ctx, actor: { ...ctx.actor, source: 'mcp' } }, {}, true))
    .rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(collections).not.toHaveBeenCalled();
});

it('propagates persistence failures instead of returning empty sales', async () => {
  const failure = new Error('Test database unavailable');
  vi.spyOn(adminDb, 'collection').mockImplementation(() => { throw failure; });
  await expect(getSale(context(), '1')).rejects.toBe(failure);
  await expect(listSales(context(), {})).rejects.toBe(failure);
  await expect(summarizeSales(context(), { from: '2026-09-01', to: '2026-09-02' })).rejects.toBe(failure);
});
