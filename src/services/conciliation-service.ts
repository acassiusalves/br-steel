"use client";

import { collection, onSnapshot, orderBy, query } from "firebase/firestore";

import { db } from "@/lib/firebase";
import {
  isConciliationSystemStatus,
  resolveAutomaticSystemStatus,
  type ConciliationSystemStatus,
} from "@/lib/conciliation/status";
import {
  calculateConciliationFinancialDivergence,
  defaultConciliationFinancialDivergenceRules,
  type ConciliationFinancialDivergenceRules,
} from "@/lib/conciliation/divergences";
import {
  applyConciliationCustomCalculations,
  normalizeConciliationCustomCalculations,
} from "@/lib/conciliation/calculations";
import { defaultConciliationSummaryMetricIds } from "@/lib/conciliation/summary";
import type {
  ConciliationCalculationSettings,
  ConciliationCustomCalculationInput,
  ConciliationDivergenceSettings,
  ConciliationFinancialAdjustmentFieldId,
  ConciliationFinancialAdjustmentInput,
  ConciliationFinancialAdjustments,
  ConciliationFinancialSnapshot,
  ConciliationMarketplacePayout,
  ConciliationMarketplacePayoutInput,
  ConciliationOrder,
  ConciliationPayoutComparison,
  ConciliationRecord,
  ConciliationRecordInput,
  ConciliationSummary,
  ConciliationSummarySettings,
  ConciliationStatusMappings,
  ConciliationStatusSettings,
} from "@/types/conciliation";
import type { SaleOrder } from "@/types/sale-order";

type UnknownRecord = Record<string, unknown>;

const emptyStatusSettings: ConciliationStatusSettings = {
  statusMappings: {},
  updatedAt: null,
  updatedBy: null,
};

const emptySummarySettings: ConciliationSummarySettings = {
  metricIds: defaultConciliationSummaryMetricIds,
  updatedAt: null,
  updatedBy: null,
};

const emptyDivergenceSettings: ConciliationDivergenceSettings = {
  ...defaultConciliationFinancialDivergenceRules,
  updatedAt: null,
  updatedBy: null,
};

const emptyCalculationSettings: ConciliationCalculationSettings = {
  calculations: [],
  updatedAt: null,
  updatedBy: null,
};

const financialAdjustmentFieldIds: ConciliationFinancialAdjustmentFieldId[] = [
  "grossRevenue",
  "productRevenue",
  "customerShippingRevenue",
  "discountAmount",
  "otherExpenses",
  "productCost",
  "shippingCost",
  "commissionFee",
  "taxes",
];

const payoutToleranceAmount = 0.05;

const toFiniteNumber = (value: unknown): number => {
  const numberValue = typeof value === "number" ? value : Number(value);

  return Number.isFinite(numberValue) ? numberValue : 0;
};

export const normalizeConciliationPayoutOrderKey = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();

const emptyPayoutComparison = (expectedNetAmount = 0): ConciliationPayoutComparison => ({
  status: "missing",
  label: "Sem repasse",
  payoutCount: 0,
  expectedNetAmount,
  paidNetAmount: 0,
  differenceAmount: -expectedNetAmount,
  toleranceAmount: payoutToleranceAmount,
});

const getOrderPayoutKeys = (order: ConciliationOrder): string[] => {
  const originalOrder = order.originalOrder as unknown as UnknownRecord;
  const notaFiscal = originalOrder.notaFiscal as UnknownRecord | undefined;
  const keys = [
    order.id,
    order.orderId,
    order.number,
    order.storeNumber,
    originalOrder.numeroPedidoCompra,
    notaFiscal?.numeroPedidoLoja,
  ].map(normalizeConciliationPayoutOrderKey);

  return Array.from(new Set(keys.filter(Boolean)));
};

const buildPayoutComparison = (
  order: ConciliationOrder,
  payouts: ConciliationMarketplacePayout[]
): ConciliationPayoutComparison => {
  if (payouts.length === 0) return emptyPayoutComparison(order.netRevenue);

  const paidNetAmount = payouts.reduce((total, payout) => total + payout.netAmount, 0);
  const differenceAmount = paidNetAmount - order.netRevenue;
  const matched = Math.abs(differenceAmount) <= payoutToleranceAmount;

  return {
    status: matched ? "matched" : "divergent",
    label: matched ? "Repasse OK" : "Divergente",
    payoutCount: payouts.length,
    expectedNetAmount: order.netRevenue,
    paidNetAmount,
    differenceAmount,
    toleranceAmount: payoutToleranceAmount,
  };
};

