import { expect, it, vi } from 'vitest';
import { context } from './fixtures';

// A fonte PostgreSQL não pode ser exercitada aqui sem um banco: o repositório e a fonte são trocados
// por dublês para provar só que a operação informa a fonte real, e não 'firestore' fixo.
vi.mock('@/server/persistence/source', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/persistence/source')>(),
  readOperationalSource: async () => 'postgres',
}));
vi.mock('@/server/persistence/sku-weekly-demand', () => ({
  skuWeeklyDemandRepository: { readWeeklyHistory: async () => new Map([['A', [{ week: '2026-W36', units: 2, orders: 1 }]]]) },
}));

it('labels the series with the postgres source when that is the active one', async () => {
  const { skuHistory } = await import('@/server/operations/sku-history');
  const response = await skuHistory(context(), { sku: 'A', semanas: 4 });
  expect(response.source).toBe('postgres');
  expect(response.data).toEqual([{ week: '2026-W36', units: 2, orders: 1 }]);
});
