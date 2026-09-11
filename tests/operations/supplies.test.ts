import { beforeEach, expect, it } from 'vitest';
import { adminDb } from '../helpers/firestore';
import { seedOperations, context } from './fixtures';
import { listSupplies, createSupply, updateSupplyLimits, recordMovement } from '@/server/operations/supplies';
beforeEach(seedOperations);
it('protects reading and validates limits against the existing stored values', async () => {
  expect((await listSupplies(context('Operador'), {})).data[0].estoqueAtual).toBe(10);
  await expect(listSupplies(context('Vendedor'), {})).rejects.toThrow();
  await expect(updateSupplyLimits(context('Operador'), { sku: 'ZERO', estoqueMinimo: 25 })).rejects.toThrow();
  await expect(updateSupplyLimits(context(), { sku: 'MISSING', estoqueMinimo: 1, estoqueMaximo: 3 })).rejects.toThrow();
  await updateSupplyLimits(context('Operador'), { sku: 'ZERO', estoqueMinimo: 5, estoqueMaximo: 30 });
  expect((await adminDb.collection('supplies').doc('steel').get()).data()?.estoqueMaximo).toBe(30);
});
it('records movements atomically with authenticated authorship and warns about negative stock', async () => {
  const result = await recordMovement(context('Operador'), { supplyId: 'steel', type: 'saida', quantity: 12, createdBy: 'attacker' });
  expect(result.data.newStock).toBe(-2); expect(result.warnings.length).toBeGreaterThan(0);
  const movement = (await adminDb.collection('inventoryMovements').get()).docs[0].data();
  expect(movement.createdBy).toBe('ops-admin');
  await Promise.all([recordMovement(context(), { supplyId: 'steel', type: 'entrada', quantity: 5 }), recordMovement(context(), { supplyId: 'steel', type: 'entrada', quantity: 7 })]);
  expect((await adminDb.collection('supplies').doc('steel').get()).data()?.estoqueAtual).toBe(10);
});
it('rejects invalid quantities and unauthorized mutations without changing balances', async () => {
  for (const quantity of [0, -1, Infinity, NaN]) await expect(recordMovement(context(), { supplyId: 'steel', type: 'entrada', quantity })).rejects.toThrow();
  await expect(recordMovement(context('Vendedor'), { supplyId: 'steel', type: 'entrada', quantity: 1 })).rejects.toThrow();
  const draft = { nome: 'New', codigo: 'NEW', gtin: '', unidade: 'UN', precoCusto: 1, estoqueMinimo: 5, estoqueMaximo: 2, tempoEntrega: 0 };
  await expect(createSupply(context(), draft)).rejects.toThrow();
  expect((await adminDb.collection('supplies').doc('steel').get()).data()?.estoqueAtual).toBe(10);
});