const readNumber = (source: UnknownRecord | undefined, keys: string[]): number => {
  if (!source) return 0;

  for (const key of keys) {
    const value = source[key];
    const parsed = toFiniteNumber(value);

    if (parsed !== 0) return parsed;
  }

  return 0;
};

const calculateDiscountAmount = (sale: SaleOrder, productRevenue: number): number => {
  const discountValue = toFiniteNumber(sale.desconto?.valor);

  if (!discountValue) return 0;

  return sale.desconto?.unidade === "PERCENTUAL" ? productRevenue * (discountValue / 100) : discountValue;
};

const calculateOrderFinancialDivergence = (
  order: Pick<
    ConciliationOrder,
    | "marketplace"
    | "systemStatus"
    | "totalQuantity"
    | "grossRevenue"
    | "productRevenue"
    | "customerShippingRevenue"
    | "discountAmount"
    | "otherExpenses"
    | "netRevenue"
    | "productCost"
    | "shippingCost"
    | "commissionFee"
    | "taxes"
    | "contributionMargin"
    | "contributionMarginPercentage"
  >,
  divergenceRules: ConciliationFinancialDivergenceRules = defaultConciliationFinancialDivergenceRules
) => calculateConciliationFinancialDivergence(order, divergenceRules);

const recalculateDerivedFinancials = (order: ConciliationOrder): ConciliationOrder => {
  const netRevenue = order.grossRevenue - order.shippingCost - order.commissionFee - order.taxes;
  const contributionMargin = netRevenue - order.productCost;
  const contributionMarginPercentage = order.grossRevenue > 0 ? (contributionMargin / order.grossRevenue) * 100 : 0;

  return {
    ...order,
    netRevenue,
    contributionMargin,
    contributionMarginPercentage,
  };
};

const applyFinancialAdjustmentsToOrder = (
  order: ConciliationOrder,
  financialAdjustments: ConciliationFinancialAdjustments
): ConciliationOrder => {
  const adjustedOrder = {
    ...order,
    financialAdjustments,
  };

  financialAdjustmentFieldIds.forEach((fieldId) => {
    const adjustment = financialAdjustments[fieldId];

    if (adjustment?.active && typeof adjustment.adjustedValue === "number" && Number.isFinite(adjustment.adjustedValue)) {
      adjustedOrder[fieldId] = adjustment.adjustedValue;
    }
  });

  return recalculateDerivedFinancials(adjustedOrder);
};

export const getConciliationMarketplaceName = (sale: SaleOrder): string => {
  const trackingCode = String(sale.transporte?.volumes?.[0]?.codigoRastreamento || "");

  if (trackingCode.startsWith("MEL")) {
    return "Mercado Livre";
  }

  if (sale.intermediador?.nomeUsuario) {
    return sale.intermediador.nomeUsuario;
  }

  return sale.loja?.nome || "Sem marketplace";
};

