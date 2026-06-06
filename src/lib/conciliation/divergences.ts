import type { ConciliationSystemStatus } from "@/lib/conciliation/status";

export type ConciliationFinancialDivergenceSeverity = "ok" | "attention" | "critical";

export interface ConciliationFinancialDivergenceReason {
  id: string;
  severity: Exclude<ConciliationFinancialDivergenceSeverity, "ok">;
  title: string;
  description: string;
  amount: number | null;
}

export interface ConciliationFinancialDivergence {
  severity: ConciliationFinancialDivergenceSeverity;
  label: string;
  reasons: ConciliationFinancialDivergenceReason[];
  criticalCount: number;
  attentionCount: number;
  riskAmount: number;
  expectedGrossRevenue: number;
  grossRevenueDifference: number;
  deductionTotal: number;
  deductionCoveragePercentage: number;
  netRevenueRatio: number;
}

export interface ConciliationFinancialDivergenceSource {
  marketplace: string;
  systemStatus: ConciliationSystemStatus;
  totalQuantity: number;
  grossRevenue: number;
  productRevenue: number;
  customerShippingRevenue: number;
  discountAmount: number;
  otherExpenses: number;
  netRevenue: number;
  productCost: number;
  shippingCost: number;
  commissionFee: number;
  taxes: number;
  contributionMargin: number;
  contributionMarginPercentage: number;
}

export interface ConciliationFinancialDivergenceRule {
  moneyTolerance: number;
  grossDifferenceCriticalAmount: number;
  grossDifferenceCriticalPercentage: number;
  marginAttentionPercentage: number;
  requireProductCost: boolean;
  requireMarketplaceCommission: boolean;
  requireShippingCostWhenCustomerShipping: boolean;
  flagNonRevenueStatusWithValue: boolean;
}

export interface ConciliationFinancialDivergenceRules {
  defaultRule: ConciliationFinancialDivergenceRule;
  marketplaceRules: Record<string, Partial<ConciliationFinancialDivergenceRule>>;
}

export const defaultConciliationFinancialDivergenceRule: ConciliationFinancialDivergenceRule = {
  moneyTolerance: 0.05,
  grossDifferenceCriticalAmount: 2,
  grossDifferenceCriticalPercentage: 1,
  marginAttentionPercentage: 12,
  requireProductCost: true,
  requireMarketplaceCommission: true,
  requireShippingCostWhenCustomerShipping: true,
  flagNonRevenueStatusWithValue: true,
};

export const defaultConciliationFinancialDivergenceRules: ConciliationFinancialDivergenceRules = {
  defaultRule: defaultConciliationFinancialDivergenceRule,
  marketplaceRules: {},
};

