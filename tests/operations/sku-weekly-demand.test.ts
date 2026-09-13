import { beforeEach, expect, it } from 'vitest';
import { seedOperations } from './fixtures';
import { adminDb } from '../helpers/firestore';
import { readWeeklyHistory, resetWeeklyHistoryCache, rollUpPendingWeeks, rollUpWeek, WEEKLY_DEMAND } from '@/server/persistence/firestore-sku-weekly-demand';

/** Pedido faturado no dia civil informado, com um item do SKU. */
const order = (id: number, data: string, codigo: string, quantidade: number, over: Record<string, unknown> = {}) =>
  adminDb.collection('salesOrders').doc(String(id)).set({
    id, numero: id, data, total: 100, contato: { id, nome: 'Cliente' },
    notaFiscal: { id: 900 + id }, situacao: { id: 9, nome: 'Atendido', valor: 1 },
    itens: [{ id: id * 10, codigo, descricao: `Peça ${codigo}`, quantidade, valor: 50, unidade: 'UN' }],
    ...over,
  });

const weeksOf = async (sku: string) => (await adminDb.collection(WEEKLY_DEMAND).doc(sku).get()).data()?.weeks ?? {};

// O cache é de processo e sobrevive ao reset do banco: sem isto um teste serviria dado do anterior.
beforeEach(async () => { await seedOperations(); resetWeeklyHistoryCache(); });

it('buckets a Sunday-night order into the week that is closing', async () => {
  // `data` é o dia civil que o Bling já entrega; 2026-09-13 é domingo, último dia de W37.
  await order(101, '2026-09-13', 'CBA600', 4);
  await order(102, '2026-09-14', 'CBA600', 9); // segunda: W38
  await rollUpWeek('2026-W37');
  expect(await weeksOf('CBA600')).toEqual({ '2026-W37': { units: 4, orders: 1 } });
});

it('counts distinct orders and sums quantities across items', async () => {
  await order(103, '2026-09-08', 'CBA600', 3);
  await order(104, '2026-09-09', 'CBA600', 5);
  await rollUpWeek('2026-W37');
  expect(await weeksOf('CBA600')).toEqual({ '2026-W37': { units: 8, orders: 2 } });
});

it('leaves cancelled orders out, matching the live aggregation', async () => {
  await order(105, '2026-09-08', 'CBA600', 3);
  await order(106, '2026-09-09', 'CBA600', 50, { situacao: { id: 12, nome: 'Cancelado', valor: 2 } });
  await rollUpWeek('2026-W37');
  expect(await weeksOf('CBA600')).toEqual({ '2026-W37': { units: 3, orders: 1 } });
});

it('is idempotent: the same week twice produces the same document', async () => {
  await order(107, '2026-09-08', 'CBA600', 3);
  await rollUpWeek('2026-W37');
  const first = await weeksOf('CBA600');
  await rollUpWeek('2026-W37');
  expect(await weeksOf('CBA600')).toEqual(first);
});

it('closes every pending week in one run after a missed schedule', async () => {
  await order(108, '2026-08-25', 'CBA600', 2); // W35
  await order(109, '2026-09-01', 'CBA600', 6); // W36
  await order(110, '2026-09-08', 'CBA600', 4); // W37
  await adminDb.collection('appConfig').doc('skuWeeklyDemandRollup').set({ lastClosedWeek: '2026-W34' });
  const run = await rollUpPendingWeeks(new Date('2026-09-16T12:00:00Z')); // quarta de W38
  expect(run.weeks).toEqual(['2026-W35', '2026-W36', '2026-W37']);
  expect(await weeksOf('CBA600')).toEqual({
    '2026-W35': { units: 2, orders: 1 }, '2026-W36': { units: 6, orders: 1 }, '2026-W37': { units: 4, orders: 1 },
  });
  expect((await adminDb.collection('appConfig').doc('skuWeeklyDemandRollup').get()).data()?.lastClosedWeek).toBe('2026-W37');
});

it('never writes the current week', async () => {
  await order(111, '2026-09-15', 'CBA600', 7); // terça de W38, semana em curso
  const run = await rollUpPendingWeeks(new Date('2026-09-16T12:00:00Z'));
  expect(run.weeks).not.toContain('2026-W38');
  expect(await weeksOf('CBA600')).not.toHaveProperty('2026-W38');
});

it('prunes weeks beyond the retention window', async () => {
  await adminDb.collection(WEEKLY_DEMAND).doc('CBA600').set({
    sku: 'CBA600', weeks: { '2024-W01': { units: 1, orders: 1 }, '2026-W36': { units: 2, orders: 1 } },
  });
  await order(112, '2026-09-08', 'CBA600', 4);
  await rollUpWeek('2026-W37', new Date('2026-09-16T12:00:00Z'));
  const weeks = await weeksOf('CBA600');
  expect(weeks).not.toHaveProperty('2024-W01');
  expect(weeks).toHaveProperty('2026-W36');
  expect(weeks).toHaveProperty('2026-W37');
});

it('reads back the most recent weeks in chronological order', async () => {
  await order(113, '2026-09-01', 'CBA600', 6);
  await order(114, '2026-09-08', 'CBA600', 4);
  await rollUpWeek('2026-W36');
  await rollUpWeek('2026-W37');
  const history = await readWeeklyHistory(2);
  expect(history.get('CBA600')).toEqual([
    { week: '2026-W36', units: 6, orders: 1 },
    { week: '2026-W37', units: 4, orders: 1 },
  ]);
});

it('honours the requested window and does not serve a stale cache after a rollup', async () => {
  await order(115, '2026-09-01', 'CBA600', 6);
  await rollUpWeek('2026-W36');
  expect((await readWeeklyHistory(12)).get('CBA600')).toHaveLength(1);

  // Fechar outra semana precisa aparecer na leitura seguinte, não daqui a dez minutos.
  await order(116, '2026-09-08', 'CBA600', 4);
  await rollUpWeek('2026-W37');
  expect((await readWeeklyHistory(12)).get('CBA600')).toHaveLength(2);
  expect((await readWeeklyHistory(1)).get('CBA600')).toEqual([{ week: '2026-W37', units: 4, orders: 1 }]);
});
