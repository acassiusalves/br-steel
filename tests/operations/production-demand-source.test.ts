import { expect, it, vi } from 'vitest';

// Com a fonte em PostgreSQL, as semanas fechadas da tela de produção precisam vir do repositório
// trocável, não do módulo do Firestore (que para de crescer depois do corte).
const firestoreHistory = vi.fn(async () => new Map([['A', [{ week: '2000-W01', units: 999, orders: 9 }]]]));
vi.mock('@/server/persistence/source', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/persistence/source')>(),
  readOperationalSource: async () => 'postgres',
}));
vi.mock('@/server/persistence/firestore-sku-weekly-demand', () => ({ readWeeklyHistory: firestoreHistory }));
vi.mock('@/server/persistence/sku-weekly-demand', () => ({
  skuWeeklyDemandRepository: { readWeeklyHistory: async () => new Map([['A', [{ week: '2026-W36', units: 2, orders: 1 }]]]) },
}));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: () => ({ get: async () => ({ docs: [] }) }) } }));
vi.mock('@/server/operations/sales', () => ({
  readOrdersForPeriod: async () => [{ id: 1, data: '2026-08-31', notaFiscal: { id: 1 }, itens: [{ codigo: 'A', descricao: 'Chapa', quantidade: 2 }] }],
}));
vi.mock('@/server/operations/stock', () => ({
  readStockSnapshot: async () => ({ data: [], warnings: [], source: 'unavailable' }),
  readStoredStockSnapshot: async () => ({ data: [], warnings: [], source: 'firestore' }),
}));

it('takes the closed weeks from the switchable repository, not the firestore module', async () => {
  const { readFirestoreProductionDemand } = await import('@/server/persistence/firestore-production-demand');
  const response = await readFirestoreProductionDemand({ from: '2026-08-31', to: '2026-09-06' }, false);
  const row = response.data.find(item => item.sku === 'A');
  expect(row?.history.filter(point => !point.open)).toEqual([{ week: '2026-W36', units: 2, orders: 1 }]);
  expect(firestoreHistory).not.toHaveBeenCalled();
});