const finiteOrDefault = (value: unknown, fallback: number) => {
  const numberValue = typeof value === "number" ? value : Number(value);

  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeRule = (
  value: unknown,
  fallback: ConciliationFinancialDivergenceRule
): ConciliationFinancialDivergenceRule => {
  const rule = value && typeof value === "object" ? (value as Partial<ConciliationFinancialDivergenceRule>) : {};

  return {
    moneyTolerance: clamp(finiteOrDefault(rule.moneyTolerance, fallback.moneyTolerance), 0, 100000),
    grossDifferenceCriticalAmount: clamp(
      finiteOrDefault(rule.grossDifferenceCriticalAmount, fallback.grossDifferenceCriticalAmount),
      0,
      1000000
    ),
    grossDifferenceCriticalPercentage: clamp(
      finiteOrDefault(rule.grossDifferenceCriticalPercentage, fallback.grossDifferenceCriticalPercentage),
      0,
      100
    ),
    marginAttentionPercentage: clamp(
      finiteOrDefault(rule.marginAttentionPercentage, fallback.marginAttentionPercentage),
      -100,
      100
    ),
    requireProductCost:
      typeof rule.requireProductCost === "boolean" ? rule.requireProductCost : fallback.requireProductCost,
    requireMarketplaceCommission:
      typeof rule.requireMarketplaceCommission === "boolean"
        ? rule.requireMarketplaceCommission
        : fallback.requireMarketplaceCommission,
    requireShippingCostWhenCustomerShipping:
      typeof rule.requireShippingCostWhenCustomerShipping === "boolean"
        ? rule.requireShippingCostWhenCustomerShipping
        : fallback.requireShippingCostWhenCustomerShipping,
    flagNonRevenueStatusWithValue:
      typeof rule.flagNonRevenueStatusWithValue === "boolean"
        ? rule.flagNonRevenueStatusWithValue
        : fallback.flagNonRevenueStatusWithValue,
  };
};

export const normalizeConciliationFinancialDivergenceRules = (
  value: unknown
): ConciliationFinancialDivergenceRules => {
  const source = value && typeof value === "object" ? (value as Partial<ConciliationFinancialDivergenceRules>) : {};
  const defaultRule = normalizeRule(source.defaultRule, defaultConciliationFinancialDivergenceRule);
  const marketplaceRules =
    source.marketplaceRules && typeof source.marketplaceRules === "object" ? source.marketplaceRules : {};

  return {
    defaultRule,
    marketplaceRules: Object.entries(marketplaceRules).reduce<
      Record<string, Partial<ConciliationFinancialDivergenceRule>>
    >((rules, [marketplaceName, rule]) => {
      const marketplace = marketplaceName.trim();

      if (!marketplace) return rules;

      rules[marketplace] = normalizeRule(rule, defaultRule);

      return rules;
    }, {}),
  };
};

export const resolveConciliationFinancialDivergenceRule = (
  marketplace: string,
  rules: ConciliationFinancialDivergenceRules = defaultConciliationFinancialDivergenceRules
): ConciliationFinancialDivergenceRule => {
  const normalizedRules = normalizeConciliationFinancialDivergenceRules(rules);
  const marketplaceRule = normalizedRules.marketplaceRules[marketplace];

  return marketplaceRule ? { ...normalizedRules.defaultRule, ...marketplaceRule } : normalizedRules.defaultRule;
};

export const getConciliationFinancialDivergenceScore = (
  severity: ConciliationFinancialDivergenceSeverity
): number => {
  if (severity === "critical") return 2;
  if (severity === "attention") return 1;

  return 0;
};

const getSeverityLabel = (severity: ConciliationFinancialDivergenceSeverity) => {
  if (severity === "critical") return "Crítico";
  if (severity === "attention") return "Atenção";

  return "Sem alerta";
};

const isNonRevenueSystemStatus = (systemStatus: ConciliationSystemStatus) =>
  systemStatus === "Cancelado" ||
  systemStatus === "Devolução" ||
  systemStatus === "Devolução / Reembolso Parcial";

const hasMarketplace = (marketplace: string) => {
  const normalized = marketplace.trim().toLowerCase();

  return Boolean(normalized && normalized !== "sem marketplace" && normalized !== "n/a");
};

const hasAmount = (value: number, moneyTolerance: number) => Math.abs(value) > moneyTolerance;

const addReason = (
  reasons: ConciliationFinancialDivergenceReason[],
  reason: ConciliationFinancialDivergenceReason
) => {
  reasons.push(reason);
};

export const calculateConciliationFinancialDivergence = (
  source: ConciliationFinancialDivergenceSource,
  rules: ConciliationFinancialDivergenceRules = defaultConciliationFinancialDivergenceRules
): ConciliationFinancialDivergence => {
  const rule = resolveConciliationFinancialDivergenceRule(source.marketplace, rules);
  const { moneyTolerance } = rule;
  const expectedGrossRevenue =
    source.productRevenue + source.customerShippingRevenue + source.otherExpenses - source.discountAmount;
  const grossRevenueDifference = source.grossRevenue - expectedGrossRevenue;
  const deductionTotal = source.shippingCost + source.commissionFee + source.taxes + source.productCost;
  const deductionCoveragePercentage =
    source.grossRevenue > moneyTolerance ? (deductionTotal / source.grossRevenue) * 100 : 0;
  const netRevenueRatio = source.grossRevenue > moneyTolerance ? (source.netRevenue / source.grossRevenue) * 100 : 0;
  const reasons: ConciliationFinancialDivergenceReason[] = [];
  const nonRevenueStatus = isNonRevenueSystemStatus(source.systemStatus);
  const revenueOrder = source.grossRevenue > moneyTolerance && !nonRevenueStatus;

  if (expectedGrossRevenue > moneyTolerance && hasAmount(grossRevenueDifference, moneyTolerance)) {
    const criticalTolerance = Math.max(
      rule.grossDifferenceCriticalAmount,
      source.grossRevenue * (rule.grossDifferenceCriticalPercentage / 100)
    );
    const severity = Math.abs(grossRevenueDifference) > criticalTolerance ? "critical" : "attention";

    addReason(reasons, {
      id: "gross-total-mismatch",
      severity,
      title: "Total do pedido divergente",
      description: "O total bruto difere da composição produtos + frete cliente + despesas - desconto.",
      amount: Math.abs(grossRevenueDifference),
    });
  }

  if (rule.flagNonRevenueStatusWithValue && nonRevenueStatus && source.grossRevenue > moneyTolerance) {
    addReason(reasons, {
      id: "non-revenue-status-with-value",
      severity: "attention",
      title: "Status sem receita com valor",
      description: "O status de sistema indica cancelamento ou devolução, mas o pedido ainda possui faturamento.",
      amount: source.grossRevenue,
    });
  }

  if (rule.requireProductCost && revenueOrder && source.totalQuantity > 0 && source.productCost <= moneyTolerance) {
    addReason(reasons, {
      id: "missing-product-cost",
      severity: "critical",
      title: "Custo de produto ausente",
      description: "Sem custo de produto a margem do pedido fica incompleta para conciliação.",
      amount: Math.max(source.netRevenue, 0),
    });
  }

  if (
    rule.requireMarketplaceCommission &&
    revenueOrder &&
    hasMarketplace(source.marketplace) &&
    source.commissionFee <= moneyTolerance
  ) {
    addReason(reasons, {
      id: "missing-marketplace-commission",
      severity: "attention",
      title: "Comissão zerada",
      description: "Pedido de marketplace sem taxa de comissão registrada.",
      amount: null,
    });
  }

  if (
    revenueOrder &&
    rule.requireShippingCostWhenCustomerShipping &&
    source.customerShippingRevenue > moneyTolerance &&
    source.shippingCost <= moneyTolerance
  ) {
    addReason(reasons, {
      id: "missing-shipping-cost",
      severity: "attention",
      title: "Custo de frete zerado",
      description: "O cliente possui frete no pedido, mas o custo de frete operacional está zerado.",
      amount: source.customerShippingRevenue,
    });
  }

  if (source.netRevenue < -moneyTolerance) {
    addReason(reasons, {
      id: "negative-net-revenue",
      severity: "critical",
      title: "Líquido negativo",
      description: "Frete, comissão e impostos superam o faturamento bruto.",
      amount: Math.abs(source.netRevenue),
    });
  }

  if (source.netRevenue - source.grossRevenue > moneyTolerance) {
    addReason(reasons, {
      id: "net-greater-than-gross",
      severity: "critical",
      title: "Líquido maior que bruto",
      description: "O líquido estimado ficou maior que o faturamento bruto, indicando composição financeira inconsistente.",
      amount: source.netRevenue - source.grossRevenue,
    });
  }

  if (revenueOrder && source.productCost > moneyTolerance && source.contributionMargin < -moneyTolerance) {
    addReason(reasons, {
      id: "negative-margin",
      severity: "critical",
      title: "Margem negativa",
      description: "O pedido apresenta margem de contribuição negativa após custos e deduções disponíveis.",
      amount: Math.abs(source.contributionMargin),
    });
  } else if (
    revenueOrder &&
    source.productCost > moneyTolerance &&
    source.contributionMarginPercentage < rule.marginAttentionPercentage
  ) {
    const targetMargin = source.grossRevenue * (rule.marginAttentionPercentage / 100);

    addReason(reasons, {
      id: "low-margin",
      severity: "attention",
      title: "Margem baixa",
      description: `Margem abaixo de ${rule.marginAttentionPercentage}% para conferência operacional.`,
      amount: Math.max(targetMargin - source.contributionMargin, 0),
    });
  }

  const criticalCount = reasons.filter((reason) => reason.severity === "critical").length;
  const attentionCount = reasons.filter((reason) => reason.severity === "attention").length;
  const severity: ConciliationFinancialDivergenceSeverity =
    criticalCount > 0 ? "critical" : attentionCount > 0 ? "attention" : "ok";
  const riskAmount = reasons.reduce((total, reason) => total + Math.abs(reason.amount || 0), 0);

  return {
    severity,
    label: getSeverityLabel(severity),
    reasons,
    criticalCount,
    attentionCount,
    riskAmount,
    expectedGrossRevenue,
    grossRevenueDifference,
    deductionTotal,
    deductionCoveragePercentage,
    netRevenueRatio,
  };
};
