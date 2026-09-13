import { beforeEach, expect, it } from 'vitest';
import { adminDb, resetDatabase, seedUser } from '../helpers/firestore';
import { pagePermissions } from '@/lib/permissions';
import type { AccessContext } from '@/server/access/types';
import * as production from '@/server/operations/production';

const ctx: AccessContext = { actor: { userId: 'operator', role: 'Operador', source: 'web' }, active: true,
  capabilities: ['producao:read', 'producao:write'], permissions: pagePermissions, inactivePages: [] };
const admin: AccessContext = { ...ctx, actor: { userId: 'boss', role: 'Administrador', source: 'web' } };
const lot = (items = [{ sourceOrderId: 123, sku: 'SKU', quantity: 2 }]) =>
  ({ title: 'Lote', columnId: 'queue', priority: 'normal' as const, items });

beforeEach(async () => {
  await resetDatabase();
  await seedUser('operator', { role: 'Operador', name: 'Actual Operator', active: true });
  await seedUser('boss', { role: 'Administrador', name: 'Chefe', active: true });
  await adminDb.collection('productionColumns').doc('queue').set({ name: 'Fila', order: 0, color: '#000000' });
  await adminDb.collection('salesOrders').doc('123').set({ id: 123, numero: 456, total: 999,
    contato: { nome: 'Private', cpf: 'secret' }, xml: 'secret',
    itens: [{ id: 1, codigo: 'SKU', descricao: 'Steel', quantidade: 5, unidade: 'KG', valor: 100 }] });
});

it('pins the lot validation codes and the 400 item ceiling', async () => {
  await expect(production.createLot(ctx, lot([{ sourceOrderId: 123, sku: 'OUTRO', quantity: 1 }])))
    .rejects.toMatchObject({ code: 'INVALID_ITEM' });
  await expect(production.createLot(ctx, lot([{ sourceOrderId: 123, sku: 'SKU', quantity: 6 }])))
    .rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
  // Two entries that are individually valid but together exceed the ordered quantity.
  await expect(production.createLot(ctx, lot([{ sourceOrderId: 123, sku: 'SKU', quantity: 3 },
    { sourceOrderId: 123, sku: 'SKU', quantity: 3 }]))).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
  await expect(production.createLot(ctx, lot(Array(401).fill({ sourceOrderId: 123, sku: 'SKU', quantity: 0.01 }))))
    .rejects.toMatchObject({ code: 'TOO_LARGE', status: 413 });
  await expect(production.createLot(ctx, { ...lot(), columnId: 'missing' }))
    .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  expect((await adminDb.collection('productionLots').get()).size).toBe(0);
});

it('pins the annual lot number format and derives authorship from the caller', async () => {
  const created = await production.createLot(ctx, lot());
  expect(created.data.lotNumber).toMatch(new RegExp(`^LOT-${new Date().getUTCFullYear()}-\\d{4}$`));
  const stored = (await adminDb.collection('productionLots').doc(created.data.id).get()).data()!;
  expect(stored.createdBy).toEqual({ userId: 'operator', userName: 'Actual Operator' });

  await seedUser('inactive', { role: 'Operador', name: 'Desligado', active: false });
  await expect(production.createLot(ctx, { ...lot(), assignedTo: { userId: 'inactive' } }))
    .rejects.toMatchObject({ code: 'INVALID_USER', status: 400 });
  await expect(production.createLot({ ...ctx, actor: { ...ctx.actor, userId: 'fantasma' } }, lot()))
    .rejects.toMatchObject({ code: 'NOT_FOUND' });
});

it('pins column and lot containment rules', async () => {
  const created = await production.createLot(ctx, lot());
  await expect(production.deleteColumn(ctx, 'queue')).rejects.toMatchObject({ code: 'COLUMN_NOT_EMPTY' });
  const other = await production.createColumn(ctx, { name: 'Outra', order: 1, color: '#123456' });
  await expect(production.reorderLotsInColumn(ctx, other.data.id, [{ id: created.data.id, order: 0 }]))
    .rejects.toMatchObject({ code: 'INVALID_COLUMN' });
  await expect(production.reorderColumns(ctx, [{ id: 'queue', order: 0 }, { id: 'queue', order: 1 }]))
    .rejects.toThrow();
});

it('pins comment ownership and the associated record ceiling on deletion', async () => {
  const created = await production.createLot(ctx, lot());
  const comment = await production.createComment(ctx, { lotId: created.data.id, content: 'Olá' });
  // Authorship is what matters, not seniority: another operator is refused even with the same role.
  await seedUser('other', { role: 'Operador', name: 'Outro', active: true });
  await expect(production.updateComment({ ...ctx, actor: { ...ctx.actor, userId: 'other' } }, comment.data.id, 'x'))
    .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  // An Administrador overrides authorship.
  await production.updateComment(admin, comment.data.id, 'editado pelo administrador');
  expect((await adminDb.collection('productionComments').doc(comment.data.id).get()).data()?.content)
    .toBe('editado pelo administrador');

  // Seeded directly: the ceiling under test is deleteLot's, not createComment's throughput.
  for (let start = 0; start < 498; start += 400) {
    const batch = adminDb.batch();
    for (let index = start; index < Math.min(start + 400, 498); index++) {
      batch.set(adminDb.collection('productionComments').doc(`bulk-${index}`),
        { lotId: created.data.id, content: 'x', author: { userId: 'operator' }, createdAt: new Date().toISOString() });
    }
    await batch.commit();
  }
  await expect(production.deleteLot(ctx, created.data.id)).rejects.toMatchObject({ code: 'TOO_LARGE' });
}, 60000);
