import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { adminDb } from '../helpers/firestore';
import { seedOperations, context } from './fixtures';
import { createSupply, deleteSupplyRecord, recordMovement, updateSupplyRecord } from '@/server/operations/supplies';

beforeEach(seedOperations);
afterEach(() => vi.restoreAllMocks());

const draft = (overrides: Record<string, unknown> = {}) => ({
  nome: 'Novo insumo', codigo: 'NOVO', gtin: '', unidade: 'UN',
  precoCusto: 1, estoqueMinimo: 1, estoqueMaximo: 10, tempoEntrega: 0, ...overrides,
});

it('denies writes before reaching persistence', async () => {
  const collections = vi.spyOn(adminDb, 'collection');
  await expect(createSupply(context('Vendedor'), draft())).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  await expect(recordMovement(context('Vendedor'), { supplyId: 'steel', type: 'entrada', quantity: 1 }))
    .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  await expect(deleteSupplyRecord(context('Vendedor'), 'steel')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  expect(collections).not.toHaveBeenCalled();
});

it('keeps SKU uniqueness and limit validation at their current codes', async () => {
  await expect(createSupply(context(), draft({ codigo: 'ZERO' })))
    .rejects.toMatchObject({ code: 'DUPLICATE_SKU', status: 409 });
  await expect(createSupply(context(), draft({ estoqueMinimo: 5, estoqueMaximo: 2 })))
    .rejects.toMatchObject({ code: 'INVALID_LIMITS' });
  // The stored value participates: a partial update may not cross the limits already persisted.
  await expect(updateSupplyRecord(context(), 'steel', { estoqueMinimo: 25 }))
    .rejects.toMatchObject({ code: 'INVALID_LIMITS' });

  const created = await createSupply(context(), draft());
  expect((await adminDb.collection('supplies').doc(created.data.id).get()).data()?.estoqueAtual).toBe(0);
  const codes = await adminDb.collection('supplyCodes').get();
  expect(codes.size).toBe(1);
});

it('refuses to delete a supply carrying balance or history', async () => {
  await expect(deleteSupplyRecord(context(), 'steel')).rejects.toMatchObject({ code: 'SUPPLY_IN_USE', status: 409 });

  const empty = await createSupply(context(), draft());
  await recordMovement(context(), { supplyId: empty.data.id, type: 'entrada', quantity: 2 });
  await recordMovement(context(), { supplyId: empty.data.id, type: 'saida', quantity: 2 });
  // Balance is back to zero but the history remains, so the record stays.
  await expect(deleteSupplyRecord(context(), empty.data.id)).rejects.toMatchObject({ code: 'SUPPLY_IN_USE', status: 409 });

  const unused = await createSupply(context(), draft({ codigo: 'SEM-USO' }));
  await deleteSupplyRecord(context(), unused.data.id);
  expect((await adminDb.collection('supplies').doc(unused.data.id).get()).exists).toBe(false);
});

it('rejects a corrupted stored balance and allows a negative one with a warning', async () => {
  await adminDb.collection('supplies').doc('broken').set({ ...draft({ codigo: 'QUEBRADO' }), estoqueAtual: 'dez' });
  await expect(recordMovement(context(), { supplyId: 'broken', type: 'entrada', quantity: 1 }))
    .rejects.toMatchObject({ code: 'INVALID_BALANCE' });

  const negative = await recordMovement(context(), { supplyId: 'steel', type: 'saida', quantity: 12 });
  expect(negative.data.newStock).toBe(-2);
  expect(negative.warnings).toEqual(expect.arrayContaining([expect.stringContaining('negativo')]));
  const movement = (await adminDb.collection('inventoryMovements').get()).docs[0].data();
  expect(movement.balanceAfter).toBe(-2);
  expect(movement.createdBy).toBe('ops-admin');
});
