import type { SaleOrder } from "@/types/sale-order";
import type {
  ConciliationFinancialDivergence,
  ConciliationFinancialDivergenceRules,
} from "@/lib/conciliation/divergences";
import type { ConciliationSystemStatus } from "@/lib/conciliation/status";
import type { ConciliationSummaryMetricId } from "@/lib/conciliation/summary";

export type ConciliationMarketplace = "Todos" | string;
export type ConciliationStatusMappings = Record<string, ConciliationSystemStatus>;

export interface ConciliationOrderItem {
  id: string;
  sku: string;
  description: string;
  quantity: number;
  unitValue: number;
  grossValue: number;
}

export interface ConciliationOrder {
  id: string;
  orderId: number;
  number: number | null;
  storeNumber: string;
  date: string;
  customerName: string;
  accountName: string;
  marketplace: string;
  statusName: string;
  automaticSystemStatus: ConciliationSystemStatus;
  manualSystemStatus: ConciliationSystemStatus | null;
  systemStatus: ConciliationSystemStatus;
  items: ConciliationOrderItem[];
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
  calculationValues: Record<string, ConciliationCalculationValue>;
  financialDivergence: ConciliationFinancialDivergence;
  financialAdjustments: ConciliationFinancialAdjustments;
  marketplacePayouts: ConciliationMarketplacePayout[];
  payoutComparison: ConciliationPayoutComparison;
  isReconciled: boolean;
  conciliation: ConciliationRecord | null;
  originalOrder: SaleOrder;
}

export interface ConciliationSummary {
  ordersCount: number;
  itemsQuantity: number;
  grossRevenue: number;
  netRevenue: number;
  productCost: number;
  contributionMargin: number;
  contributionMarginPercentage: number;
  averageTicket: number;
  reconciledCount: number;
  pendingCount: number;
  reconciledPercentage: number;
  financialAlertCount: number;
  financialAttentionCount: number;
  financialCriticalCount: number;
  financialAlertPercentage: number;
  financialRiskAmount: number;
  payoutMatchedCount: number;
  payoutDivergentCount: number;
  payoutMissingCount: number;
  payoutNetAmount: number;
  payoutDifferenceAmount: number;
}

export interface ConciliationActor {
  id: string;
  name: string;
  email: string;
}

export type ConciliationAuditEventType =
  | "reconciled"
  | "unreconciled"
  | "system-status-updated"
  | "financial-adjustment-updated";

export interface ConciliationAuditEvent {
  id: string;
  type: ConciliationAuditEventType;
  title: string;
  description: string;
  at: string;
  actor: ConciliationActor | null;
  details: Record<string, string | number | boolean | null>;
}

export interface ConciliationStatusSettings {
  statusMappings: ConciliationStatusMappings;
  updatedAt: string | null;
  updatedBy: ConciliationActor | null;
}

export interface ConciliationSummarySettings {
  metricIds: ConciliationSummaryMetricId[];
  updatedAt: string | null;
  updatedBy: ConciliationActor | null;
}

export interface ConciliationDivergenceSettings extends ConciliationFinancialDivergenceRules {
  updatedAt: string | null;
  updatedBy: ConciliationActor | null;
}

export interface ConciliationCalculationValue {
  id: string;
  name: string;
  description: string;
  expression: string;
  value: number;
  isPercentage: boolean;
  error: string | null;
}

export interface ConciliationCustomCalculation {
  id: string;
  name: string;
  description: string;
  expression: string;
  isPercentage: boolean;
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: ConciliationActor | null;
}

export interface ConciliationCalculationSettings {
  calculations: ConciliationCustomCalculation[];
  updatedAt: string | null;
  updatedBy: ConciliationActor | null;
}

export interface ConciliationCustomCalculationInput {
  id?: string;
  name: string;
  description: string;
  expression: string;
  isPercentage: boolean;
  enabled: boolean;
}

export type ConciliationPayoutComparisonStatus = "missing" | "matched" | "divergent";

export interface ConciliationMarketplacePayout {
  id: string;
  marketplace: string;
  orderKey: string;
  paidAt: string | null;
  grossAmount: number;
  feeAmount: number;
  shippingAmount: number;
  netAmount: number;
  sourceFileName: string;
  sourceRow: number;
  importBatchId: string | null;
  importedAt: string | null;
  importedBy: ConciliationActor | null;
}

export interface ConciliationMarketplacePayoutInput {
  id: string;
  marketplace: string;
  orderKey: string;
  paidAt: string | null;
  grossAmount: number;
  feeAmount: number;
  shippingAmount: number;
  netAmount: number;
  sourceFileName: string;
  sourceRow: number;
}

export interface ConciliationPayoutComparison {
  status: ConciliationPayoutComparisonStatus;
  label: string;
  payoutCount: number;
  expectedNetAmount: number;
  paidNetAmount: number;
  differenceAmount: number;
  toleranceAmount: number;
}

export interface ConciliationFinancialSnapshot {
  orderId: string;
  saleOrderId: number;
  number: number | null;
  storeNumber: string;
  date: string;
  customerName: string;
  accountName: string;
  marketplace: string;
  statusName: string;
  automaticSystemStatus: ConciliationSystemStatus;
  manualSystemStatus: ConciliationSystemStatus | null;
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
  financialDivergence: ConciliationFinancialDivergence;
  items: ConciliationOrderItem[];
}

export type ConciliationFinancialAdjustmentFieldId =
  | "grossRevenue"
  | "productRevenue"
  | "customerShippingRevenue"
  | "discountAmount"
  | "otherExpenses"
  | "productCost"
  | "shippingCost"
  | "commissionFee"
  | "taxes";

export interface ConciliationFinancialAdjustment {
  fieldId: ConciliationFinancialAdjustmentFieldId;
  label: string;
  originalValue: number;
  adjustedValue: number | null;
  reason: string;
  active: boolean;
  updatedAt: string | null;
  updatedBy: ConciliationActor | null;
}

export type ConciliationFinancialAdjustments = Partial<
  Record<ConciliationFinancialAdjustmentFieldId, ConciliationFinancialAdjustment>
>;

export interface ConciliationFinancialAdjustmentInput {
  fieldId: ConciliationFinancialAdjustmentFieldId;
  label: string;
  originalValue: number;
  adjustedValue: number | null;
  reason: string;
  active: boolean;
}

export interface ConciliationRecord {
  orderId: string;
  saleOrderId: number;
  number: number | null;
  storeNumber: string;
  date: string;
  marketplace: string;
  statusName: string;
  automaticSystemStatus: ConciliationSystemStatus;
  manualSystemStatus: ConciliationSystemStatus | null;
  systemStatus: ConciliationSystemStatus;
  reconciled: boolean;
  reconciledAt: string | null;
  reconciledBy: ConciliationActor | null;
  unreconciledAt: string | null;
  unreconciledBy: ConciliationActor | null;
  systemStatusUpdatedAt: string | null;
  systemStatusUpdatedBy: ConciliationActor | null;
  updatedAt: string | null;
  updatedBy: ConciliationActor | null;
  history: ConciliationAuditEvent[];
  snapshot: ConciliationFinancialSnapshot | null;
  financialAdjustments: ConciliationFinancialAdjustments;
}

export interface ConciliationRecordInput {
  orderId: string;
  saleOrderId: number;
  number: number | null;
  storeNumber: string;
  date: string;
  marketplace: string;
  statusName: string;
  automaticSystemStatus: ConciliationSystemStatus;
  manualSystemStatus: ConciliationSystemStatus | null;
  systemStatus: ConciliationSystemStatus;
  snapshot: ConciliationFinancialSnapshot;
}