export const normalizeSaleOrderForConciliation = (sale: SaleOrder): ConciliationOrder => {
  const orderRecord = sale as unknown as UnknownRecord;
  const statusName = sale.situacao?.nome || "Desconhecido";
  const automaticSystemStatus = resolveAutomaticSystemStatus(statusName);
  const items = (sale.itens || []).map((item, index) => {
    const quantity = toFiniteNumber(item.quantidade);
    const unitValue = toFiniteNumber(item.valor);

    return {
      id: String(item.id || item.produto?.id || `${sale.id}-${index}`),
      sku: item.codigo || "Sem SKU",
      description: item.descricao || "Produto sem descrição",
      quantity,
      unitValue,
      grossValue: quantity * unitValue,
    };
  });

  const productRevenue = toFiniteNumber(sale.totalProdutos);
  const grossRevenue = toFiniteNumber(sale.total || productRevenue);
  const marketplace = getConciliationMarketplaceName(sale);
  const totalQuantity = items.reduce((total, item) => total + item.quantity, 0);
  const customerShippingRevenue = toFiniteNumber(sale.transporte?.frete);
  const discountAmount = calculateDiscountAmount(sale, productRevenue);
  const otherExpenses = toFiniteNumber(sale.outrasDespesas);
  const shippingCost = toFiniteNumber(sale.taxas?.custoFrete);
  const commissionFee = toFiniteNumber(sale.taxas?.taxaComissao);
  const taxes = toFiniteNumber(sale.tributacao?.totalICMS) + toFiniteNumber(sale.tributacao?.totalIPI);
  const productCost = (sale.itens || []).reduce((total, item) => {
    const itemRecord = item as unknown as UnknownRecord;
    const unitCost = readNumber(itemRecord, ["custo", "custoUnitario", "custoMedio", "cost", "productCost"]);

    return total + unitCost * toFiniteNumber(item.quantidade);
  }, 0);
  const netRevenue = grossRevenue - shippingCost - commissionFee - taxes;
  const contributionMargin = netRevenue - productCost;
  const contributionMarginPercentage = grossRevenue > 0 ? (contributionMargin / grossRevenue) * 100 : 0;
  const order: ConciliationOrder = {
    id: String(sale.id),
    orderId: sale.id,
    number: sale.numero || null,
    storeNumber: sale.numeroLoja || "N/A",
    date: sale.data || "",
    customerName: sale.contato?.nome || "Cliente não informado",
    accountName: sale.loja?.nome || "Conta não informada",
    marketplace,
    statusName,
    automaticSystemStatus,
    manualSystemStatus: null,
    systemStatus: automaticSystemStatus,
    items,
    totalQuantity,
    grossRevenue,
    productRevenue,
    customerShippingRevenue,
    discountAmount,
    otherExpenses,
    netRevenue,
    productCost,
    shippingCost,
    commissionFee,
    taxes,
    contributionMargin,
    contributionMarginPercentage,
    calculationValues: {},
    financialDivergence: calculateConciliationFinancialDivergence({
      marketplace,
      systemStatus: automaticSystemStatus,
      totalQuantity,
      grossRevenue,
      productRevenue,
      customerShippingRevenue,
      discountAmount,
      otherExpenses,
      netRevenue,
      productCost,
      shippingCost,
      commissionFee,
      taxes,
      contributionMargin,
      contributionMarginPercentage,
    }),
    financialAdjustments: {},
    marketplacePayouts: [],
    payoutComparison: emptyPayoutComparison(netRevenue),
    isReconciled: Boolean(orderRecord.reconciled),
    conciliation: null,
    originalOrder: sale,
  };

  return order;
};

export const subscribeConciliationOrders = (
  onData: (orders: ConciliationOrder[]) => void,
  onError: (error: Error) => void
) => {
  const ordersCollection = collection(db, "salesOrders");
  const ordersQuery = query(ordersCollection, orderBy("data", "desc"));

  return onSnapshot(
    ordersQuery,
    (snapshot) => {
      const orders = snapshot.docs.map((documentSnapshot) =>
        normalizeSaleOrderForConciliation(documentSnapshot.data() as SaleOrder)
      );

      onData(orders);
    },
    (error) => onError(error)
  );
};

export const applyStatusMappings = (
  orders: ConciliationOrder[],
  statusMappings: ConciliationStatusMappings
): ConciliationOrder[] =>
  orders.map((order) => {
    const automaticSystemStatus = statusMappings[order.statusName] ?? resolveAutomaticSystemStatus(order.statusName);
    const manualSystemStatus = order.manualSystemStatus;
    const systemStatus = manualSystemStatus ?? automaticSystemStatus;

    if (order.automaticSystemStatus === automaticSystemStatus && order.systemStatus === systemStatus) {
      return order;
    }

    const updatedOrder = applyFinancialAdjustmentsToOrder({
      ...order,
      automaticSystemStatus,
      systemStatus,
      conciliation: order.conciliation
        ? {
            ...order.conciliation,
            automaticSystemStatus,
            systemStatus,
          }
        : null,
    }, order.financialAdjustments || {});

    return {
      ...updatedOrder,
      financialDivergence: calculateOrderFinancialDivergence(updatedOrder),
    };
  });

export const applyFinancialDivergenceRules = (
  orders: ConciliationOrder[],
  divergenceRules: ConciliationFinancialDivergenceRules
): ConciliationOrder[] =>
  orders.map((order) => ({
    ...order,
    financialDivergence: calculateOrderFinancialDivergence(order, divergenceRules),
  }));

