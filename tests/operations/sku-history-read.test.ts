import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { seedOperations } from './fixtures';
import { adminDb } from '../helpers/firestore';
import { resetWeeklyHistoryCache, rollUpWeek } from '@/server/persistence/firestore-sku-weekly-demand';
import { readFirestoreProductionDemand } from '@/server/persistence/firestore-production-demand';

const order = (id: number, data: string, quantidade: number) =>
  adminDb.collection('salesOrders').doc(String(id)).set({
    id, numero: id, data, total: 100, contato: { id, nome: 'Cliente' },
    notaFiscal: { id: 900 + id }, situacao: { id: 9, nome: 'Atendido', valor: 1 },
    itens: [{ id: id * 10, codigo: 'CBA600', descricao: 'Cuba', quantidade, valor: 50, unidade: 'UN' }],
  });

const rowFor = async (from: string, to: string) =>
  (await readFirestoreProductionDemand({ from, to })).data.find(row => row.sku === 'CBA600');

// Congela só o relógio, nunca os timers: este arquivo fala com o emulador por gRPC, e falsear
// setTimeout trava o cliente. `fileParallelism: false` no vitest.config torna obrigatório restaurar
// no afterEach, senão o relógio congelado vaza para o próximo arquivo.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T12:00:00Z')); // quarta de W38
  await seedOperations();
  resetWeeklyHistoryCache();
});
afterEach(() => { vi.useRealTimers(); });

it('attaches the closed weeks from the rollup', async () => {
  await order(301, '2026-09-01', 6); // W36
  await order(302, '2026-09-08', 4); // W37
  await rollUpWeek('2026-W36'); await rollUpWeek('2026-W37');
  expect((await rowFor('2026-09-01', '2026-09-16'))?.history).toMatchObject([
    { week: '2026-W36', units: 6, orders: 1 },
    { week: '2026-W37', units: 4, orders: 1 },
  ]);
});

it('adds the current week from the live aggregation, flagged as open', async () => {
  await order(303, '2026-09-08', 4); // W37, fechada
  await order(304, '2026-09-15', 7); // W38, em curso
  await rollUpWeek('2026-W37');
  const history = (await rowFor('2026-09-01', '2026-09-16'))?.history ?? [];
  expect(history.at(-1)).toEqual({ week: '2026-W38', units: 7, orders: 1, open: true });
});

it('omits the open point when the selected range does not reach the current week', async () => {
  await order(305, '2026-09-08', 4);
  await rollUpWeek('2026-W37');
  const history = (await rowFor('2026-09-01', '2026-09-13'))?.history ?? [];
  expect(history.some(point => point.open)).toBe(false);
  expect(history.at(-1)?.week).toBe('2026-W37');
});

it('returns an empty history rather than failing when the rollup has not run', async () => {
  await order(306, '2026-09-08', 4);
  expect((await rowFor('2026-09-01', '2026-09-13'))?.history).toEqual([]);
});
