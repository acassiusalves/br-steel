import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import type { OperationSource } from '@/types/operations';
import type { AccessContext } from '@/server/access/types';
import { dateRangeSchema, requireOperation, result } from './common';
import { readOrdersForPeriod } from './sales';
import { readStockSnapshot, readStoredStockSnapshot } from './stock';
export interface ProductionDemand { sku: string; description: string; orderCount: number; totalQuantitySold: number; weeklyAverage: number; corte: number; dobra: number; stockLevel?: number | null; stockSource: OperationSource; stockAsOf: string | null; stockMin?: number; stockMax?: number; }
export async function productionDemand(context: AccessContext, raw: unknown) {
  requireOperation(context, 'producao:read', '/producao'); const input = dateRangeSchema.parse(raw);
  const databaseOnly = context.actor.source === 'mcp';
  const [orders, stock, supplies] = await Promise.all([readOrdersForPeriod(input), databaseOnly ? readStoredStockSnapshot() : readStockSnapshot(), adminDb.collection('supplies').get()]);
  const limits = new Map(supplies.docs.map(doc => [String(doc.data().codigo || doc.id), doc.data()]));
  const stocks = new Map(stock.data.map(row => [row.produto.codigo, row]));
  const weeks = Math.max(1, (Date.parse(input.to) - Date.parse(input.from) + 86400000) / 86400000 / 7);
  const demand = new Map<string, { description: string; orders: Set<number>; quantity: number }>();
  for (const order of orders) {
    if (!order.notaFiscal?.id) continue;
    for (const item of order.itens ?? []) {
      if (!item.codigo || !Number.isFinite(item.quantidade) || item.quantidade <= 0) continue;
      const row = demand.get(item.codigo) ?? { description: item.descricao, orders: new Set<number>(), quantity: 0 };
      row.orders.add(order.id); row.quantity += item.quantidade; demand.set(item.codigo, row);
    }
  }
  const data: ProductionDemand[] = [...demand].map(([sku, row]) => ({ sku, description: row.description, orderCount: row.orders.size, totalQuantitySold: row.quantity,
    weeklyAverage: row.quantity / weeks, corte: Math.floor(row.quantity / weeks * 2), dobra: Math.floor(row.quantity / weeks * 1.5),
    stockLevel: stocks.get(sku)?.saldoVirtualTotal ?? null, stockSource: stocks.get(sku)?.source ?? 'unavailable', stockAsOf: stocks.get(sku)?.virtualAsOf ?? null, stockMin: limits.get(sku)?.estoqueMinimo ?? stocks.get(sku)?.stockMin, stockMax: limits.get(sku)?.estoqueMaximo ?? stocks.get(sku)?.stockMax })).sort((a, b) => b.totalQuantitySold - a.totalQuantitySold);
  const warnings = [...stock.warnings];
  if (data.some(item => item.stockLevel === null)) warnings.push(databaseOnly ? 'Saldo de estoque não encontrado no banco para parte dos SKUs da demanda; esses valores são nulos.' : 'Estoque indisponível para parte dos SKUs da demanda.');
  if (databaseOnly && !data.length) warnings.push('Nenhum pedido faturado com itens válidos foi encontrado no banco de dados deste ambiente no período informado.');
  return result(data, databaseOnly || stock.source === 'unavailable' ? 'firestore' : 'mixed', warnings);
}
