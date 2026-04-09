// src/lib/abc-analysis.ts
//
// Pure aggregation + classification for the ABC (Pareto) analysis of sales.
// Given a list of SaleOrder objects, groups items by SKU, ranks them by the
// chosen metric, and classifies each SKU into class A/B/C based on
// cumulative-share thresholds.

import type { SaleOrder } from '@/types/sale-order';

export type AbcClass = 'A' | 'B' | 'C';
export type AbcMetric = 'revenue' | 'quantity' | 'orderCount';

/**
 * Optional lookup: for each raw SKU, tells us which canonical group it belongs
 * to. When provided, `computeAbc` aggregates by `groupId` using `canonicalName`
 * as the display name and exposes the underlying SKUs in `AbcRow.skus`.
 */
export interface GroupLookupEntry {
  groupId: string;
  canonicalName: string;
}
export type SkuGroupLookup = Map<string, GroupLookupEntry>;

export interface AbcRow {
  /** Display identifier: either the raw SKU or the group id when grouped. */
  sku: string;
  /** Display name: product description or canonical group name. */
  name: string;
  /** Raw SKUs that this row represents (1 when not grouped). */
  skus: string[];
  /** True when this row aggregates more than one SKU via a group mapping. */
  isGroup: boolean;
  revenue: number;
  quantity: number;
  orderCount: number;
  share: number;           // fraction of total metric (0..1)
  cumulativeShare: number; // running cumulative fraction (0..1)
  class: AbcClass;
  rank: number;
}

export interface AbcSummary {
  totalRevenue: number;
  totalQuantity: number;
  totalSkus: number;
  counts: { A: number; B: number; C: number };
  revenueByClass: { A: number; B: number; C: number };
}

export interface AbcThresholds {
  a: number; // upper bound (inclusive) for class A cumulative share
  b: number; // upper bound (inclusive) for class B cumulative share
}

const DEFAULT_THRESHOLDS: AbcThresholds = { a: 0.8, b: 0.95 };

interface Aggregate {
  /** Unique key for this aggregate: groupId when grouped, raw SKU otherwise. */
  key: string;
  name: string;
  /** All raw SKUs that rolled up into this aggregate. */
  skus: Set<string>;
  isGroup: boolean;
  revenue: number;
  quantity: number;
  orderIds: Set<number | string>;
}

/**
 * Returns the metric value used to rank a given aggregate row.
 */
function pickMetric(agg: Aggregate, metric: AbcMetric): number {
  switch (metric) {
    case 'revenue':
      return agg.revenue;
    case 'quantity':
      return agg.quantity;
    case 'orderCount':
      return agg.orderIds.size;
  }
}

export interface ComputeAbcOptions {
  metric?: AbcMetric;
  thresholds?: AbcThresholds;
  /**
   * When provided, SKUs found in this map are aggregated together under the
   * group's canonical name. SKUs not in the map remain as single-SKU rows.
   */
  skuGroups?: SkuGroupLookup;
}

/**
 * Aggregates SaleOrder items by SKU (or by canonical group, when `skuGroups`
 * is provided), then ranks and classifies the resulting rows into ABC classes
 * based on the cumulative share of the chosen metric.
 *
 * - `revenue` of an item = quantidade * valor - (desconto do item)
 * - Orders should be pre-filtered by the caller (date range, status, etc).
 *
 * Supports two call styles:
 *   computeAbc(orders, 'revenue')                       // legacy
 *   computeAbc(orders, { metric, skuGroups, thresholds }) // new
 */
export function computeAbc(
  orders: SaleOrder[],
  metricOrOptions: AbcMetric | ComputeAbcOptions = 'revenue',
  thresholdsArg: AbcThresholds = DEFAULT_THRESHOLDS
): { rows: AbcRow[]; summary: AbcSummary } {
  const opts: ComputeAbcOptions =
    typeof metricOrOptions === 'string'
      ? { metric: metricOrOptions, thresholds: thresholdsArg }
      : metricOrOptions;

  const metric: AbcMetric = opts.metric ?? 'revenue';
  const thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const skuGroups = opts.skuGroups;

  const byKey = new Map<string, Aggregate>();

  for (const order of orders) {
    if (!order?.itens?.length) continue;

    for (const item of order.itens) {
      const sku = String(item.codigo ?? '').trim();
      if (!sku) continue;

      const qty = Number(item.quantidade) || 0;
      const unit = Number(item.valor) || 0;
      const itemDiscount = Number(item.desconto) || 0;
      const itemRevenue = Math.max(0, qty * unit - itemDiscount);

      const groupEntry = skuGroups?.get(sku);
      const key = groupEntry ? `group:${groupEntry.groupId}` : sku;
      const displayName =
        groupEntry?.canonicalName || item.descricao || sku;
      const isGroup = Boolean(groupEntry);

      const existing = byKey.get(key);
      if (existing) {
        existing.revenue += itemRevenue;
        existing.quantity += qty;
        existing.orderIds.add(order.id);
        existing.skus.add(sku);
      } else {
        byKey.set(key, {
          key,
          name: displayName,
          skus: new Set([sku]),
          isGroup,
          revenue: itemRevenue,
          quantity: qty,
          orderIds: new Set([order.id]),
        });
      }
    }
  }

  const aggregates = Array.from(byKey.values());

  // Sort by the selected metric, descending. Break ties by revenue so the
  // ordering stays stable when users switch to quantity/orderCount.
  aggregates.sort((a, b) => {
    const diff = pickMetric(b, metric) - pickMetric(a, metric);
    if (diff !== 0) return diff;
    return b.revenue - a.revenue;
  });

  const totalMetric = aggregates.reduce((sum, a) => sum + pickMetric(a, metric), 0);
  const totalRevenue = aggregates.reduce((sum, a) => sum + a.revenue, 0);
  const totalQuantity = aggregates.reduce((sum, a) => sum + a.quantity, 0);

  const rows: AbcRow[] = [];
  const counts = { A: 0, B: 0, C: 0 };
  const revenueByClass = { A: 0, B: 0, C: 0 };
  let cumulative = 0;

  aggregates.forEach((agg, index) => {
    const metricValue = pickMetric(agg, metric);
    const share = totalMetric > 0 ? metricValue / totalMetric : 0;
    cumulative += share;

    // Guarantee the first row is always class A, even if it alone already
    // exceeds the A threshold.
    let cls: AbcClass;
    if (index === 0) {
      cls = 'A';
    } else if (cumulative <= thresholds.a) {
      cls = 'A';
    } else if (cumulative <= thresholds.b) {
      cls = 'B';
    } else {
      cls = 'C';
    }

    counts[cls] += 1;
    revenueByClass[cls] += agg.revenue;

    rows.push({
      sku: agg.key,
      name: agg.name,
      skus: Array.from(agg.skus),
      isGroup: agg.isGroup,
      revenue: agg.revenue,
      quantity: agg.quantity,
      orderCount: agg.orderIds.size,
      share,
      cumulativeShare: Math.min(1, cumulative),
      class: cls,
      rank: index + 1,
    });
  });

  return {
    rows,
    summary: {
      totalRevenue,
      totalQuantity,
      totalSkus: rows.length,
      counts,
      revenueByClass,
    },
  };
}
