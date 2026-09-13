import { beforeEach, expect, it } from 'vitest';
import { adminDb } from '../helpers/firestore';
import { seedOperations } from './fixtures';
import { salesReadRepository } from '@/server/persistence/sales';

beforeEach(seedOperations);

it('returns current totals, product and state aggregates and the equivalent previous period', async () => {
  const response = await salesReadRepository.summarize(
    { from: '2026-09-01', to: '2026-09-02' }, { databaseOnly: true });
  expect(response.data).toEqual({
    totalRevenue: 300, totalSales: 2, averageTicket: 150, uniqueCustomers: 2,
    previousPeriod: { from: '2026-08-30', to: '2026-08-31' },
    topProducts: [{ name: 'Chapa de teste', total: 6, revenue: 300 }],
    salesByState: [{ state: 'N/A', revenue: 300 }],
    stats: {
      totalRevenue: { value: 300, change: 100 },
      totalSales: { value: 2, change: 100 },
      averageTicket: { value: 150, change: 0 },
      uniqueCustomers: { value: 2, change: 100 },
    },
  });
});

it('orders equal dates by document ID without duplicating or skipping pages', async () => {
  const original = (await adminDb.collection('salesOrders').doc('2').get()).data()!;
  await adminDb.collection('salesOrders').doc('4').set({ ...original, id: 4 });
  const input = { limit: 1, from: '2026-09-01', to: '2026-09-02' };
  const a = await salesReadRepository.list(input);
  expect(a.nextCursor).toBeTruthy();
  const b = await salesReadRepository.list({ ...input, cursor: a.nextCursor! });
  expect(b.nextCursor).toBeTruthy();
  const c = await salesReadRepository.list({ ...input, cursor: b.nextCursor! });
  expect([a.data[0].id, b.data[0].id, c.data[0].id]).toEqual([4, 2, 1]);
  expect(c.nextCursor).toBeNull();
});

it('combines date, store and status filters, including zero-valued IDs', async () => {
  await adminDb.collection('salesOrders').doc('1').update({ loja: { id: 0 }, situacao: { id: 0 } });
  await adminDb.collection('salesOrders').doc('2').update({ loja: { id: 8 }, situacao: { id: 0 } });
  await adminDb.collection('salesOrders').doc('3').update({ loja: { id: 0 }, situacao: { id: 2 } });
  const response = await salesReadRepository.list({ limit: 50, from: '2026-08-31', to: '2026-09-02', storeId: 0, statusId: 0 });
  expect(response.data.map(order => order.id)).toEqual([1]);
  expect(response.nextCursor).toBeNull();
});
