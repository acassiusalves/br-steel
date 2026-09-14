import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import type { OperationSource } from '@/types/operations';
import type { SalesRange } from './sales-contract';
import type { HistoryPoint, ProductionDemand, ProductionDemandReadRepository } from './production-demand-contract';
import { dateRangeSchema, result } from '@/server/operations/common';
import { readOrdersForPeriod } from '@/server/operations/sales';
import { readStockSnapshot, readStoredStockSnapshot } from '@/server/operations/stock';
import { countsAsConsumption } from './demand-eligibility';
import { isoWeekOf } from '@/lib/iso-week';
import { readWeeklyHistory } from './firestore-sku-weekly-demand';
export async function readFirestoreProductionDemand(raw: SalesRange, databaseOnly = true) {
  const input = dateRangeSchema.parse(raw);
  const [orders, stock, supplies, history] = await Promise.all([readOrdersForPeriod(input), databaseOnly ? readStoredStockSnapshot() : readStockSnapshot(), adminDb.collection('supplies').get(), readWeeklyHistory(12)]);
  const limits = new Map(supplies.docs.map(doc => [String(doc.data().codigo || doc.id), doc.data()]));
  const stocks = new Map(stock.data.map(row => [row.produto.codigo, row]));
  const weeks = Math.max(1, (Date.parse(input.to) - Date.parse(input.from) + 86400000) / 86400000 / 7);
  const demand = new Map<string, { description: string; orders: Set<number>; quantity: number }>();
  // O rollup nunca guarda a semana corrente (só fecha semanas passadas); o ponto aberto só existe
  // aqui, na agregação ao vivo, e só quando o período pedido alcança a semana de hoje.
  const currentWeek = isoWeekOf(new Date());
  const openWeek = new Map<string, { units: number; orders: Set<number> }>();
  for (const order of orders) {
    if (!countsAsConsumption(order)) continue;
    const orderWeek = isoWeekOf(`${order.data}T12:00:00Z`);
    for (const item of order.itens ?? []) {
      if (!item.codigo || !Number.isFinite(item.quantidade) || item.quantidade <= 0) continue;
      const row = demand.get(item.codigo) ?? { description: item.descricao, orders: new Set<number>(), quantity: 0 };
      row.orders.add(order.id); row.quantity += item.quantidade; demand.set(item.codigo, row);
      if (orderWeek === currentWeek) {
        const bucket = openWeek.get(item.codigo) ?? { units: 0, orders: new Set<number>() };
        bucket.units += item.quantidade; bucket.orders.add(order.id);
        openWeek.set(item.codigo, bucket);
      }
    }
  }
  const data: ProductionDemand[] = [...demand].map(([sku, row]) => ({ sku, description: row.description, orderCount: row.orders.size, totalQuantitySold: row.quantity,
    weeklyAverage: row.quantity / weeks, corte: Math.floor(row.quantity / weeks * 2), dobra: Math.floor(row.quantity / weeks * 1.5),
    stockLevel: stocks.get(sku)?.saldoVirtualTotal ?? null, stockSource: stocks.get(sku)?.source ?? 'unavailable', stockAsOf: stocks.get(sku)?.virtualAsOf ?? null, stockMin: limits.get(sku)?.estoqueMinimo ?? stocks.get(sku)?.stockMin, stockMax: limits.get(sku)?.estoqueMaximo ?? stocks.get(sku)?.stockMax,
    history: buildHistory(sku) })).sort((a, b) => b.totalQuantitySold - a.totalQuantitySold);
  const warnings = [...stock.warnings];
  if (data.some(item => item.stockLevel === null)) warnings.push(databaseOnly ? 'Saldo de estoque não encontrado no banco para parte dos SKUs da demanda; esses valores são nulos.' : 'Estoque indisponível para parte dos SKUs da demanda.');
  if (databaseOnly && !data.length) warnings.push('Nenhum pedido faturado com itens válidos foi encontrado no banco de dados deste ambiente no período informado.');
  return result(data, databaseOnly || stock.source === 'unavailable' ? 'firestore' : 'mixed', warnings);

  /**
   * Semanas fechadas vêm do rollup; a corrente vem do loop acima, porque só ela muda entre duas
   * consultas. Se o período selecionado não alcança a semana corrente, o ponto aberto simplesmente
   * não existe — não se inventa o valor nem se dispara uma segunda consulta de pedidos para obtê-lo.
   */
  function buildHistory(sku: string): HistoryPoint[] {
    const closed = (history.get(sku) ?? []).filter(point => point.week !== currentWeek);
    const open = openWeek.get(sku);
    return open ? [...closed, { week: currentWeek, units: open.units, orders: open.orders.size, open: true }] : closed;
  }
}

export const firestoreProductionDemandReadRepository: ProductionDemandReadRepository = { read: input => readFirestoreProductionDemand(input) };
