import type { SaleOrder } from '@/types/sale-order';
import type { AbcClass, SkuGroupLookup } from '@/lib/abc-analysis';

export type OpportunityStatus = 'overdue' | 'due_soon' | 'future' | 'insufficient';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type PriorityLevel = 'high' | 'medium' | 'low';

export interface RecurrenceOptions {
  currentDate?: string;
  minDistinctPurchaseDates?: number;
  lookaheadDays?: number;
  includeReturns?: boolean;
  skuGroups?: SkuGroupLookup;
}

export interface RecurrenceOpportunity {
  key: string;
  customerId: string;
  customerName: string;
  customerDocument?: string;
  customerType?: string;
  productKey: string;
  sku: string;
  skus: string[];
  isGroup: boolean;
  productName: string;
  productAbcClass?: AbcClass;
  marketplaceNames: string[];
  states: string[];
  orderIds: string[];
  orderCount: number;
  distinctPurchaseDates: number;
  totalQuantity: number;
  totalRevenue: number;
  averageOrderValue: number;
  averageUnitPrice: number;
  firstPurchaseDate: string | null;
  lastPurchaseDate: string | null;
  intervalsDays: number[];
  averageIntervalDays: number | null;
  medianIntervalDays: number | null;
  intervalVariation: number | null;
  nextExpectedDate: string | null;
  daysSinceLastPurchase: number | null;
  daysUntilNextExpected: number | null;
  opportunityStatus: OpportunityStatus;
  confidence: ConfidenceLevel;
  confidenceScore: number;
  priority: PriorityLevel;
  priorityScore: number;
  suggestedAction: string;
}

export interface RecurrenceSummary {
  ordersRead: number;
  ordersAnalyzed: number;
  ignoredCancelled: number;
  ignoredReturns: number;
  customers: number;
  recurringCustomers: number;
  strongRecurringCustomers: number;
  customerProductPairs: number;
  recurringPairs: number;
  strongRecurringPairs: number;
  overdueOpportunities: number;
  dueSoonOpportunities: number;
  highPriorityOpportunities: number;
  totalRevenue: number;
  potentialRevenue: number;
  dateRange: {
    from: string | null;
    to: string | null;
  };
}

export interface RecurrenceResult {
  summary: RecurrenceSummary;
  opportunities: RecurrenceOpportunity[];
}

type PairAggregate = {
  key: string;
  customerId: string;
  customerName: string;
  customerDocument?: string;
  customerType?: string;
  productKey: string;
  sku: string;
  skus: Set<string>;
  isGroup: boolean;
  productName: string;
  marketplaceNames: Set<string>;
  states: Set<string>;
  orderIds: Set<string>;
  purchaseDates: Set<string>;
  orderCount: number;
  totalQuantity: number;
  totalRevenue: number;
};

type ProductAggregate = {
  productKey: string;
  revenue: number;
};

type CustomerAggregate = {
  customerId: string;
  purchaseDates: Set<string>;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_MIN_DATES = 2;
const DEFAULT_LOOKAHEAD_DAYS = 30;
const ABC_A_THRESHOLD = 0.8;
const ABC_B_THRESHOLD = 0.95;

function parseDateOnly(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, (month || 1) - 1, day || 1);
}

function daysBetween(from: string, to: string): number {
  return Math.round((parseDateOnly(to) - parseDateOnly(from)) / MS_PER_DAY);
}

