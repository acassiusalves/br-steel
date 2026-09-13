import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { adminDb } from '../helpers/firestore';
import { seedOperations, context } from './fixtures';
import { pagePermissions } from '@/lib/permissions';
import type { AccessContext } from '@/server/access/types';
import { resetCoreWriteModeCache } from '@/server/operations/maintenance';
import * as supplies from '@/server/operations/supplies';
import * as production from '@/server/operations/production';

const operator: AccessContext = { actor: { userId: 'operator', role: 'Operador', source: 'web' }, active: true,
  capabilities: ['producao:read', 'producao:write'], permissions: pagePermissions, inactivePages: [] };

const setMode = async (mode: string) => {
  await adminDb.collection('appConfig').doc('coreWriteMode').set({ mode });
  resetCoreWriteModeCache();
};

beforeEach(async () => { await seedOperations(); resetCoreWriteModeCache(); });
afterEach(() => vi.restoreAllMocks());

/** Every mutation the cutover has to stop, with arguments valid enough to reach persistence. */
const mutations = (): [string, () => Promise<unknown>][] => [
  ['createSupply', () => supplies.createSupply(context(), { nome: 'N', codigo: 'X', gtin: '', unidade: 'UN', precoCusto: 1, estoqueMinimo: 1, estoqueMaximo: 2, tempoEntrega: 0 })],
  ['updateSupplyRecord', () => supplies.updateSupplyRecord(context(), 'steel', { nome: 'Outro' })],
  ['updateSupplyLimits', () => supplies.updateSupplyLimits(context(), { sku: 'ZERO', estoqueMinimo: 1 })],
  ['deleteSupplyRecord', () => supplies.deleteSupplyRecord(context(), 'steel')],
  ['recordMovement', () => supplies.recordMovement(context(), { supplyId: 'steel', type: 'entrada', quantity: 1 })],
  ['createColumn', () => production.createColumn(operator, { name: 'C', order: 0, color: '#000000' })],
  ['updateColumn', () => production.updateColumn(operator, 'queue', { name: 'C' })],
  ['deleteColumn', () => production.deleteColumn(operator, 'queue')],
  ['reorderColumns', () => production.reorderColumns(operator, [{ id: 'queue', order: 0 }])],
  ['seedDefaultColumns', () => production.seedDefaultColumns(operator)],
  ['createLot', () => production.createLot(operator, { title: 'L', columnId: 'queue', priority: 'normal', items: [{ sourceOrderId: 1, sku: 'ZERO', quantity: 1 }] })],
  ['updateLot', () => production.updateLot(operator, 'lot', { title: 'L' })],
  ['reorderLotsInColumn', () => production.reorderLotsInColumn(operator, 'queue', [{ id: 'lot', order: 0 }])],
  ['deleteLot', () => production.deleteLot(operator, 'lot')],
  ['createComment', () => production.createComment(operator, { lotId: 'lot', content: 'oi' })],
  ['updateComment', () => production.updateComment(operator, 'c1', 'oi')],
  ['deleteComment', () => production.deleteComment(operator, 'c1')],
];

it('covers every core write operation', () => {
  expect(mutations()).toHaveLength(17);
});

it('refuses every mutation before touching persistence while blocked', async () => {
  await setMode('blocked');
  const collections = vi.spyOn(adminDb, 'collection');
  for (const [name, run] of mutations()) {
    await expect(run(), name).rejects.toMatchObject({ code: 'MAINTENANCE', status: 503 });
  }
  // No operational collection was touched — not the target, and not the users lookup that precedes a
  // production write. The only read allowed is the maintenance mode itself, cached for the whole loop.
  const touched = [...new Set(collections.mock.calls.map(call => call[0]))];
  expect(touched).toEqual(['appConfig']);
});

it('refuses while draining too, since a new mutation is what draining excludes', async () => {
  await setMode('draining');
  await expect(supplies.recordMovement(context(), { supplyId: 'steel', type: 'entrada', quantity: 1 }))
    .rejects.toMatchObject({ code: 'MAINTENANCE' });
});

it('leaves reads working during the window', async () => {
  await setMode('blocked');
  expect((await supplies.listSupplies(context('Operador'), {})).data.length).toBeGreaterThan(0);
  expect((await production.listProduction(operator, { view: 'columns' })).data).toBeDefined();
});

it('accepts mutations again once the window closes, and defaults to open', async () => {
  await setMode('blocked');
  await expect(supplies.recordMovement(context(), { supplyId: 'steel', type: 'entrada', quantity: 1 }))
    .rejects.toMatchObject({ code: 'MAINTENANCE' });

  await setMode('open');
  expect((await supplies.recordMovement(context(), { supplyId: 'steel', type: 'entrada', quantity: 1 })).data.newStock).toBe(11);

  // An absent document is not a blocked core: maintenance has to be switched on deliberately.
  await adminDb.collection('appConfig').doc('coreWriteMode').delete();
  resetCoreWriteModeCache();
  expect((await supplies.recordMovement(context(), { supplyId: 'steel', type: 'entrada', quantity: 1 })).data.newStock).toBe(12);
});