export const applyMarketplacePayouts = (
  orders: ConciliationOrder[],
  payouts: ConciliationMarketplacePayout[]
): ConciliationOrder[] => {
  const payoutsByOrderKey = payouts.reduce<Map<string, ConciliationMarketplacePayout[]>>((map, payout) => {
    const key = normalizeConciliationPayoutOrderKey(payout.orderKey);
    if (!key) return map;

    const existing = map.get(key) || [];
    existing.push(payout);
    map.set(key, existing);

    return map;
  }, new Map());

  return orders.map((order) => {
    const matchedPayouts = getOrderPayoutKeys(order).flatMap((key) => payoutsByOrderKey.get(key) || []);
    const uniquePayouts = Array.from(new Map(matchedPayouts.map((payout) => [payout.id, payout])).values());

    return {
      ...order,
      marketplacePayouts: uniquePayouts,
      payoutComparison: buildPayoutComparison(order, uniquePayouts),
    };
  });
};

export const applyCustomCalculationsToOrders = applyConciliationCustomCalculations;

export const calculateConciliationSummary = (orders: ConciliationOrder[]): ConciliationSummary => {
  const summary = orders.reduce(
    (totals, order) => ({
      ordersCount: totals.ordersCount + 1,
      itemsQuantity: totals.itemsQuantity + order.totalQuantity,
      grossRevenue: totals.grossRevenue + order.grossRevenue,
      netRevenue: totals.netRevenue + order.netRevenue,
      productCost: totals.productCost + order.productCost,
      contributionMargin: totals.contributionMargin + order.contributionMargin,
      reconciledCount: totals.reconciledCount + (order.isReconciled ? 1 : 0),
      pendingCount: totals.pendingCount + (order.isReconciled ? 0 : 1),
      financialAlertCount:
        totals.financialAlertCount + (order.financialDivergence.severity === "ok" ? 0 : 1),
      financialAttentionCount:
        totals.financialAttentionCount + (order.financialDivergence.severity === "attention" ? 1 : 0),
      financialCriticalCount:
        totals.financialCriticalCount + (order.financialDivergence.severity === "critical" ? 1 : 0),
      financialRiskAmount: totals.financialRiskAmount + order.financialDivergence.riskAmount,
      payoutMatchedCount: totals.payoutMatchedCount + (order.payoutComparison.status === "matched" ? 1 : 0),
      payoutDivergentCount: totals.payoutDivergentCount + (order.payoutComparison.status === "divergent" ? 1 : 0),
      payoutMissingCount: totals.payoutMissingCount + (order.payoutComparison.status === "missing" ? 1 : 0),
      payoutNetAmount: totals.payoutNetAmount + order.payoutComparison.paidNetAmount,
      payoutDifferenceAmount:
        totals.payoutDifferenceAmount + Math.abs(order.payoutComparison.differenceAmount),
    }),
    {
      ordersCount: 0,
      itemsQuantity: 0,
      grossRevenue: 0,
      netRevenue: 0,
      productCost: 0,
      contributionMargin: 0,
      reconciledCount: 0,
      pendingCount: 0,
      financialAlertCount: 0,
      financialAttentionCount: 0,
      financialCriticalCount: 0,
      financialRiskAmount: 0,
      payoutMatchedCount: 0,
      payoutDivergentCount: 0,
      payoutMissingCount: 0,
      payoutNetAmount: 0,
      payoutDifferenceAmount: 0,
    }
  );

  return {
    ...summary,
    contributionMarginPercentage:
      summary.grossRevenue > 0 ? (summary.contributionMargin / summary.grossRevenue) * 100 : 0,
    averageTicket: summary.ordersCount > 0 ? summary.grossRevenue / summary.ordersCount : 0,
    reconciledPercentage: summary.ordersCount > 0 ? (summary.reconciledCount / summary.ordersCount) * 100 : 0,
    financialAlertPercentage:
      summary.ordersCount > 0 ? (summary.financialAlertCount / summary.ordersCount) * 100 : 0,
  };
};

