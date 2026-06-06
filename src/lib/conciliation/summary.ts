export const conciliationSummaryMetricOptions = [
  "grossRevenue",
  "netRevenue",
  "productCost",
  "contributionMargin",
  "contributionMarginPercentage",
  "ordersCount",
  "averageTicket",
  "itemsQuantity",
  "reconciledCount",
  "pendingCount",
  "reconciledPercentage",
  "financialAlertCount",
  "financialCriticalCount",
  "financialRiskAmount",
] as const;

export type ConciliationSummaryMetricId = (typeof conciliationSummaryMetricOptions)[number];

export const defaultConciliationSummaryMetricIds: ConciliationSummaryMetricId[] = [
  "grossRevenue",
  "netRevenue",
  "productCost",
  "contributionMargin",
  "reconciledPercentage",
];

const summaryMetricOptionSet = new Set<string>(conciliationSummaryMetricOptions);

export const isConciliationSummaryMetricId = (value: unknown): value is ConciliationSummaryMetricId =>
  typeof value === "string" && summaryMetricOptionSet.has(value);

export const normalizeConciliationSummaryMetricIds = (value: unknown): ConciliationSummaryMetricId[] => {
  if (!Array.isArray(value)) return defaultConciliationSummaryMetricIds;

  const metricIds = value.filter(isConciliationSummaryMetricId);
  const uniqueMetricIds = Array.from(new Set(metricIds));

  return uniqueMetricIds.length > 0 ? uniqueMetricIds : defaultConciliationSummaryMetricIds;
};
