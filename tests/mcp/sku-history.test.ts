import { beforeEach, expect, it } from 'vitest';
import { seedOperations, context } from '../operations/fixtures';
import { adminDb } from '../helpers/firestore';
import { readTools } from '@/server/mcp/read-tools';
import { resetWeeklyHistoryCache } from '@/server/persistence/firestore-sku-weekly-demand';

const tool = () => readTools.find(item => item.name === 'consultar_historico_sku')!;

beforeEach(async () => {
  await seedOperations();
  resetWeeklyHistoryCache();
  await adminDb.collection('skuWeeklyDemand').doc('CBA600').set({
    sku: 'CBA600', description: 'Cuba',
    weeks: { '2026-W35': { units: 2, orders: 1 }, '2026-W36': { units: 6, orders: 2 }, '2026-W37': { units: 4, orders: 1 } },
  });
});

it('is registered and reachable with producao:read', () => {
  expect(tool()).toBeDefined();
  expect(tool().capability).toBe('producao:read');
});

it('returns the series in chronological order', async () => {
  const response = await tool().run(context(), { sku: 'CBA600', semanas: 12 });
  expect(response.data).toEqual([
    { week: '2026-W35', units: 2, orders: 1 },
    { week: '2026-W36', units: 6, orders: 2 },
    { week: '2026-W37', units: 4, orders: 1 },
  ]);
});

it('honours the requested window, keeping the most recent weeks', async () => {
  const response = await tool().run(context(), { sku: 'CBA600', semanas: 2 });
  expect((response.data as { week: string }[]).map(point => point.week)).toEqual(['2026-W36', '2026-W37']);
});

it('warns instead of failing when the SKU has no rollup yet', async () => {
  const response = await tool().run(context(), { sku: 'NAO-EXISTE' });
  expect(response.data).toEqual([]);
  expect(response.warnings.join(' ')).toContain('Não há histórico');
});

it('refuses a role without access to production', async () => {
  await expect(tool().run(context('Vendedor'), { sku: 'CBA600' })).rejects.toThrow();
});