export const buildConciliationSnapshot = (order: ConciliationOrder): ConciliationFinancialSnapshot => ({
  orderId: order.id,
  saleOrderId: order.orderId,
  number: order.number,
  storeNumber: order.storeNumber,
  date: order.date,
  customerName: order.customerName,
  accountName: order.accountName,
  marketplace: order.marketplace,
  statusName: order.statusName,
  automaticSystemStatus: order.automaticSystemStatus,
  manualSystemStatus: order.manualSystemStatus,
  systemStatus: order.systemStatus,
  totalQuantity: order.totalQuantity,
  grossRevenue: order.grossRevenue,
  productRevenue: order.productRevenue,
  customerShippingRevenue: order.customerShippingRevenue,
  discountAmount: order.discountAmount,
  otherExpenses: order.otherExpenses,
  netRevenue: order.netRevenue,
  productCost: order.productCost,
  shippingCost: order.shippingCost,
  commissionFee: order.commissionFee,
  taxes: order.taxes,
  contributionMargin: order.contributionMargin,
  contributionMarginPercentage: order.contributionMarginPercentage,
  financialDivergence: order.financialDivergence,
  items: order.items,
});

export const applyConciliationRecords = (
  orders: ConciliationOrder[],
  records: Map<string, ConciliationRecord>
): ConciliationOrder[] =>
  orders.map((order) => {
    const record = records.get(order.id) ?? null;

    if (!record) return order;

    const manualSystemStatus = isConciliationSystemStatus(record.manualSystemStatus)
      ? record.manualSystemStatus
      : null;
    const systemStatus = manualSystemStatus ?? order.automaticSystemStatus;

    const updatedOrder = applyFinancialAdjustmentsToOrder({
      ...order,
      isReconciled: record.reconciled,
      manualSystemStatus,
      systemStatus,
      conciliation: {
        ...record,
        automaticSystemStatus: order.automaticSystemStatus,
        manualSystemStatus,
        systemStatus,
      },
    }, record.financialAdjustments || {});

    return {
      ...updatedOrder,
      financialDivergence: calculateOrderFinancialDivergence(updatedOrder),
    };
  });

export const fetchConciliationRecords = async (): Promise<Map<string, ConciliationRecord>> => {
  const state = await fetchConciliationState();

  return state.records;
};

export const fetchConciliationState = async (): Promise<{
  records: Map<string, ConciliationRecord>;
  payouts: ConciliationMarketplacePayout[];
  statusSettings: ConciliationStatusSettings;
  summarySettings: ConciliationSummarySettings;
  divergenceSettings: ConciliationDivergenceSettings;
  calculationSettings: ConciliationCalculationSettings;
}> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "Não foi possível carregar o estado de conciliação.");
  }

  return {
    records: new Map(
      ((data.records || []) as ConciliationRecord[]).map((record) => [record.orderId, record])
    ),
    payouts: (data.payouts || []) as ConciliationMarketplacePayout[],
    statusSettings: (data.statusSettings || emptyStatusSettings) as ConciliationStatusSettings,
    summarySettings: (data.summarySettings || emptySummarySettings) as ConciliationSummarySettings,
    divergenceSettings: (data.divergenceSettings || emptyDivergenceSettings) as ConciliationDivergenceSettings,
    calculationSettings: {
      ...emptyCalculationSettings,
      ...(data.calculationSettings || {}),
      calculations: normalizeConciliationCustomCalculations(data.calculationSettings?.calculations),
    },
  };
};

export const saveConciliationMarketplacePayouts = async (
  payouts: ConciliationMarketplacePayoutInput[]
): Promise<ConciliationMarketplacePayout[]> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "payoutImport",
      payouts,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok || !Array.isArray(data?.payouts)) {
    throw new Error(data?.error || "Não foi possível importar os repasses.");
  }

  return data.payouts as ConciliationMarketplacePayout[];
};

export const deleteConciliationMarketplacePayoutImport = async ({
  importBatchId,
  sourceFileName,
  importedAt,
}: {
  importBatchId: string | null;
  sourceFileName: string;
  importedAt: string | null;
}): Promise<string[]> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "payoutImportDelete",
      importBatchId,
      sourceFileName,
      importedAt,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok || !Array.isArray(data?.deletedIds)) {
    throw new Error(data?.error || "Não foi possível desfazer a importação de repasses.");
  }

  return data.deletedIds as string[];
};

