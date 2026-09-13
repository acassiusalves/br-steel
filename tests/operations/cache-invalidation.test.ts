import { beforeEach, expect, it, vi } from 'vitest';
import { seedOperations, context } from './fixtures';
import { adminDb } from '../helpers/firestore';
const provider = vi.hoisted(() => ({ blingGetPaged: vi.fn(), blingFetchWithRefresh: vi.fn() }));
vi.mock('@/server/integrations/bling', () => ({ blingGetPaged: provider.blingGetPaged, blingFetchWithRefresh: provider.blingFetchWithRefresh }));
import { invalidateProductStockCache, readStockSnapshot, listProductStock } from '@/server/operations/stock';
import { recordMovement } from '@/server/operations/supplies';

const product = [{ id: 20, codigo: 'ZERO', nome: 'Chapa', estoque: { saldoVirtualTotal: 3, saldoVirtual: 3, saldoFisicoTotal: 3, saldoFisico: 3 } }];
beforeEach(async () => {
  await seedOperations();
  await invalidateProductStockCache();
  provider.blingGetPaged.mockReset();
  provider.blingGetPaged.mockResolvedValue(product);
});

it('drops a cache another instance invalidated', async () => {
  await readStockSnapshot();
  await readStockSnapshot();
  expect(provider.blingGetPaged).toHaveBeenCalledTimes(1);

  // Another instance of the application invalidated after its own write. This process never ran
  // invalidateProductStockCache, so only the shared marker can tell it its copy is stale.
  await adminDb.collection('appConfig').doc('stockCacheVersion').set({ version: 99 }, { merge: true });

  await readStockSnapshot();
  expect(provider.blingGetPaged).toHaveBeenCalledTimes(2);
});

it('publishes the invalidation so other instances can see it', async () => {
  const before = Number((await adminDb.collection('appConfig').doc('stockCacheVersion').get()).data()?.version ?? 0);
  await invalidateProductStockCache();
  const after = Number((await adminDb.collection('appConfig').doc('stockCacheVersion').get()).data()?.version ?? 0);
  expect(after).toBeGreaterThan(before);
});

it('never reads the provider cache from a write path', async () => {
  await readStockSnapshot();
  provider.blingGetPaged.mockClear();
  await recordMovement(context('Operador'), { supplyId: 'steel', type: 'entrada', quantity: 1 });
  // A balance write must derive from the stored record, never from a cached provider snapshot.
  expect(provider.blingGetPaged).not.toHaveBeenCalled();
});

it('reports unavailability instead of an empty success when the provider fails', async () => {
  provider.blingGetPaged.mockRejectedValue(new Error('Bling fora do ar'));
  await (await adminDb.collection('stockUpdates').get()).docs.reduce(async (previous, doc) => {
    await previous; await doc.ref.delete();
  }, Promise.resolve());

  const snapshot = await readStockSnapshot();
  expect(snapshot.data).toEqual([]);
  expect(snapshot.source).toBe('unavailable');
  expect(snapshot.warnings.join()).toContain('Bling indisponível');
  const page = await listProductStock(context(), {});
  expect(page.source).toBe('unavailable');
});
