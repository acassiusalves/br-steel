import 'server-only';
import { FieldPath } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import type { SalesListInput, SalesRange, SalesReadRepository } from './sales-contract';
import type { SaleOrder } from '@/types/sale-order';
import { dateSchema, dateRangeSchema, documentIdSchema, result, OperationError } from '@/server/operations/common';
function ordersQuery(input: { from?: string; to?: string; storeId?: number; statusId?: number }) {
  let query: FirebaseFirestore.Query = adminDb.collection('salesOrders');
  if (input.from) query = query.where('data', '>=', input.from);
  if (input.to) query = query.where('data', '<=', input.to);
  if (input.storeId !== undefined) query = query.where('loja.id', '==', input.storeId);
  if (input.statusId !== undefined) query = query.where('situacao.id', '==', input.statusId);
  return query;
}
/** Internal persistence read; callers must authorize the appropriate sales or operational projection. */
async function readOrdersForPeriod(input: SalesRange): Promise<SaleOrder[]> {
  const range = dateRangeSchema.parse(input);
  return (await ordersQuery(range).get()).docs.map(doc => doc.data() as SaleOrder);
}
async function list(input: SalesListInput) {
  let query = ordersQuery(input).orderBy('data', 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (input.cursor) {
    try { const cursor = z.object({ date: dateSchema, id: documentIdSchema }).parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))); query = query.startAfter(cursor.date, cursor.id); }
    catch { throw new OperationError('INVALID_CURSOR', 'Paginação inválida.'); }
  }
  const snapshot = await query.limit(input.limit + 1).get(); const docs = snapshot.docs.slice(0, input.limit); const last = docs.at(-1);
  const nextCursor = snapshot.size > input.limit ? Buffer.from(JSON.stringify({ date: last!.data().data, id: last!.id })).toString('base64url') : null;
  return result(docs.map(doc => doc.data() as SaleOrder), 'firestore', [], nextCursor);
}
async function get(id: string) {
  const doc = await adminDb.collection('salesOrders').doc(id).get();
  if (!doc.exists) throw new OperationError('NOT_FOUND', 'Pedido não encontrado.', 404);
  return result(doc.data() as SaleOrder);
}
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? n : 0;
function totals(orders: SaleOrder[]) {
  const totalRevenue = orders.reduce((sum, order) => sum + finite(order.total), 0);
  const uniqueCustomers = new Set(orders.map(o => o.contato?.id).filter(id => id !== undefined && id !== null)).size;
  return { totalRevenue, totalSales: orders.length, averageTicket: orders.length ? totalRevenue / orders.length : 0, uniqueCustomers };
}
async function summarize(input: SalesRange, options: { databaseOnly: boolean }) {
  const day = 86400000, from = Date.parse(`${input.from}T00:00:00Z`), to = Date.parse(`${input.to}T00:00:00Z`);
  const previous = { from: new Date(from - (to - from + day)).toISOString().slice(0, 10), to: new Date(from - day).toISOString().slice(0, 10) };
  const [orders, previousOrders] = await Promise.all([readOrdersForPeriod(input), readOrdersForPeriod(previous)]);
  const current = totals(orders), old = totals(previousOrders); const warnings: string[] = [];
  if (options.databaseOnly && !orders.length) warnings.push('Nenhum pedido encontrado no banco de dados deste ambiente no período informado. Os totais representam somente os dados salvos; esta consulta não verifica o estado das integrações externas.');
  const comparison = (key: keyof typeof current) => {
    if (old[key] === 0) { warnings.push(`Comparação de ${key} indisponível: o período anterior não tem base maior que zero.`); return { value: current[key], change: null }; }
    return { value: current[key], change: (current[key] - old[key]) / Math.abs(old[key]) * 100 };
  };
  const productSales = new Map<string, { total: number; revenue: number }>(), stateSales = new Map<string, number>();
  for (const order of orders) {
    for (const item of order.itens ?? []) { const name = item.descricao || item.codigo || 'Produto sem nome', row = productSales.get(name) ?? { total: 0, revenue: 0 };
      row.total += finite(item.quantidade); row.revenue += finite(item.quantidade) * finite(item.valor); productSales.set(name, row); }
    const state = order.transporte?.etiqueta?.uf || 'N/A'; stateSales.set(state, (stateSales.get(state) ?? 0) + finite(order.total));
  }
  return result({ ...current, previousPeriod: previous,
    topProducts: [...productSales].map(([name, item]) => ({ name, ...item })).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    salesByState: [...stateSales].map(([state, revenue]) => ({ state, revenue })).sort((a, b) => b.revenue - a.revenue),
    stats: { totalRevenue: comparison('totalRevenue'), totalSales: comparison('totalSales'), averageTicket: comparison('averageTicket'), uniqueCustomers: comparison('uniqueCustomers') },
  }, 'firestore', warnings);
}

export const firestoreSalesReadRepository: SalesReadRepository = {
  list, get, summarize, readOrdersForPeriod,
};