export const saveConciliationRecords = async (
  orders: ConciliationOrder[],
  reconciled: boolean
): Promise<Map<string, ConciliationRecord>> => {
  const records: ConciliationRecordInput[] = orders.map((order) => ({
    orderId: order.id,
    saleOrderId: order.orderId,
    number: order.number,
    storeNumber: order.storeNumber,
    date: order.date,
    marketplace: order.marketplace,
    statusName: order.statusName,
    automaticSystemStatus: order.automaticSystemStatus,
    manualSystemStatus: order.manualSystemStatus,
    systemStatus: order.systemStatus,
    snapshot: buildConciliationSnapshot(order),
  }));

  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reconciled, records }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "Não foi possível salvar a conciliação.");
  }

  return new Map(
    ((data.records || []) as ConciliationRecord[]).map((record) => [record.orderId, record])
  );
};

export const saveConciliationSystemStatus = async (
  order: ConciliationOrder,
  manualSystemStatus: ConciliationSystemStatus | null
): Promise<ConciliationRecord> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "status",
      record: {
        orderId: order.id,
        saleOrderId: order.orderId,
        number: order.number,
        storeNumber: order.storeNumber,
        date: order.date,
        marketplace: order.marketplace,
        statusName: order.statusName,
        automaticSystemStatus: order.automaticSystemStatus,
        manualSystemStatus,
        systemStatus: manualSystemStatus ?? order.automaticSystemStatus,
        snapshot: buildConciliationSnapshot({
          ...order,
          manualSystemStatus,
          systemStatus: manualSystemStatus ?? order.automaticSystemStatus,
        }),
      },
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok || !data?.record) {
    throw new Error(data?.error || "Não foi possível salvar o status do sistema.");
  }

  return data.record as ConciliationRecord;
};

export const saveConciliationFinancialAdjustments = async (
  order: ConciliationOrder,
  financialAdjustments: ConciliationFinancialAdjustmentInput[]
): Promise<ConciliationRecord> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "financialAdjustments",
      record: {
        orderId: order.id,
        saleOrderId: order.orderId,
        number: order.number,
        storeNumber: order.storeNumber,
        date: order.date,
        marketplace: order.marketplace,
        statusName: order.statusName,
        automaticSystemStatus: order.automaticSystemStatus,
        manualSystemStatus: order.manualSystemStatus,
        systemStatus: order.systemStatus,
        snapshot: buildConciliationSnapshot(order),
      },
      financialAdjustments,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok || !data?.record) {
    throw new Error(data?.error || "Não foi possível salvar os ajustes financeiros.");
  }

  return data.record as ConciliationRecord;
};

export const saveConciliationStatusMappings = async (
  statusMappings: ConciliationStatusMappings
): Promise<ConciliationStatusSettings> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "statusMappings",
      statusMappings,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok || !data?.statusSettings) {
    throw new Error(data?.error || "Não foi possível salvar o mapeamento de status.");
  }

  return data.statusSettings as ConciliationStatusSettings;
};

export const saveConciliationSummarySettings = async (
  metricIds: ConciliationSummarySettings["metricIds"]
): Promise<ConciliationSummarySettings> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "summarySettings",
      metricIds,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok || !data?.summarySettings) {
    throw new Error(data?.error || "Não foi possível salvar a configuração do resumo.");
  }

  return data.summarySettings as ConciliationSummarySettings;
};

export const saveConciliationDivergenceSettings = async (
  divergenceRules: ConciliationFinancialDivergenceRules
): Promise<ConciliationDivergenceSettings> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "divergenceRules",
      divergenceRules,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok || !data?.divergenceSettings) {
    throw new Error(data?.error || "Não foi possível salvar as regras de alerta financeiro.");
  }

  return data.divergenceSettings as ConciliationDivergenceSettings;
};

export const saveConciliationCalculationSettings = async (
  calculations: ConciliationCustomCalculationInput[]
): Promise<ConciliationCalculationSettings> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "calculationSettings",
      calculations,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok || !data?.calculationSettings) {
    throw new Error(data?.error || "Não foi possível salvar as colunas calculadas.");
  }

  return {
    ...(data.calculationSettings as ConciliationCalculationSettings),
    calculations: normalizeConciliationCustomCalculations(data.calculationSettings.calculations),
  };
};
