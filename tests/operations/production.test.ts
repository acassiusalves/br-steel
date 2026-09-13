import { beforeEach, describe, expect, it } from 'vitest';
import { adminDb, resetDatabase, seedUser } from '../helpers/firestore';
import { pagePermissions } from '@/lib/permissions';
import type { AccessContext } from '@/server/access/types';
import * as production from '@/server/operations/production';
const ctx: AccessContext = { actor: { userId: 'operator', role: 'Operador', source: 'web' }, active: true, capabilities: ['producao:read', 'producao:write'], permissions: pagePermissions, inactivePages: [] };
const input = { title: 'Lote', columnId: 'queue', priority: 'normal', createdBy: { userId: 'forged', userName: 'forged' }, items: [{ sourceOrderId: 123, sku: 'SKU', quantity: 2, productName: 'forged', unit: 'forged', sourceOrderNumber: 'forged', customerName: 'private' }] };
beforeEach(async () => {
  await resetDatabase();
  await seedUser('operator', { role: 'Operador', name: 'Actual Operator', active: true });
  await adminDb.collection('productionColumns').doc('queue').set({ name: 'Fila', order: 0, color: '#000000' });
  await adminDb.collection('salesOrders').doc('123').set({ id: 123, numero: 456, total: 999, contato: { nome: 'Private', cpf: 'secret' }, xml: 'secret', itens: [{ id: 1, codigo: 'SKU', descricao: 'Steel', quantidade: 5, unidade: 'KG', valor: 100 }] });
});
describe('production operations', () => {
  it('initializes defaults once and validates column CRUD/reorders', async () => {
    await adminDb.collection('productionColumns').doc('queue').delete();
    await Promise.all([production.seedDefaultColumns(ctx), production.seedDefaultColumns(ctx)]);
    expect((await adminDb.collection('productionColumns').get()).size).toBe(3);
    const { data: column } = await production.createColumn(ctx, { name: 'Extra', order: 3, color: '#123456' });
    await production.updateColumn(ctx, column.id, { name: 'Updated' });
    await production.reorderColumns(ctx, [{ id: column.id, order: 0 }]);
    expect((await adminDb.collection('productionColumns').doc(column.id).get()).data()).toMatchObject({ name: 'Updated', order: 0 });
    await expect(production.updateColumn(ctx, column.id, { private: 'injected' })).rejects.toThrow();
    await production.deleteColumn(ctx, column.id);
    expect((await adminDb.collection('productionColumns').doc(column.id).get()).exists).toBe(false);
  });
  it('paginates projections and rejects traversal IDs and unknown read filters', async () => {
    await adminDb.collection('salesOrders').doc('124').set({ numero: 457, itens: [] });
    const first = await production.listProduction(ctx, { view: 'orders', limit: 1 });
    const second = await production.listProduction(ctx, { view: 'orders', limit: 1, cursor: first.nextCursor });
    expect(first.data).toHaveLength(1); expect(second.data).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy(); expect(second.nextCursor).toBeNull();
    await expect(production.listProduction(ctx, { view: 'items', lotId: '../123' })).rejects.toThrow();
    await expect(production.listProduction(ctx, { view: 'orders', collection: 'users' })).rejects.toThrow();
  });
  it('moves and reorders only lots belonging to a valid column, suppresses legacy private fields', async () => {
    const { data: lot } = await production.createLot(ctx, input);
    await adminDb.collection('productionLots').doc(lot.id).update({ invoiceXml: 'secret', contato: { cpf: 'secret' }, 'createdBy.password': 'secret' });
    const response = await production.listProduction(ctx, { view: 'lots' });
    expect(JSON.stringify(response.data)).not.toContain('secret');
    const { data: target } = await production.createColumn(ctx, { name: 'Other', order: 1, color: '#123456' });
    await expect(production.reorderLotsInColumn(ctx, target.id, [{ id: lot.id, order: 0 }])).rejects.toThrow();
    await production.updateLot(ctx, lot.id, { columnId: target.id, columnOrder: 0 });
    await production.reorderLotsInColumn(ctx, target.id, [{ id: lot.id, order: 2 }]);
    expect((await adminDb.collection('productionLots').doc(lot.id).get()).data()).toMatchObject({ columnId: target.id, columnOrder: 2 });
    await production.deleteColumn(ctx, 'queue');
  });
  it('projects orders without sales or contact fields for production-only operator', async () => {
    const response = await production.listProduction(ctx, { view: 'orders' });
    expect(response.data).toEqual([{ id: '123', numero: 456, itens: [{ id: 1, codigo: 'SKU', descricao: 'Steel', quantidade: 5, unidade: 'KG' }] }]);
  });
  it('derives author and item business fields and allocates distinct concurrent numbers', async () => {
    const created = await Promise.all([production.createLot(ctx, input), production.createLot(ctx, input)]);
    expect(new Set(created.map(x => x.data.lotNumber)).size).toBe(2);
    const lot = (await adminDb.collection('productionLots').doc(created[0].data.id).get()).data()!;
    expect(lot.createdBy).toEqual({ userId: 'operator', userName: 'Actual Operator' });
    const item = (await adminDb.collection('productionLotItems').where('lotId', '==', created[0].data.id).get()).docs[0].data();
    expect(item).toMatchObject({ productName: 'Steel', unit: 'KG', sourceOrderNumber: '456', customerName: '' });
    // Two concurrent creations contend on the counter document and the emulator retries the loser.
    // Under full-suite load that can exceed the 5s default; the contention is expected, the timeout is not.
  }, 30000);
  it('rejects seller mutations and inactive production module', async () => {
    await expect(production.createLot({ ...ctx, actor: { ...ctx.actor, role: 'Vendedor' } }, input)).rejects.toThrow();
    await expect(production.listProduction({ ...ctx, inactivePages: ['/producao/kanban'] }, { view: 'lots' })).rejects.toThrow();
  });
  it('rejects invalid references, excessive quantities, duplicate quantity bypass, and oversized requests', async () => {
    for (const patch of [{ columnId: 'missing' }, { items: [{ ...input.items[0], sku: 'missing' }] }, { items: [{ ...input.items[0], quantity: 6 }] }, { items: [input.items[0], input.items[0], input.items[0]] }, { items: Array(401).fill(input.items[0]) }]) {
      await expect(production.createLot(ctx, { ...input, ...patch })).rejects.toThrow();
    }
    expect((await adminDb.collection('productionLots').get()).size).toBe(0);
  });
  it('validates assignees and derives persisted names', async () => {
    await seedUser('seller', { role: 'Vendedor' });
    await expect(production.createLot(ctx, { ...input, assignedTo: { userId: 'seller' } })).rejects.toThrow();
    const created = await production.createLot(ctx, { ...input, assignedTo: { userId: 'operator', userName: 'forged' } });
    expect((await adminDb.collection('productionLots').doc(created.data.id).get()).data()?.assignedTo.userName).toBe('Actual Operator');
  });
  it('validates moves, column deletion and comment ownership, then atomically deletes children', async () => {
    const { data: lot } = await production.createLot(ctx, input);
    await expect(production.deleteColumn(ctx, 'queue')).rejects.toThrow();
    await expect(production.updateLot(ctx, lot.id, { columnId: 'missing' })).rejects.toThrow();
    const { data: comment } = await production.createComment(ctx, { lotId: lot.id, content: 'Hello', author: { userId: 'fake' } });
    expect((await adminDb.collection('productionComments').doc(comment.id).get()).data()?.author.userId).toBe('operator');
    await expect(production.updateComment({ ...ctx, actor: { ...ctx.actor, userId: 'other' } }, comment.id, 'attack')).rejects.toThrow();
    await production.deleteLot(ctx, lot.id);
    expect((await adminDb.collection('productionLotItems').get()).empty).toBe(true);
    expect((await adminDb.collection('productionComments').get()).empty).toBe(true);
  });
});