function addDays(date: string, days: number): string {
  const next = new Date(parseDateOnly(date) + days * MS_PER_DAY);
  return next.toISOString().slice(0, 10);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function coefficientOfVariation(values: number[]): number | null {
  const avg = average(values);
  if (!avg || values.length < 2) return null;
  const variance = average(values.map((value) => Math.pow(value - avg, 2))) || 0;
  return Math.sqrt(variance) / avg;
}

function round(value: number, digits = 2): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isCancelled(order: SaleOrder): boolean {
  return (order.situacao?.nome || '').toLowerCase().includes('cancelado');
}

function isReturn(order: SaleOrder): boolean {
  const status = (order.situacao?.nome || '').toLowerCase();
  return status.includes('devolucao') || status.includes('devolução');
}

function getMarketplaceName(order: SaleOrder): string {
  const trackingCode = String(order.transporte?.volumes?.[0]?.codigoRastreamento || '');
  if (trackingCode.startsWith('MEL')) return 'Mercado Livre';
  if (order.intermediador?.nomeUsuario) return order.intermediador.nomeUsuario;
  return order.loja?.nome || 'N/A';
}

function getOrderDate(order: SaleOrder): string | null {
  if (!order.data || order.data.startsWith('0000')) return null;
  return order.data.slice(0, 10);
}

function getCustomerId(order: SaleOrder): string {
  return String(
    order.contato?.id ||
      order.contato?.numeroDocumento ||
      order.contato?.nome ||
      'SEM_CLIENTE'
  );
}

function classifyProducts(products: Map<string, ProductAggregate>): Map<string, AbcClass> {
  const rows = Array.from(products.values()).sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const classes = new Map<string, AbcClass>();
  let cumulative = 0;

  rows.forEach((row, index) => {
    const share = totalRevenue > 0 ? row.revenue / totalRevenue : 0;
    cumulative += share;

    let cls: AbcClass;
    if (index === 0 || cumulative <= ABC_A_THRESHOLD) {
      cls = 'A';
    } else if (cumulative <= ABC_B_THRESHOLD) {
      cls = 'B';
    } else {
      cls = 'C';
    }

    classes.set(row.productKey, cls);
  });

  return classes;
}

function getConfidence(
  distinctPurchaseDates: number,
  medianIntervalDays: number | null,
  intervalVariation: number | null
): { confidence: ConfidenceLevel; confidenceScore: number } {
  let score = 0;

  if (distinctPurchaseDates >= 5) score += 40;
  else if (distinctPurchaseDates >= 4) score += 34;
  else if (distinctPurchaseDates >= 3) score += 26;
  else if (distinctPurchaseDates >= 2) score += 14;

  if (medianIntervalDays && medianIntervalDays > 0) score += 22;

  if (intervalVariation === null) score += distinctPurchaseDates >= 2 ? 8 : 0;
  else if (intervalVariation <= 0.35) score += 26;
  else if (intervalVariation <= 0.65) score += 18;
  else if (intervalVariation <= 1) score += 10;
  else score += 4;

  score = clamp(score, 0, 100);

  if (score >= 70) return { confidence: 'high', confidenceScore: score };
  if (score >= 45) return { confidence: 'medium', confidenceScore: score };
  return { confidence: 'low', confidenceScore: score };
}

function getOpportunityStatus(
  daysUntilNextExpected: number | null,
  lookaheadDays: number
): OpportunityStatus {
  if (daysUntilNextExpected === null) return 'insufficient';
  if (daysUntilNextExpected <= 0) return 'overdue';
  if (daysUntilNextExpected <= lookaheadDays) return 'due_soon';
  return 'future';
}

function getPriority(
  confidenceScore: number,
  totalRevenue: number,
  opportunityStatus: OpportunityStatus,
  daysUntilNextExpected: number | null,
  productAbcClass?: AbcClass
): { priority: PriorityLevel; priorityScore: number } {
  let score = confidenceScore * 0.55;

  if (opportunityStatus === 'due_soon') {
    score += 24;
  } else if (opportunityStatus === 'overdue') {
    const overdueDays = Math.abs(daysUntilNextExpected || 0);
    if (overdueDays <= 45) score += 28;
    else if (overdueDays <= 90) score += 20;
    else if (overdueDays <= 180) score += 10;
    else score += 4;
  }

  score += Math.min(20, Math.log10(totalRevenue + 1) * 5);

  if (productAbcClass === 'A') score += 10;
  else if (productAbcClass === 'B') score += 5;

  const priorityScore = Math.round(clamp(score, 0, 100));

  if (priorityScore >= 75) return { priority: 'high', priorityScore };
  if (priorityScore >= 50) return { priority: 'medium', priorityScore };
  return { priority: 'low', priorityScore };
}

function getSuggestedAction(
  status: OpportunityStatus,
  confidence: ConfidenceLevel,
  priority: PriorityLevel
): string {
  if (status === 'overdue' && priority === 'high') {
    return 'Contato prioritário com condição especial de recompra';
  }
  if (status === 'overdue') {
    return 'Reativar cliente com oferta limitada';
  }
  if (status === 'due_soon' && confidence !== 'low') {
    return 'Antecipar recompra com condição especial';
  }
  if (status === 'due_soon') {
    return 'Monitorar e testar abordagem leve';
  }
  if (status === 'future') {
    return 'Acompanhar próxima janela de compra';
  }
  return 'Aguardar mais histórico antes de ofertar';
}

export function computeCustomerProductRecurrence(
  orders: SaleOrder[],
  options: RecurrenceOptions = {}
): RecurrenceResult {
  const currentDate = options.currentDate || new Date().toISOString().slice(0, 10);
  const minDistinctPurchaseDates =
    options.minDistinctPurchaseDates ?? DEFAULT_MIN_DATES;
  const lookaheadDays = options.lookaheadDays ?? DEFAULT_LOOKAHEAD_DAYS;

  const pairs = new Map<string, PairAggregate>();
  const products = new Map<string, ProductAggregate>();
  const customers = new Map<string, CustomerAggregate>();
  let ignoredCancelled = 0;
  let ignoredReturns = 0;
  let ordersAnalyzed = 0;
  let totalRevenue = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const order of orders) {
    const orderDate = getOrderDate(order);
    if (!orderDate || !order.itens?.length) continue;

    if (isCancelled(order)) {
      ignoredCancelled += 1;
      continue;
    }

    if (!options.includeReturns && isReturn(order)) {
      ignoredReturns += 1;
      continue;
    }

    ordersAnalyzed += 1;
    totalRevenue += Number(order.total) || 0;
    if (!minDate || orderDate < minDate) minDate = orderDate;
    if (!maxDate || orderDate > maxDate) maxDate = orderDate;

    const customerId = getCustomerId(order);
    const customer = customers.get(customerId) || {
      customerId,
      purchaseDates: new Set<string>(),
    };
    customer.purchaseDates.add(orderDate);
    customers.set(customerId, customer);

    for (const item of order.itens) {
      const rawSku = String(item.codigo || '').trim();
      const sku = rawSku || 'SKU_INDEFINIDO';
      const group = options.skuGroups?.get(sku);
      const productKey = group ? `group:${group.groupId}` : sku;
      const productName = group?.canonicalName || item.descricao || sku;
      const key = `${customerId}::${productKey}`;
      const quantity = Number(item.quantidade) || 0;
      const unitPrice = Number(item.valor) || 0;
      const discount = Number(item.desconto) || 0;
      const itemRevenue = Math.max(0, quantity * unitPrice - discount);

      const product = products.get(productKey) || { productKey, revenue: 0 };
      product.revenue += itemRevenue;
      products.set(productKey, product);

      const pair = pairs.get(key) || {
        key,
        customerId,
        customerName: order.contato?.nome || 'Cliente sem nome',
        customerDocument: order.contato?.numeroDocumento,
        customerType: order.contato?.tipoPessoa,
        productKey,
        sku: group ? productKey : sku,
        skus: new Set<string>(),
        isGroup: Boolean(group),
        productName,
        marketplaceNames: new Set<string>(),
        states: new Set<string>(),
        orderIds: new Set<string>(),
        purchaseDates: new Set<string>(),
        orderCount: 0,
        totalQuantity: 0,
        totalRevenue: 0,
      };

      pair.skus.add(sku);
      pair.marketplaceNames.add(getMarketplaceName(order));
      if (order.transporte?.etiqueta?.uf) pair.states.add(order.transporte.etiqueta.uf);
      pair.orderIds.add(String(order.id));
      pair.purchaseDates.add(orderDate);
      pair.orderCount += 1;
      pair.totalQuantity += quantity;
      pair.totalRevenue += itemRevenue;
      pairs.set(key, pair);
    }
  }

  const productClasses = classifyProducts(products);

  const opportunities = Array.from(pairs.values())
    .map((pair): RecurrenceOpportunity => {
      const dates = Array.from(pair.purchaseDates).sort();
      const intervalsDays = dates
        .slice(1)
        .map((date, index) => daysBetween(dates[index], date))
        .filter((days) => days >= 0);
      const avgInterval = average(intervalsDays);
      const medianInterval = median(intervalsDays);
      const variation = coefficientOfVariation(intervalsDays);
      const lastPurchaseDate = dates.at(-1) || null;
      const nextExpectedDate =
        lastPurchaseDate && medianInterval && medianInterval > 0
          ? addDays(lastPurchaseDate, Math.round(medianInterval))
          : null;
      const daysSinceLastPurchase = lastPurchaseDate
        ? daysBetween(lastPurchaseDate, currentDate)
        : null;
      const daysUntilNextExpected = nextExpectedDate
        ? daysBetween(currentDate, nextExpectedDate)
        : null;
      const opportunityStatus = getOpportunityStatus(
        daysUntilNextExpected,
        lookaheadDays
      );
      const { confidence, confidenceScore } = getConfidence(
        dates.length,
        medianInterval,
        variation
      );
      const productAbcClass = productClasses.get(pair.productKey);
      const { priority, priorityScore } = getPriority(
        confidenceScore,
        pair.totalRevenue,
        opportunityStatus,
        daysUntilNextExpected,
        productAbcClass
      );

      return {
        key: pair.key,
        customerId: pair.customerId,
        customerName: pair.customerName,
        customerDocument: pair.customerDocument,
        customerType: pair.customerType,
        productKey: pair.productKey,
        sku: pair.sku,
        skus: Array.from(pair.skus).sort(),
        isGroup: pair.isGroup,
        productName: pair.productName,
        productAbcClass,
        marketplaceNames: Array.from(pair.marketplaceNames).sort(),
        states: Array.from(pair.states).sort(),
        orderIds: Array.from(pair.orderIds),
        orderCount: pair.orderIds.size,
        distinctPurchaseDates: dates.length,
        totalQuantity: round(pair.totalQuantity, 2),
        totalRevenue: round(pair.totalRevenue, 2),
        averageOrderValue: round(pair.totalRevenue / Math.max(1, pair.orderIds.size), 2),
        averageUnitPrice: round(pair.totalRevenue / Math.max(1, pair.totalQuantity), 2),
        firstPurchaseDate: dates[0] || null,
        lastPurchaseDate,
        intervalsDays,
        averageIntervalDays: avgInterval === null ? null : round(avgInterval, 1),
        medianIntervalDays: medianInterval === null ? null : round(medianInterval, 1),
        intervalVariation: variation === null ? null : round(variation, 2),
        nextExpectedDate,
        daysSinceLastPurchase,
        daysUntilNextExpected,
        opportunityStatus,
        confidence,
        confidenceScore,
        priority,
        priorityScore,
        suggestedAction: getSuggestedAction(opportunityStatus, confidence, priority),
      };
    })
    .filter((row) => row.distinctPurchaseDates >= minDistinctPurchaseDates)
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      return b.totalRevenue - a.totalRevenue;
    });

  const recurringCustomers = Array.from(customers.values()).filter(
    (customer) => customer.purchaseDates.size >= 2
  ).length;
  const strongRecurringCustomers = Array.from(customers.values()).filter(
    (customer) => customer.purchaseDates.size >= 3
  ).length;
  const recurringPairs = opportunities.filter(
    (row) => row.distinctPurchaseDates >= 2
  ).length;
  const strongRecurringPairs = opportunities.filter(
    (row) => row.distinctPurchaseDates >= 3
  ).length;
  const overdueOpportunities = opportunities.filter(
    (row) => row.opportunityStatus === 'overdue'
  ).length;
  const dueSoonOpportunities = opportunities.filter(
    (row) => row.opportunityStatus === 'due_soon'
  ).length;
  const highPriorityOpportunities = opportunities.filter(
    (row) => row.priority === 'high'
  ).length;
  const potentialRevenue = opportunities
    .filter((row) => row.opportunityStatus === 'overdue' || row.opportunityStatus === 'due_soon')
    .reduce((sum, row) => sum + row.averageOrderValue, 0);

  return {
    summary: {
      ordersRead: orders.length,
      ordersAnalyzed,
      ignoredCancelled,
      ignoredReturns,
      customers: customers.size,
      recurringCustomers,
      strongRecurringCustomers,
      customerProductPairs: pairs.size,
      recurringPairs,
      strongRecurringPairs,
      overdueOpportunities,
      dueSoonOpportunities,
      highPriorityOpportunities,
      totalRevenue: round(totalRevenue, 2),
      potentialRevenue: round(potentialRevenue, 2),
      dateRange: {
        from: minDate,
        to: maxDate,
      },
    },
    opportunities,
  };
}
