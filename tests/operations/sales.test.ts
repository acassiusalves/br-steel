import { beforeEach, expect, it } from 'vitest';
import { adminDb } from '../helpers/firestore';
import { seedOperations, context } from './fixtures';
import { summarizeSales, listSales } from '@/server/operations/sales';
beforeEach(seedOperations);
it('calculates totals and comparison against the equivalent previous period', async () => {
  const summary = await summarizeSales(context(), { from: '2026-09-01', to: '2026-09-02' });
  expect(summary.source).toBe('firestore');
  expect(summary.data.totalRevenue).toBe(300); expect(summary.data.totalSales).toBe(2);
  expect(summary.data.stats.totalRevenue.change).toBe(100);
  expect(summary.data.averageTicket).toBe(150);
  await adminDb.collection('salesOrders').doc('3').delete();
  const zero = await summarizeSales(context(), { from: '2026-09-01', to: '2026-09-02' });
  expect(zero.data.stats.totalRevenue.change).toBeNull(); expect(zero.warnings.length).toBeGreaterThan(0);
});
it('paginates imported orders and enforces the module before querying', async () => {
  const first = await listSales(context('Vendedor'), { limit: 1, from: '2026-09-01', to: '2026-09-02' });
  expect(first.data).toHaveLength(1); expect(first.nextCursor).toBeTruthy();
  const next = await listSales(context('Vendedor'), { limit: 1, from: '2026-09-01', to: '2026-09-02', cursor: first.nextCursor! });
  expect(next.data[0].id).not.toBe(first.data[0].id); expect(next.nextCursor).toBeNull();
  await expect(listSales(context('Operador'), {})).rejects.toThrow();
  await expect(listSales({ ...context(), inactivePages: ['/vendas'] }, {})).rejects.toThrow();
  await expect(summarizeSales(context(), { from: '2026-02-31', to: '2026-03-01' })).rejects.toThrow();
});
