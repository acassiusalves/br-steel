import { beforeEach, expect, it } from 'vitest';
import { adminDb, resetDatabase, seedUser } from '../helpers/firestore';
import { pagePermissions } from '@/lib/permissions';
import { mcpCapabilities } from '@/lib/mcp-capabilities';
import type { AccessContext } from '@/server/access/types';
import { requireOperation } from '@/server/operations/common';
import { readTools } from '@/server/mcp/read-tools';
const ctx: AccessContext = { actor: { userId: 'admin', role: 'Administrador', source: 'mcp', clientId: 'client' }, active: true, capabilities: mcpCapabilities.map(c => c.key), permissions: pagePermissions, inactivePages: [] };
const tool = (name: string) => readTools.find(t => t.name === name)!;
const run = (name: string, input = {}, context = ctx) => tool(name).run(context, tool(name).schema.parse(input)) as Promise<any>;
beforeEach(async () => { await resetDatabase(); await seedUser('admin', { role: 'Administrador', name: 'Actual Admin' }); });
it('registers twelve authorized reads, rejects actor injection and coerced numbers', async () => {
 expect(readTools).toHaveLength(12);
 for (const t of readTools) { if (t.capability) expect(() => requireOperation(ctx, t.capability!, t.page)).not.toThrow(); expect(t.schema.safeParse({ userId: 'admin' }).success).toBe(false); }
 const schema = tool('listar_pedidos').schema;
 expect(schema.parse({}).limit).toBe(50);
 for (const limit of [101, 0, '50']) expect(schema.safeParse({ limit }).success).toBe(false);
 const access = await run('consultar_meu_acesso'); expect(access.data.name).toBe('Actual Admin'); expect(access.data.capabilities).toEqual(['vendas:read','estoque:read','insumos:read','producao:read']);
 expect((await run('consultar_meu_acesso', {}, { ...ctx, capabilities: [] })).data.capabilities).toEqual([]);
 await expect(run('consultar_meu_acesso', {}, { ...ctx, active: false })).rejects.toThrow();
 await expect(run('consultar_meu_acesso', {}, { ...ctx, actor: { ...ctx.actor, source: 'web' } })).rejects.toThrow();
});
it('limits effective reads by current pages and role', async () => {
 const limited = { ...ctx, actor: { ...ctx.actor, role: 'Operador' }, capabilities: ['producao:read'] as AccessContext['capabilities'], inactivePages: ['/producao/kanban'] };
 await seedUser('admin', { role: 'Operador' });
 const access = await run('consultar_meu_acesso', {}, limited); expect(access.data.pages).toEqual(['/producao']);
 await expect(run('listar_lotes_producao', {}, limited)).rejects.toThrow();
 await expect(run('listar_pedidos', {}, limited)).rejects.toThrow();
});
it('returns real sales totals and minimal paginated commercial items', async () => {
 for (const [id, data, total] of [['old','2026-08-31',150],['new','2026-09-01',300]] as const) await adminDb.collection('salesOrders').doc(id).set({ id, data, total, contato: { nome: 'Customer', numeroDocumento: 'SECRET' }, xml: 'SECRET', itens: [{ codigo: 'A', quantidade: 1, valor: total, private: 'SECRET' },{ codigo: 'B', quantidade: 2 }] });
 const summary = await run('resumir_vendas', { from: '2026-09-01', to: '2026-09-01' }); expect(summary.data.stats.totalRevenue).toEqual({ value: 300, change: 100 });
 const orders = await run('listar_pedidos', { limit: 1 }); expect(orders.nextCursor).toBeTruthy(); expect(JSON.stringify(orders)).not.toContain('SECRET');
 const order = await run('consultar_pedido', { id: 'new', limit: 1 }); expect(order.data.itens).toHaveLength(1); expect(order.nextCursor).toBeTruthy();
 expect((await run('consultar_pedido', { id: 'new', limit: 1, cursor: order.nextCursor })).data.itens[0].codigo).toBe('B');
});
it('preserves zero stock and paginates SKU demand without finance', async () => {
 await adminDb.collection('stockUpdates').doc('A').set({ sku: 'A', estoqueAtual: 0, webhookReceivedAt: new Date().toISOString() });
 const stock = await run('consultar_estoque_produtos', {}); expect(stock.data[0].saldoVirtualTotal).toBe(0);
 await adminDb.collection('salesOrders').doc('sale').set({ id: 1, data: '2026-09-01', total: 999, notaFiscal: { id: 1 }, itens: [{ codigo: 'B', descricao: 'B', quantidade: 4 }, { codigo: 'A', descricao: 'A', quantidade: 2 }] });
 const input = { from: '2026-09-01', to: '2026-09-01', limit: 1 }; const demand = await run('consultar_demanda_producao', input); expect(demand.data[0].sku).toBe('A'); expect(demand.nextCursor).toBeTruthy();
 expect((await run('consultar_demanda_producao', { ...input, cursor: demand.nextCursor })).data[0].sku).toBe('B');
});
it('filters supply history by Sao Paulo civil days and paginates', async () => {
 for (const [id, createdAt] of [['a','2026-09-01T02:59:59.999Z'],['b','2026-09-01T03:00:00.000Z'],['c','2026-09-02T02:59:59.999Z'],['d','2026-09-02T03:00:00.000Z']]) await adminDb.collection('inventoryMovements').doc(id).set({ supplyId: 's', createdAt, type: 'entrada', quantity: 1, secret: 'SECRET' });
 const input = { supplyId: 's', from: '2026-09-01', to: '2026-09-01', limit: 1 }; const page = await run('listar_movimentacoes_insumo', input); expect(page.data.map((x: any) => x.id)).toEqual(['b']); expect(JSON.stringify(page)).not.toContain('SECRET');
 expect((await run('listar_movimentacoes_insumo', { ...input, cursor: page.nextCursor })).data.map((x: any) => x.id)).toEqual(['c']);
});
it('reads a lot with paginated items and strips injected private production fields', async () => {
 await adminDb.collection('productionLots').doc('lot').set({ title: 'Lot', total: 999, xml: 'SECRET', createdBy: { userId: 'admin', userName: 'Admin', password: 'SECRET' } });
 for (const id of ['a','b']) await adminDb.collection('productionLotItems').doc(id).set({ lotId: 'lot', sku: id, quantity: 1, customerName: 'SECRET', valor: 999 });
 const first = await run('consultar_lote_producao', { lotId: 'lot', limit: 1 }); expect(first.data.items).toHaveLength(1); expect(JSON.stringify(first)).not.toContain('SECRET'); expect(JSON.stringify(first)).not.toContain('999');
 expect((await run('consultar_lote_producao', { lotId: 'lot', limit: 1, cursor: first.nextCursor })).data.items[0].sku).toBe('b');
 await expect(run('consultar_lote_producao', { lotId: 'absent' })).rejects.toThrow();
});
it('bounds embedded production arrays and prevents supply private fields', async () => {
 await adminDb.collection('supplies').doc('s').set({ nome: 'Steel', codigo: 'S', estoqueAtual: 0, private: 'SECRET' });
 expect((await run('listar_insumos')).data).toEqual([{ id: 's', nome: 'Steel', codigo: 'S', estoqueAtual: 0 }]);
 await adminDb.collection('productionLots').doc('lot').set({ linkedOrderIds: Array.from({ length: 101 }, (_,i) => String(i)) });
 const lots = await run('listar_lotes_producao'); expect(lots.data[0].linkedOrderIds).toHaveLength(100); expect(lots.warnings.length).toBeGreaterThan(0);
});
it('handles historical Sao Paulo daylight saving midnight transition', async () => {
 for (const [id,createdAt] of [['a','2018-11-04T02:59:59.999Z'],['b','2018-11-04T03:00:00.000Z']]) await adminDb.collection('inventoryMovements').doc(id).set({ supplyId: 's', createdAt });
 expect((await run('listar_movimentacoes_insumo', { supplyId: 's', from: '2018-11-04', to: '2018-11-04' })).data.map((x: any) => x.id)).toEqual(['b']);
});
it('lets a production-only operator continue past item 100 without commercial data', async () => {
 const operator: AccessContext = { ...ctx, actor: { ...ctx.actor, role: 'Operador' }, capabilities: ['producao:read'] };
 await adminDb.collection('salesOrders').doc('large').set({ numero: 501, total: 999, contato: { nome: 'PRIVATE' }, xml: 'PRIVATE', itens: Array.from({ length: 101 }, (_,i) => ({ id: i + 1, codigo: `SKU-${i+1}`, descricao: 'Steel', quantidade: 1, unidade: 'KG', valor: 999, customerName: 'PRIVATE' })) });
 const listed = await run('listar_pedidos_para_producao', {}, operator);
 expect(listed.data[0].itens).toHaveLength(100);
 const first = await run('listar_pedidos_para_producao', { orderId: 'large', limit: 100 }, operator);
 expect(first.data[0].itens).toHaveLength(100); expect(first.nextCursor).toBeTruthy();
 const last = await run('listar_pedidos_para_producao', { orderId: 'large', limit: 100, cursor: first.nextCursor }, operator);
 expect(last.data[0].itens).toEqual([{ id: 101, codigo: 'SKU-101', descricao: 'Steel', quantidade: 1, unidade: 'KG' }]); expect(last.nextCursor).toBeNull();
 expect(JSON.stringify([listed, first, last])).not.toContain('PRIVATE'); expect(JSON.stringify([listed, first, last])).not.toContain('999');
 await expect(run('consultar_pedido', { id: 'large' }, operator)).rejects.toThrow();
 await expect(run('listar_pedidos_para_producao', { orderId: 'large', cursor: '-1' }, operator)).rejects.toThrow();
 await expect(run('listar_pedidos_para_producao', { orderId: 'missing' }, operator)).rejects.toThrow();
 await expect(run('listar_pedidos_para_producao', { orderId: 'large' }, { ...operator, inactivePages: ['/producao/kanban'] })).rejects.toThrow();
});
