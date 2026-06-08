"use client";

import * as React from "react";
import {
  AlertTriangle,
  Banknote,
  Calendar as CalendarIcon,
  BarChart3,
  Calculator,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  DollarSign,
  FileDown,
  FileSearch,
  FileText,
  Files,
  GripVertical,
  Hash,
  History,
  CircleAlert,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  LayoutGrid,
  Loader2,
  Package,
  Percent,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Table2,
  TrendingUp,
  Truck,
  Trash2,
  Undo2,
  Upload,
  User,
  Wallet,
} from "lucide-react";
import { endOfDay, endOfMonth, format, parseISO, startOfDay, startOfMonth, subDays, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import * as XLSX from "xlsx";

import DashboardLayout from "@/components/dashboard-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  defaultConciliationSummaryMetricIds,
  type ConciliationSummaryMetricId,
  normalizeConciliationSummaryMetricIds,
  conciliationSummaryMetricOptions,
} from "@/lib/conciliation/summary";
import {
  getConciliationFinancialDivergenceScore,
  defaultConciliationFinancialDivergenceRules,
  normalizeConciliationFinancialDivergenceRules,
  resolveConciliationFinancialDivergenceRule,
  type ConciliationFinancialDivergence,
  type ConciliationFinancialDivergenceRule,
  type ConciliationFinancialDivergenceRules,
  type ConciliationFinancialDivergenceSeverity,
} from "@/lib/conciliation/divergences";
import {
  conciliationCalculationFieldOptions,
  sanitizeConciliationCalculationId,
  validateConciliationCalculationExpression,
  type ConciliationCalculationFieldId,
} from "@/lib/conciliation/calculations";
import {
  conciliationSystemStatusOptions,
  resolveAutomaticSystemStatus,
  type ConciliationSystemStatus,
} from "@/lib/conciliation/status";
import {
  getConciliationSystemStatusDefinition,
  getConciliationSystemStatusDisplayName,
  getConciliationSystemStatusPresentation,
} from "@/lib/conciliation/system-status-settings";
import { cn } from "@/lib/utils";
import {
  applyStatusMappings,
  applyMarketplacePayouts,
  applyCustomCalculationsToOrders,
  applyFinancialDivergenceRules,
  applyConciliationRecords,
  calculateConciliationSummary,
  fetchConciliationState,
  deleteConciliationMarketplacePayoutImport,
  saveConciliationRecords,
  saveConciliationCalculationSettings,
  saveConciliationDivergenceSettings,
  saveConciliationFinancialAdjustments,
  saveConciliationMarketplacePayouts,
  saveConciliationStatusMappings,
  saveConciliationSummarySettings,
  saveConciliationSystemStatus,
  normalizeConciliationPayoutOrderKey,
  subscribeConciliationOrders,
} from "@/services/conciliation-service";
import type {
  ConciliationAuditEvent,
  ConciliationCalculationSettings,
  ConciliationCustomCalculation,
  ConciliationCustomCalculationInput,
  ConciliationDivergenceSettings,
  ConciliationFinancialAdjustment,
  ConciliationFinancialAdjustmentFieldId,
  ConciliationFinancialAdjustmentInput,
  ConciliationMarketplacePayout,
  ConciliationMarketplacePayoutInput,
  ConciliationOrder,
  ConciliationOrderItem,
  ConciliationPayoutComparisonStatus,
  ConciliationRecord,
  ConciliationSummarySettings,
  ConciliationStatusMappings,
  ConciliationStatusSettings,
  ConciliationSystemStatusSettings,
  ConciliationSummary,
} from "@/types/conciliation";



export type SystemStatusFilter = "Todos" | ConciliationSystemStatus;

export type AppliedFilters = {
  date: DateRange | undefined;
  marketplace: string;
  account: string;
  orderStatus: string;
  systemStatus: SystemStatusFilter;
  financialAlert: FinancialAlertFilter;
  adjustmentStatus: AdjustmentStatusFilter;
  payoutStatus: PayoutStatusFilter;
  suggestion: SuggestionFilter;
  reconciliationStatus: ReconciliationStatusFilter;
  searchTerm: string;
};

export type ReconciliationStatusFilter = "Todos" | "Pendentes" | "Conciliados";
export type FinancialAlertFilter = "Todos" | "Com alerta" | "Críticos" | "Atenção" | "Sem alerta";
export type AdjustmentStatusFilter = "Todos" | "Com ajustes" | "Sem ajustes";
export type PayoutStatusFilter = "Todos" | "Sem repasse" | "Repasse OK" | "Divergente";
export type SuggestionFilter = "Todos" | "Sugeridos" | "Revisar";
export type SortDirection = "asc" | "desc";

export type SortConfig = {
  columnId: ConciliationColumnId;
  direction: SortDirection;
};

export type SortFeedback = {
  columnId: ConciliationColumnId;
  columnLabel: string;
  totalRows: number;
};

export type ColumnMoveFeedback = {
  columnId: ConciliationColumnId;
  columnLabel: string;
  detail: string;
};

export type ViewMode = "table" | "cards";
export type TableDensity = "compact" | "comfortable";

export type SummaryMetricDefinition = {
  id: ConciliationSummaryMetricId;
  title: string;
  icon: React.ElementType;
  value: (summary: ConciliationSummary) => string;
  helper?: (summary: ConciliationSummary) => string;
};

export const reconciliationStatusOptions: ReconciliationStatusFilter[] = ["Todos", "Pendentes", "Conciliados"];
export const financialAlertOptions: FinancialAlertFilter[] = ["Todos", "Com alerta", "Críticos", "Atenção", "Sem alerta"];
export const adjustmentStatusOptions: AdjustmentStatusFilter[] = ["Todos", "Com ajustes", "Sem ajustes"];
export const payoutStatusOptions: PayoutStatusFilter[] = ["Todos", "Sem repasse", "Repasse OK", "Divergente"];
export const suggestionOptions: SuggestionFilter[] = ["Todos", "Sugeridos", "Revisar"];

export const conciliationColumnOptions = [
  { id: "conciliation", label: "Conciliação", group: "Sistema" },
  { id: "items", label: "Itens", group: "Pedido" },
  { id: "order", label: "Pedido", group: "Pedido" },
  { id: "date", label: "Data", group: "Pedido" },
  { id: "customer", label: "Cliente", group: "Pedido" },
  { id: "account", label: "Conta", group: "Pedido" },
  { id: "marketplace", label: "Marketplace", group: "Marketplace" },
  { id: "product", label: "Produto", group: "Produto" },
  { id: "quantity", label: "Qtd", group: "Produto" },
  { id: "status", label: "Status Pedido", group: "Status" },
  { id: "grossRevenue", label: "Faturamento Bruto", group: "Financeiro" },
  { id: "netRevenue", label: "Líquido", group: "Financeiro" },
  { id: "taxes", label: "Imposto", group: "Financeiro" },
  { id: "margin", label: "Margem de Contribuição", group: "Financeiro" },
  { id: "marginPercentage", label: "Margem %", group: "Financeiro" },
  { id: "adjustments", label: "Ajustes", group: "Financeiro" },
  { id: "calculatedColumns", label: "Cálculos", group: "Financeiro" },
  { id: "suggestion", label: "Sugestão", group: "Conciliação" },
  { id: "financialAlert", label: "Alerta Financeiro", group: "Conciliação" },
  { id: "payout", label: "Repasse", group: "Conciliação" },
  { id: "systemStatus", label: "Status Sistema", group: "Status" },
  { id: "productCost", label: "Custo Produto", group: "Produto" },
] as const;

export type StaticConciliationColumnId = (typeof conciliationColumnOptions)[number]["id"];
export const calculationColumnPrefix = "calculation:" as const;
export type ConciliationCalculationColumnId = `${typeof calculationColumnPrefix}${string}`;
export const sheetColumnPrefix = "sheet:" as const;
export type ConciliationSheetColumnId = `${typeof sheetColumnPrefix}${string}`;
export type ConciliationColumnId =
  | StaticConciliationColumnId
  | ConciliationCalculationColumnId
  | ConciliationSheetColumnId;
export type ConciliationColumnOption = {
  id: ConciliationColumnId;
  label: string;
  group: string;
  description?: string;
  calculationId?: string;
  isDynamic?: boolean;
};

export const allConciliationColumnIds = conciliationColumnOptions.map(
  (column) => column.id
) as StaticConciliationColumnId[];
export const allConciliationColumnIdSet = new Set<StaticConciliationColumnId>(allConciliationColumnIds);
export const defaultColumnOrderIds: ConciliationColumnId[] = [...allConciliationColumnIds];
export const defaultVisibleColumnIds: ConciliationColumnId[] = [
  "conciliation",
  "items",
  "order",
  "date",
  "account",
  "marketplace",
  "product",
  "quantity",
  "status",
  "systemStatus",
  "grossRevenue",
  "netRevenue",
  "taxes",
  "margin",
  "marginPercentage",
  "adjustments",
  "calculatedColumns",
];
export const visibleColumnsStorageKey = "brsteel.conciliacao.visibleColumns.v10";
export const appliedQueryStorageKey = "brsteel.conciliacao.appliedQuery.v1";
export const columnOrderStorageKey = "brsteel.conciliacao.columnOrder.v2";
export const knownCalculationColumnsStorageKey = "brsteel.conciliacao.knownCalculationColumns.v1";
export const viewModeStorageKey = "brsteel.conciliacao.viewMode.v1";
export const tableDensityStorageKey = "brsteel.conciliacao.tableDensity.v1";
export const referencePanelClassName = "rounded-xl border-slate-200 bg-white shadow-sm transition-all duration-200 hover:shadow-md";
export const referenceOutlineButtonClassName =
  "h-10 whitespace-nowrap rounded-md border-slate-200 bg-transparent px-4 text-sm font-medium text-slate-950 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-950 active:scale-[0.98]";
export const referenceCompactButtonClassName =
  "h-8 whitespace-nowrap rounded-md border-slate-200 bg-transparent px-3 text-xs font-medium text-slate-950 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-950 active:scale-[0.98]";
export const referenceToolbarButtonClassName =
  "h-9 whitespace-nowrap rounded-md border-slate-200 bg-transparent px-3 text-sm font-medium text-slate-950 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-950 active:scale-[0.98]";
export const referenceDateButtonClassName =
  "h-10 rounded-lg border-zinc-300 bg-white px-4 text-sm font-normal text-slate-950 shadow-none transition-colors hover:border-[#4169E1] hover:bg-white hover:text-slate-950 focus:ring-[#4169E1]";
export const referenceControlClassName =
  "h-9 rounded-md border-slate-300 bg-white text-sm text-slate-950 shadow-sm focus:ring-[#4169E1]";
export const referencePrimaryButtonClassName =
  "h-10 min-w-[110px] rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-all duration-200 hover:bg-primary/90 active:scale-[0.98]";

export const rowsPerPageOptions = [20, 50, 100];
export const tableDensityOptions: Array<{ id: TableDensity; label: string }> = [
  { id: "compact", label: "Compacta" },
  { id: "comfortable", label: "Conforto" },
];
export const automaticStatusSelectValue = "__auto__";
export const defaultDivergenceRuleScopeValue = "__default__";
export const financialAdjustmentFields: Array<{
  id: ConciliationFinancialAdjustmentFieldId;
  label: string;
  helper: string;
}> = [
  { id: "grossRevenue", label: "Faturamento bruto", helper: "Valor total do pedido" },
  { id: "productRevenue", label: "Produtos", helper: "Subtotal dos produtos" },
  { id: "customerShippingRevenue", label: "Frete cliente", helper: "Frete cobrado do cliente" },
  { id: "discountAmount", label: "Desconto", helper: "Desconto aplicado no pedido" },
  { id: "otherExpenses", label: "Outras despesas", helper: "Despesas adicionais do pedido" },
  { id: "shippingCost", label: "Frete custo", helper: "Custo logístico" },
  { id: "commissionFee", label: "Comissão", helper: "Taxa/comissão do marketplace" },
  { id: "taxes", label: "Impostos", helper: "Tributos considerados no cálculo" },
  { id: "productCost", label: "Custo produto", helper: "CMV total do pedido" },
];

export const toCalculationColumnId = (calculationId: string): ConciliationCalculationColumnId =>
  `${calculationColumnPrefix}${calculationId}`;

export const getCalculationIdFromColumnId = (columnId: ConciliationColumnId): string | null =>
  typeof columnId === "string" && columnId.startsWith(calculationColumnPrefix)
    ? columnId.slice(calculationColumnPrefix.length)
    : null;

export const isCalculationColumnId = (value: unknown): value is ConciliationCalculationColumnId =>
  typeof value === "string" && value.startsWith(calculationColumnPrefix) && value.length > calculationColumnPrefix.length;

export const toSheetColumnId = (fieldKey: string): ConciliationSheetColumnId =>
  `${sheetColumnPrefix}${fieldKey}`;

export const getSheetKeyFromColumnId = (columnId: ConciliationColumnId): string | null =>
  typeof columnId === "string" && columnId.startsWith(sheetColumnPrefix)
    ? columnId.slice(sheetColumnPrefix.length)
    : null;

export const isSheetColumnId = (value: unknown): value is ConciliationSheetColumnId =>
  typeof value === "string" && value.startsWith(sheetColumnPrefix) && value.length > sheetColumnPrefix.length;

export const isStaticConciliationColumnId = (value: unknown): value is StaticConciliationColumnId =>
  typeof value === "string" && allConciliationColumnIdSet.has(value as StaticConciliationColumnId);

export const isConciliationColumnId = (value: unknown): value is ConciliationColumnId =>
  isStaticConciliationColumnId(value) || isCalculationColumnId(value) || isSheetColumnId(value);

const knownSheetFieldLabels: Record<string, string> = {
  commission: "Comissão (Planilha)",
  shipping: "Frete (Planilha)",
  fee: "Taxa (Planilha)",
  discount: "Desconto (Planilha)",
  tax: "Imposto (Planilha)",
  netValue: "Líquido Repassado (Planilha)",
  unitCost: "Custo Unitário (Planilha)",
  refundAmount: "Valor Reembolsado",
  returnReason: "Motivo Devolução",
  returnQuantity: "Qtd Devolvida",
};

export const buildSheetColumnOptions = (
  fieldKeys: string[],
  labelByKey?: Map<string, string>
): ConciliationColumnOption[] =>
  fieldKeys.map((fieldKey) => ({
    id: toSheetColumnId(fieldKey),
    label: labelByKey?.get(fieldKey) ?? knownSheetFieldLabels[fieldKey] ?? `Planilha: ${fieldKey}`,
    group: "Planilhas",
    isDynamic: true,
  }));

export const normalizeColumnOrderIds = (value: unknown): ConciliationColumnId[] => {
  const normalized: ConciliationColumnId[] = [];

  if (Array.isArray(value)) {
    value.forEach((columnId) => {
      if (isConciliationColumnId(columnId) && !normalized.includes(columnId)) {
        normalized.push(columnId);
      }
    });
  }

  defaultColumnOrderIds.forEach((columnId) => {
    if (!normalized.includes(columnId)) {
      normalized.push(columnId);
    }
  });

  return normalized;
};

export const getColumnAlignment = (columnId: ConciliationColumnId): "left" | "center" | "right" => {
  if (isCalculationColumnId(columnId)) return "right";
  if (isSheetColumnId(columnId)) return "right";
  if (columnId === "quantity") return "center";
  if (
    columnId === "grossRevenue" ||
    columnId === "netRevenue" ||
    columnId === "taxes" ||
    columnId === "productCost" ||
    columnId === "margin" ||
    columnId === "marginPercentage"
  ) {
    return "right";
  }

  return "left";
};

export const buildCalculationColumnOptions = (
  calculations: ConciliationCustomCalculation[]
): ConciliationColumnOption[] =>
  calculations
    .filter((calculation) => calculation.enabled)
    .map((calculation) => ({
      id: toCalculationColumnId(calculation.id),
      label: calculation.name,
      group: "Cálculos",
      description: calculation.description || calculation.expression,
      calculationId: calculation.id,
      isDynamic: true,
    }));

export const buildDefaultColumnOrderWithCalculations = (
  calculationColumnIds: ConciliationCalculationColumnId[]
): ConciliationColumnId[] => {
  const next: ConciliationColumnId[] = [...defaultColumnOrderIds];
  const insertIndex = next.indexOf("calculatedColumns") + 1;

  next.splice(insertIndex > 0 ? insertIndex : next.length, 0, ...calculationColumnIds);

  return next;
};

export type SystemStatusSelectValue = typeof automaticStatusSelectValue | ConciliationSystemStatus;
export type DivergenceRuleField = keyof ConciliationFinancialDivergenceRule;
export type FinancialAdjustmentDraft = Record<ConciliationFinancialAdjustmentFieldId, { value: string; reason: string }>;

export const serializeStatusMappings = (mappings: ConciliationStatusMappings) =>
  JSON.stringify(
    Object.keys(mappings)
      .sort((first, second) => first.localeCompare(second, "pt-BR", { numeric: true }))
      .map((statusName) => [statusName, mappings[statusName]])
  );

export const serializeSummaryMetricIds = (metricIds: ConciliationSummaryMetricId[]) => JSON.stringify(metricIds);

export const serializeDivergenceRules = (rules: ConciliationFinancialDivergenceRules) => {
  const normalizedRules = normalizeConciliationFinancialDivergenceRules(rules);

  return JSON.stringify({
    defaultRule: normalizedRules.defaultRule,
    marketplaceRules: Object.keys(normalizedRules.marketplaceRules)
      .sort(compareString)
      .map((marketplace) => [marketplace, normalizedRules.marketplaceRules[marketplace]]),
  });
};

export const compareString = (first: string, second: string) => first.localeCompare(second, "pt-BR", { numeric: true });

export const emptySummary: ConciliationSummary = {
  ordersCount: 0,
  itemsQuantity: 0,
  grossRevenue: 0,
  netRevenue: 0,
  productCost: 0,
  contributionMargin: 0,
  contributionMarginPercentage: 0,
  averageTicket: 0,
  reconciledCount: 0,
  pendingCount: 0,
  reconciledPercentage: 0,
  financialAlertCount: 0,
  financialAttentionCount: 0,
  financialCriticalCount: 0,
  financialAlertPercentage: 0,
  financialRiskAmount: 0,
  payoutMatchedCount: 0,
  payoutDivergentCount: 0,
  payoutMissingCount: 0,
  payoutNetAmount: 0,
  payoutDifferenceAmount: 0,
};

export const formatCurrency = (value: number | undefined) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);

export const formatCurrencyInput = (value: number | undefined | null) =>
  value === null || value === undefined
    ? ""
    : new Intl.NumberFormat("pt-BR", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }).format(value);

export const parseCurrencyInput = (value: string): number | null => {
  const normalized = value
    .trim()
    .replace(/\s/g, "")
    .replace(/[R$]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  if (!normalized) return null;

  const numberValue = Number(normalized);

  return Number.isFinite(numberValue) ? numberValue : null;
};

export const formatNumber = (value: number | undefined) => new Intl.NumberFormat("pt-BR").format(value || 0);

export const formatPercentage = (value: number | undefined) =>
  `${new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(value || 0)}%`;

export const getItemAllocationShare = (order: ConciliationOrder, item: ConciliationOrderItem) => {
  const itemsGrossValue = order.items.reduce((total, currentItem) => total + currentItem.grossValue, 0);

  if (itemsGrossValue > 0) {
    return item.grossValue / itemsGrossValue;
  }

  if (order.totalQuantity > 0) {
    return item.quantity / order.totalQuantity;
  }

  return 0;
};

export const allocateOrderAmountToItem = (
  order: ConciliationOrder,
  item: ConciliationOrderItem,
  amount: number | undefined
) => (amount || 0) * getItemAllocationShare(order, item);

export const formatClock = (value: Date | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(value)
    : "--:--";

export const summaryMetricDefinitions: SummaryMetricDefinition[] = [
  {
    id: "grossRevenue",
    title: "Faturamento Bruto",
    icon: DollarSign,
    value: (summary) => formatCurrency(summary.grossRevenue),
    helper: (summary) => `${formatNumber(summary.ordersCount)} pedido(s)`,
  },
  {
    id: "netRevenue",
    title: "Líquido Estimado",
    icon: ReceiptText,
    value: (summary) => formatCurrency(summary.netRevenue),
    helper: () => "Após frete, comissão e impostos disponíveis",
  },
  {
    id: "productCost",
    title: "Custo do Produto",
    icon: Package,
    value: (summary) => formatCurrency(summary.productCost),
    helper: () => "Depende de custo nos itens",
  },
  {
    id: "contributionMargin",
    title: "Margem",
    icon: TrendingUp,
    value: (summary) => formatCurrency(summary.contributionMargin),
    helper: (summary) => formatPercentage(summary.contributionMarginPercentage),
  },
  {
    id: "contributionMarginPercentage",
    title: "Margem %",
    icon: Percent,
    value: (summary) => formatPercentage(summary.contributionMarginPercentage),
    helper: (summary) => formatCurrency(summary.contributionMargin),
  },
  {
    id: "ordersCount",
    title: "Pedidos",
    icon: Hash,
    value: (summary) => formatNumber(summary.ordersCount),
    helper: (summary) => `${formatNumber(summary.pendingCount)} pendente(s)`,
  },
  {
    id: "averageTicket",
    title: "Ticket Médio",
    icon: BarChart3,
    value: (summary) => formatCurrency(summary.averageTicket),
    helper: (summary) => `${formatNumber(summary.ordersCount)} pedido(s)`,
  },
  {
    id: "itemsQuantity",
    title: "Quantidade de Itens",
    icon: Package,
    value: (summary) => formatNumber(summary.itemsQuantity),
    helper: (summary) => `${formatNumber(summary.ordersCount)} pedido(s)`,
  },
  {
    id: "reconciledCount",
    title: "Conciliados",
    icon: CheckCircle2,
    value: (summary) => formatNumber(summary.reconciledCount),
    helper: (summary) => formatPercentage(summary.reconciledPercentage),
  },
  {
    id: "pendingCount",
    title: "Pendentes",
    icon: FileSearch,
    value: (summary) => formatNumber(summary.pendingCount),
    helper: (summary) => `${formatNumber(summary.reconciledCount)} conciliado(s)`,
  },
  {
    id: "reconciledPercentage",
    title: "Conciliação",
    icon: CheckCircle2,
    value: (summary) => formatPercentage(summary.reconciledPercentage),
    helper: (summary) => `${formatNumber(summary.reconciledCount)} de ${formatNumber(summary.ordersCount)} pedido(s)`,
  },
  {
    id: "financialAlertCount",
    title: "Alertas Financeiros",
    icon: AlertTriangle,
    value: (summary) => formatNumber(summary.financialAlertCount),
    helper: (summary) => formatPercentage(summary.financialAlertPercentage),
  },
  {
    id: "financialCriticalCount",
    title: "Críticos",
    icon: CircleAlert,
    value: (summary) => formatNumber(summary.financialCriticalCount),
    helper: (summary) => `${formatNumber(summary.financialAttentionCount)} em atenção`,
  },
  {
    id: "financialRiskAmount",
    title: "Risco Estimado",
    icon: DollarSign,
    value: (summary) => formatCurrency(summary.financialRiskAmount),
    helper: (summary) => `${formatNumber(summary.financialAlertCount)} pedido(s) com alerta`,
  },
];

export const summaryMetricDefinitionById = new Map(summaryMetricDefinitions.map((definition) => [definition.id, definition]));

export const formatDate = (dateString: string | undefined) => {
  if (!dateString || dateString.startsWith("0000")) return "N/A";

  try {
    return new Intl.DateTimeFormat("pt-BR").format(new Date(`${dateString}T00:00:00`));
  } catch {
    return dateString;
  }
};

export const formatDateTime = (dateString: string | null | undefined) => {
  if (!dateString) return "N/A";

  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(dateString));
  } catch {
    return dateString;
  }
};

export const formatActor = (actor: ConciliationRecord["updatedBy"]) => {
  if (!actor) return "N/A";

  return actor.name || actor.email || "Usuário";
};

export const isDateInRange = (dateString: string, dateRange: DateRange | undefined) => {
  if (!dateRange?.from || !dateRange?.to) return true;

  try {
    const orderDate = parseISO(dateString);

    return orderDate >= startOfDay(dateRange.from) && orderDate <= endOfDay(dateRange.to);
  } catch {
    return false;
  }
};

export const getPayoutComparisonScore = (status: ConciliationPayoutComparisonStatus) => {
  if (status === "divergent") return 2;
  if (status === "matched") return 1;

  return 0;
};

export const isConciliationSuggestionCandidate = (order: ConciliationOrder) =>
  !order.isReconciled &&
  order.systemStatus === "Entregue" &&
  order.financialDivergence.severity === "ok" &&
  order.payoutComparison.status === "matched";

export const getOrderRowMarkerClassName = (order: ConciliationOrder) => {
  if (order.financialDivergence.severity === "critical") {
    return "shadow-[inset_3px_0_0_#dc2626]";
  }

  if (order.financialDivergence.severity === "attention") {
    return "shadow-[inset_3px_0_0_#d97706]";
  }

  if (isConciliationSuggestionCandidate(order)) {
    return "shadow-[inset_3px_0_0_#059669]";
  }

  if (order.isReconciled) {
    return "shadow-[inset_3px_0_0_#0284c7]";
  }

  return "shadow-[inset_3px_0_0_#cbd5e1]";
};

export const getActiveFinancialAdjustments = (order: ConciliationOrder): ConciliationFinancialAdjustment[] =>
  financialAdjustmentFields
    .map((field) => order.financialAdjustments[field.id])
    .filter((adjustment): adjustment is ConciliationFinancialAdjustment => Boolean(adjustment?.active));

export const getFinancialAdjustmentSummary = (order: ConciliationOrder): string => {
  const activeAdjustments = getActiveFinancialAdjustments(order);

  if (activeAdjustments.length === 0) return "Sem ajustes manuais";

  return activeAdjustments
    .map((adjustment) => {
      const reason = adjustment.reason ? ` | ${adjustment.reason}` : "";

      return `${adjustment.label}: ${formatCurrency(adjustment.originalValue)} -> ${formatCurrency(adjustment.adjustedValue ?? 0)}${reason}`;
    })
    .join("\n");
};

export const FinancialAdjustmentsBadge = ({
  order,
  hideEmpty = false,
}: {
  order: ConciliationOrder;
  hideEmpty?: boolean;
}) => {
  const activeAdjustments = getActiveFinancialAdjustments(order);

  if (activeAdjustments.length === 0) {
    if (hideEmpty) return null;

    return (
      <Badge variant="outline" className="gap-1 whitespace-nowrap border-slate-200 bg-slate-50 text-slate-600">
        <Banknote className="h-3 w-3" />
        Sem ajustes
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="gap-1 whitespace-nowrap border-blue-200 bg-blue-50 text-blue-800"
      title={getFinancialAdjustmentSummary(order)}
    >
      <Banknote className="h-3 w-3" />
      {activeAdjustments.length === 1 ? activeAdjustments[0].label : `${formatNumber(activeAdjustments.length)} ajustes`}
    </Badge>
  );
};

export const getOrderCalculationValues = (order: ConciliationOrder) => Object.values(order.calculationValues || {});

export const formatCalculationValue = (value: number, isPercentage: boolean) =>
  isPercentage ? formatPercentage(value) : formatCurrency(value);

export const getCalculationSummary = (order: ConciliationOrder): string => {
  const values = getOrderCalculationValues(order);

  if (values.length === 0) return "Sem colunas calculadas";

  return values
    .map((value) => {
      const status = value.error ? ` | erro: ${value.error}` : "";

      return `${value.name}: ${formatCalculationValue(value.value, value.isPercentage)}${status}`;
    })
    .join("\n");
};

export const CalculatedColumnsBadge = ({ order }: { order: ConciliationOrder }) => {
  const values = getOrderCalculationValues(order);
  const errorCount = values.filter((value) => value.error).length;

  if (values.length === 0) {
    return (
      <Badge variant="outline" className="gap-1 whitespace-nowrap border-slate-200 bg-slate-50 text-slate-600">
        <Calculator className="h-3 w-3" />
        Sem cálculos
      </Badge>
    );
  }

  return (
    <Badge
      variant={errorCount > 0 ? "destructive" : "outline"}
      className={cn(
        "gap-1 whitespace-nowrap",
        errorCount === 0 && "border-violet-200 bg-violet-50 text-violet-800"
      )}
      title={getCalculationSummary(order)}
    >
      <Calculator className="h-3 w-3" />
      {errorCount > 0 ? `${formatNumber(errorCount)} erro(s)` : `${formatNumber(values.length)} cálculo(s)`}
    </Badge>
  );
};

export const getSortValue = (order: ConciliationOrder, columnId: ConciliationColumnId): string | number => {
  const calculationId = getCalculationIdFromColumnId(columnId);

  if (calculationId) {
    const calculation = order.calculationValues?.[calculationId];

    return calculation && !calculation.error ? calculation.value : 0;
  }

  const sheetKey = getSheetKeyFromColumnId(columnId);

  if (sheetKey !== null) {
    const value = order.sheetFields?.[sheetKey];

    return typeof value === "number" ? value : String(value ?? "");
  }

  switch (columnId) {
    case "conciliation":
      return order.isReconciled ? 1 : 0;
    case "suggestion":
      return isConciliationSuggestionCandidate(order) ? 1 : 0;
    case "financialAlert":
      return getConciliationFinancialDivergenceScore(order.financialDivergence.severity);
    case "adjustments":
      return getActiveFinancialAdjustments(order).length;
    case "calculatedColumns":
      return getOrderCalculationValues(order).reduce((total, value) => total + (value.error ? 0 : value.value), 0);
    case "payout":
      return getPayoutComparisonScore(order.payoutComparison.status);
    case "items":
      return order.items.length;
    case "order":
      return order.number || order.orderId;
    case "date":
      return order.date ? new Date(`${order.date}T00:00:00`).getTime() : 0;
    case "customer":
      return order.customerName;
    case "account":
      return order.accountName;
    case "marketplace":
      return order.marketplace;
    case "product":
      return order.items[0]?.description || "";
    case "quantity":
      return order.totalQuantity;
    case "status":
      return order.statusName;
    case "systemStatus":
      return order.systemStatus;
    case "grossRevenue":
      return order.grossRevenue;
    case "netRevenue":
      return order.netRevenue;
    case "taxes":
      return order.taxes;
    case "productCost":
      return order.productCost;
    case "margin":
      return order.contributionMargin;
    case "marginPercentage":
      return order.contributionMarginPercentage;
  }

  return "";
};

export const getStatusVariant = (statusName: string): "default" | "secondary" | "destructive" | "outline" => {
  const normalized = statusName
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  if (normalized.includes("cancelado")) return "destructive";
  if (normalized.includes("entregue") || normalized.includes("concluido") || normalized.includes("atendido")) return "default";
  if (normalized.includes("enviado") || normalized.includes("transito")) return "outline";

  return "secondary";
};

export const getSystemStatusVariant = (
  status: ConciliationSystemStatus
): "default" | "secondary" | "destructive" | "outline" => {
  if (status === "Cancelado" || status === "Devolução" || status === "Devolução / Reembolso Parcial") {
    return "destructive";
  }
  if (status === "Entregue") return "default";
  if (status === "Em Trânsito" || status === "Extravio") return "outline";

  return "secondary";
};

export const getSystemStatusControlClassName = (status: ConciliationSystemStatus) => {
  if (status === "Cancelado" || status === "Devolução" || status === "Devolução / Reembolso Parcial") {
    return "border-red-200 bg-red-50 text-red-800";
  }

  if (status === "Entregue") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "Em Trânsito" || status === "Extravio") {
    return "border-blue-200 bg-blue-50 text-blue-800";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
};

export const SystemStatusBadge = ({
  status,
  systemStatusSettings,
  className,
  showInactiveLabel = true,
}: {
  status: ConciliationSystemStatus;
  systemStatusSettings?: ConciliationSystemStatusSettings;
  className?: string;
  showInactiveLabel?: boolean;
}) => {
  const presentation = getConciliationSystemStatusPresentation(systemStatusSettings, status);

  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 whitespace-nowrap border", className)}
      style={presentation.style}
      title={presentation.displayName !== status ? `Valor operacional: ${status}` : undefined}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: presentation.active ? presentation.color : "#a1a1aa" }}
      />
      {presentation.displayName}
      {!presentation.active && showInactiveLabel ? (
        <span className="ml-0.5 text-[10px] font-semibold opacity-75">Inativo</span>
      ) : null}
    </Badge>
  );
};

export const InlineSystemStatusSelect = ({
  order,
  isSaving,
  onSave,
  systemStatusSettings,
}: {
  order: ConciliationOrder;
  isSaving: boolean;
  onSave: (order: ConciliationOrder, manualSystemStatus: ConciliationSystemStatus | null) => void;
  systemStatusSettings?: ConciliationSystemStatusSettings;
}) => (
  <div
    className="min-w-[180px]"
    data-stop-row-click="true"
    onClick={(event) => event.stopPropagation()}
  >
    <Select
      value={order.manualSystemStatus ?? automaticStatusSelectValue}
      disabled={isSaving}
      onValueChange={(value) =>
        onSave(order, value === automaticStatusSelectValue ? null : (value as ConciliationSystemStatus))
      }
    >
      <SelectTrigger
        className={cn(
          "h-8 min-w-[180px] rounded-md border px-2 text-xs font-medium shadow-none focus:ring-[#4169E1]",
          getSystemStatusControlClassName(order.systemStatus)
        )}
        style={getConciliationSystemStatusPresentation(systemStatusSettings, order.systemStatus).style}
        title={
          order.manualSystemStatus
            ? `Status manual. Automático: ${order.automaticSystemStatus}`
            : `Status automático: ${order.automaticSystemStatus}`
        }
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{
              backgroundColor: getConciliationSystemStatusPresentation(systemStatusSettings, order.systemStatus).color,
            }}
          />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={automaticStatusSelectValue}>
          Automático ({getConciliationSystemStatusDisplayName(systemStatusSettings, order.automaticSystemStatus)})
        </SelectItem>
        {conciliationSystemStatusOptions.map((statusOption) => {
          const definition = getConciliationSystemStatusDefinition(systemStatusSettings, statusOption);

          return (
            <SelectItem key={statusOption} value={statusOption}>
              {definition.displayName}
              {!definition.active ? " (inativo)" : ""}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  </div>
);

export const getFinancialDivergenceBadgeClass = (severity: ConciliationFinancialDivergenceSeverity) => {
  if (severity === "critical") return "border-transparent";
  if (severity === "attention") return "border-amber-200 bg-amber-50 text-amber-800";

  return "border-emerald-200 bg-emerald-50 text-emerald-800";
};

export const getFinancialDivergenceVariant = (
  severity: ConciliationFinancialDivergenceSeverity
): "default" | "secondary" | "destructive" | "outline" => {
  if (severity === "critical") return "destructive";

  return "outline";
};

export const FinancialDivergenceBadge = ({
  divergence,
  compact = false,
}: {
  divergence: ConciliationFinancialDivergence;
  compact?: boolean;
}) => {
  const Icon = divergence.severity === "ok" ? CheckCircle2 : AlertTriangle;
  const alertCount = divergence.criticalCount + divergence.attentionCount;
  const label = compact && divergence.severity !== "ok" ? `${divergence.label} (${alertCount})` : divergence.label;

  return (
    <Badge
      variant={getFinancialDivergenceVariant(divergence.severity)}
      className={cn("gap-1 whitespace-nowrap", getFinancialDivergenceBadgeClass(divergence.severity))}
    >
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
};

export const getPayoutComparisonBadgeClass = (status: ConciliationPayoutComparisonStatus) => {
  if (status === "matched") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "divergent") return "border-transparent";

  return "border-slate-200 bg-slate-50 text-slate-700";
};

export const getPayoutComparisonVariant = (
  status: ConciliationPayoutComparisonStatus
): "default" | "secondary" | "destructive" | "outline" => {
  if (status === "divergent") return "destructive";

  return "outline";
};

export const PayoutComparisonBadge = ({
  order,
  compact = false,
}: {
  order: ConciliationOrder;
  compact?: boolean;
}) => {
  const comparison = order.payoutComparison;
  const Icon = comparison.status === "matched" ? CheckCircle2 : comparison.status === "divergent" ? AlertTriangle : Wallet;
  const label =
    compact && comparison.status === "divergent"
      ? `${comparison.label} ${formatCurrency(comparison.differenceAmount)}`
      : comparison.label;

  return (
    <Badge
      variant={getPayoutComparisonVariant(comparison.status)}
      className={cn("gap-1 whitespace-nowrap", getPayoutComparisonBadgeClass(comparison.status))}
    >
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
};

export const ConciliationSuggestionBadge = ({ order }: { order: ConciliationOrder }) => {
  if (isConciliationSuggestionCandidate(order)) {
    return (
      <Badge className="gap-1 whitespace-nowrap">
        <CheckCircle2 className="h-3 w-3" />
        Pronto para conciliar
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="whitespace-nowrap">
      Revisar
    </Badge>
  );
};

export const FinancialDivergenceReasons = ({ divergence }: { divergence: ConciliationFinancialDivergence }) => {
  if (divergence.reasons.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        Nenhuma divergência financeira encontrada pelas regras atuais.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {divergence.reasons.map((reason) => (
        <div
          key={reason.id}
          className={cn(
            "rounded-lg border p-3",
            reason.severity === "critical" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
          )}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-medium">{reason.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{reason.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge
                variant={reason.severity === "critical" ? "destructive" : "outline"}
                className={cn(
                  reason.severity === "attention" && "border-amber-200 bg-amber-100 text-amber-800"
                )}
              >
                {reason.severity === "critical" ? "Crítico" : "Atenção"}
              </Badge>
              {reason.amount !== null ? (
                <span className="text-sm font-semibold">{formatCurrency(reason.amount)}</span>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export const SummaryCard = ({
  title,
  value,
  icon: Icon,
  isLoading,
  helper,
}: {
  title: string;
  value: string;
  icon: React.ElementType;
  isLoading: boolean;
  helper?: string;
}) => (
  <Card className={referencePanelClassName}>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      <Icon className="h-4 w-4 text-muted-foreground" />
    </CardHeader>
    <CardContent>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3 w-36" />
        </div>
      ) : (
        <>
          <div className="text-2xl font-bold tracking-tight">{value}</div>
          {helper ? <p className="mt-1 text-xs text-muted-foreground">{helper}</p> : null}
        </>
      )}
    </CardContent>
  </Card>
);

export const PeriodSummaryMetricCard = ({
  title,
  value,
  tone,
  isLoading,
}: {
  title: string;
  value: string;
  tone: "blue" | "red" | "green" | "cyan";
  isLoading: boolean;
}) => {
  const toneClassName = {
    blue: "border-blue-600/20",
    red: "border-red-600/20",
    green: "border-green-600/20",
    cyan: "border-cyan-600/20",
  }[tone];

  return (
    <div className={cn("min-h-[150px] rounded-xl border bg-white p-6 shadow-sm transition-shadow hover:shadow-md", toneClassName)}>
      <p className="mb-1 text-sm text-slate-400">{title}</p>
      {isLoading ? <Skeleton className="mt-4 h-8 w-32" /> : <p className="text-2xl font-semibold tracking-tight text-slate-950">{value}</p>}
    </div>
  );
};

export const QueryLoadingNotice = () => (
  <div className="flex flex-col gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm shadow-sm sm:flex-row sm:items-center">
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-blue-600 shadow-sm">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
    <div>
      <p className="font-semibold text-slate-950">Carregando vendas</p>
      <p className="mt-0.5 text-xs text-slate-500">Preparando consulta...</p>
    </div>
  </div>
);

export const ConciliationLoadingState = () => (
  <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center">
    <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
    <p className="mt-3 text-sm font-semibold text-slate-950">Carregando conciliação...</p>
    <p className="mt-1 max-w-sm text-xs text-slate-500">
      Conferindo pedidos, marcações e repasses do período.
    </p>
  </div>
);

export const ConciliationTableLoadingState = ({
  columnCount,
  density,
}: {
  columnCount: number;
  density: TableDensity;
}) => {
  const rowCount = density === "compact" ? 8 : 6;
  const rowHeightClassName = density === "compact" ? "h-4" : "h-5";

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
        <div>
          <p className="text-sm font-semibold text-slate-950">Montando tabela de conferência</p>
          <p className="text-xs text-slate-500">Carregando pedidos, colunas, marcações e totais financeiros.</p>
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: rowCount }).map((_, rowIndex) => (
          <div key={rowIndex} className="grid items-center gap-3" style={{ gridTemplateColumns: `40px repeat(${Math.min(columnCount, 8)}, minmax(80px, 1fr)) 96px` }}>
            <Skeleton className={cn(rowHeightClassName, "w-4 rounded")} />
            {Array.from({ length: Math.min(columnCount, 8) }).map((__, columnIndex) => (
              <Skeleton
                key={`${rowIndex}:${columnIndex}`}
                className={cn(
                  rowHeightClassName,
                  columnIndex === 0 ? "w-24" : columnIndex % 3 === 0 ? "w-32" : "w-full"
                )}
              />
            ))}
            <Skeleton className={cn(rowHeightClassName, "w-20 justify-self-end")} />
          </div>
        ))}
      </div>
    </div>
  );
};

export const ConciliationEmptyState = ({
  hasAppliedFilters,
  searchTerm,
}: {
  hasAppliedFilters: boolean;
  searchTerm: string;
}) => {
  const normalizedSearch = searchTerm.trim();
  const Icon = hasAppliedFilters ? ReceiptText : FileSearch;
  const title = !hasAppliedFilters
    ? "Aplique filtros para consultar vendas"
    : normalizedSearch
      ? `Nenhum resultado para "${normalizedSearch}"`
      : "Nenhuma venda encontrada";
  const description = !hasAppliedFilters
    ? "Escolha o período e clique em Aplicar filtros para montar a grade de conciliação."
    : normalizedSearch
      ? "A busca global não encontrou pedidos com esse termo. Tente número do pedido, SKU, cliente, marketplace ou status."
      : "Não há pedidos para os filtros aplicados. Ajuste período, marketplace, conta ou status e aplique novamente.";

  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-950">{title}</p>
      <p className="mt-1 max-w-md text-xs text-slate-500">{description}</p>
    </div>
  );
};

export const FinancialAlertsSummary = ({
  summary,
  isLoading,
}: {
  summary: ConciliationSummary;
  isLoading: boolean;
}) => {
  const items = [
    {
      label: "Pedidos com alerta",
      value: formatNumber(summary.financialAlertCount),
      helper: formatPercentage(summary.financialAlertPercentage),
    },
    {
      label: "Críticos",
      value: formatNumber(summary.financialCriticalCount),
      helper: "Prioridade de conferência",
    },
    {
      label: "Em atenção",
      value: formatNumber(summary.financialAttentionCount),
      helper: "Revisão recomendada",
    },
    {
      label: "Risco estimado",
      value: formatCurrency(summary.financialRiskAmount),
      helper: "Soma dos impactos mapeados",
    },
  ];

  return (
    <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</p>
          {isLoading ? (
            <div className="mt-2 space-y-2">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          ) : (
            <>
              <p className="mt-1 text-xl font-semibold tracking-tight">{item.value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.helper}</p>
            </>
          )}
        </div>
      ))}
    </div>
  );
};

export const PayoutSummary = ({
  summary,
  isLoading,
}: {
  summary: ConciliationSummary;
  isLoading: boolean;
}) => {
  const items = [
    {
      label: "Repasse OK",
      value: formatNumber(summary.payoutMatchedCount),
      helper: "Valor líquido dentro da tolerância",
    },
    {
      label: "Divergentes",
      value: formatNumber(summary.payoutDivergentCount),
      helper: "Diferença acima da tolerância",
    },
    {
      label: "Sem repasse",
      value: formatNumber(summary.payoutMissingCount),
      helper: "Pedido ainda sem linha importada",
    },
    {
      label: "Líquido repassado",
      value: formatCurrency(summary.payoutNetAmount),
      helper: `Diferença absoluta ${formatCurrency(summary.payoutDifferenceAmount)}`,
    },
  ];

  return (
    <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</p>
          {isLoading ? (
            <div className="mt-2 space-y-2">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          ) : (
            <>
              <p className="mt-1 text-xl font-semibold tracking-tight">{item.value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.helper}</p>
            </>
          )}
        </div>
      ))}
    </div>
  );
};

export const SuggestedReconciliationSummary = ({
  count,
  netAmount,
  isLoading,
  isSaving,
  onReconcile,
}: {
  count: number;
  netAmount: number;
  isLoading: boolean;
  isSaving: boolean;
  onReconcile: () => void;
}) => {
  const exceedsBatchLimit = count > 450;

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-emerald-50/60 p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-800">Prontos para conciliar</p>
          {isLoading ? (
            <Skeleton className="mt-2 h-6 w-20" />
          ) : (
            <p className="mt-1 text-xl font-semibold tracking-tight">{formatNumber(count)}</p>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-800">Líquido no escopo</p>
          {isLoading ? (
            <Skeleton className="mt-2 h-6 w-28" />
          ) : (
            <p className="mt-1 text-xl font-semibold tracking-tight">{formatCurrency(netAmount)}</p>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-800">Regra</p>
          <p className="mt-1 text-sm text-emerald-900">Entregue, sem alerta e repasse OK</p>
        </div>
      </div>

      <Button
        type="button"
        className="w-full lg:w-auto"
        onClick={onReconcile}
        disabled={isLoading || isSaving || count === 0 || exceedsBatchLimit}
      >
        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-2 h-4 w-4" />}
        Conciliar sugeridos
      </Button>
    </div>
  );
};

export const ColumnVisibilityPopover = ({
  columnOptions,
  visibleColumnIds,
  visibleCount,
  onToggleColumn,
  onShowAll,
  onHideAll,
  onReset,
  isLoading,
}: {
  columnOptions: ConciliationColumnOption[];
  visibleColumnIds: Set<ConciliationColumnId>;
  visibleCount: number;
  onToggleColumn: (columnId: ConciliationColumnId, checked: boolean) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onReset: () => void;
  isLoading: boolean;
}) => {
  const [search, setSearch] = React.useState("");
  const groupEntries = React.useMemo<Array<[string, ConciliationColumnOption[]]>>(() => {
    const needle = search.trim().toLocaleLowerCase("pt-BR");
    const filteredColumns = needle
      ? columnOptions.filter((column) => column.label.toLocaleLowerCase("pt-BR").includes(needle))
      : columnOptions;
    const groups: Record<string, ConciliationColumnOption[]> = {};

    filteredColumns.forEach((column) => {
      const groupName = column.group || "Geral";
      groups[groupName] = groups[groupName] || [];
      groups[groupName].push(column);
    });

    return Object.entries(groups);
  }, [columnOptions, search]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={isLoading} className={referenceToolbarButtonClassName}>
          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Columns3 className="mr-2 h-4 w-4" />}
          Exibir Colunas
          <span className="text-xs text-slate-500">
            ({visibleCount}/{columnOptions.length})
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="border-b border-slate-200 p-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 pl-9"
              placeholder="Buscar coluna..."
            />
          </div>
          <div className="mt-2 flex gap-1">
            <Button type="button" variant="outline" size="sm" className="flex-1 text-xs" onClick={onShowAll}>
              Mostrar todas
            </Button>
            <Button type="button" variant="outline" size="sm" className="flex-1 text-xs" onClick={onHideAll}>
              Ocultar todas
            </Button>
          </div>
          <div className="mt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full gap-2 text-xs"
              onClick={onReset}
              title="Reverter para a configuração padrão das colunas"
            >
              <RotateCcw className="h-3 w-3" />
              Resetar colunas
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-tight text-slate-500">
            Dica: mantenha apenas as colunas necessárias para conferir pedidos com mais agilidade.
          </p>
        </div>

        <ScrollArea className="h-72">
          <div className="p-2">
            {groupEntries.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-slate-500">Nenhuma coluna encontrada.</p>
            ) : (
              groupEntries.map(([groupName, columns]) => (
                <div key={groupName} className="mb-2">
                  <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {groupName}
                  </p>
                  <div className="flex flex-col">
                    {columns.map((column) => {
                      const checked = visibleColumnIds.has(column.id);

                      return (
                        <div
                          key={column.id}
                          role="button"
                          tabIndex={0}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-slate-100"
                          onClick={() => onToggleColumn(column.id, !checked)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onToggleColumn(column.id, !checked);
                            }
                          }}
                        >
                          <Checkbox
                            checked={checked}
                            onClick={(event) => event.stopPropagation()}
                            onCheckedChange={(value) => onToggleColumn(column.id, value === true)}
                          />
                          <span className="min-w-0 flex-1 truncate" title={column.description}>
                            {column.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};

export const DetailItem = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="min-w-0">
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
    <div className="mt-1 break-words text-sm text-foreground">
      {value === null || value === undefined || value === "" ? "N/A" : value}
    </div>
  </div>
);

export const DetailCard = ({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base">
        <Icon className="h-5 w-5 text-muted-foreground" />
        {title}
      </CardTitle>
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);

export const EmptyDetailState = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
    {children}
  </div>
);

export const getAuditEventIcon = (type: ConciliationAuditEvent["type"]) => {
  if (type === "reconciled") return CheckCircle2;
  if (type === "unreconciled") return Undo2;
  if (type === "financial-adjustment-updated") return Banknote;

  return SlidersHorizontal;
};

export const getAuditEventBadge = (type: ConciliationAuditEvent["type"]) => {
  if (type === "reconciled") return <Badge>Conciliação</Badge>;
  if (type === "unreconciled") return <Badge variant="outline">Desfeito</Badge>;
  if (type === "financial-adjustment-updated") return <Badge variant="outline">Ajuste financeiro</Badge>;

  return <Badge variant="secondary">Status</Badge>;
};

export const auditDetailLabels: Record<string, string> = {
  previousSystemStatus: "Status anterior",
  systemStatus: "Status aplicado",
  manualSystemStatus: "Status manual",
  automaticSystemStatus: "Status automático",
  reconciled: "Conciliado",
  orderNumber: "Pedido",
  activeAdjustments: "Ajustes ativos",
  fields: "Campos",
};

export const formatAuditDetailValue = (value: string | number | boolean | null) => {
  if (value === null || value === "") return "N/A";
  if (typeof value === "boolean") return value ? "Sim" : "Não";

  return String(value);
};

export const buildConciliationAuditEvents = (order: ConciliationOrder): ConciliationAuditEvent[] => {
  const history = order.conciliation?.history || [];
  const events = [...history];
  const hasEvent = (type: ConciliationAuditEvent["type"], at: string | null | undefined) =>
    Boolean(at && events.some((event) => event.type === type && event.at === at));

  if (order.conciliation?.reconciledAt && !hasEvent("reconciled", order.conciliation.reconciledAt)) {
    events.push({
      id: `legacy-reconciled-${order.conciliation.reconciledAt}`,
      type: "reconciled",
      title: "Pedido conciliado",
      description: "Evento reconstruído a partir dos dados atuais da conciliação.",
      at: order.conciliation.reconciledAt,
      actor: order.conciliation.reconciledBy,
      details: {
        reconciled: true,
        systemStatus: order.conciliation.systemStatus,
        orderNumber: order.number || order.orderId,
      },
    });
  }

  if (order.conciliation?.unreconciledAt && !hasEvent("unreconciled", order.conciliation.unreconciledAt)) {
    events.push({
      id: `legacy-unreconciled-${order.conciliation.unreconciledAt}`,
      type: "unreconciled",
      title: "Conciliação desfeita",
      description: "Evento reconstruído a partir dos dados atuais da conciliação.",
      at: order.conciliation.unreconciledAt,
      actor: order.conciliation.unreconciledBy,
      details: {
        reconciled: false,
        systemStatus: order.conciliation.systemStatus,
        orderNumber: order.number || order.orderId,
      },
    });
  }

  if (
    order.conciliation?.systemStatusUpdatedAt &&
    !hasEvent("system-status-updated", order.conciliation.systemStatusUpdatedAt)
  ) {
    events.push({
      id: `legacy-status-${order.conciliation.systemStatusUpdatedAt}`,
      type: "system-status-updated",
      title: "Status de sistema alterado",
      description: "Evento reconstruído a partir dos dados atuais do status do sistema.",
      at: order.conciliation.systemStatusUpdatedAt,
      actor: order.conciliation.systemStatusUpdatedBy,
      details: {
        systemStatus: order.conciliation.systemStatus,
        manualSystemStatus: order.conciliation.manualSystemStatus,
        automaticSystemStatus: order.conciliation.automaticSystemStatus,
      },
    });
  }

  return events.sort((first, second) => new Date(second.at).getTime() - new Date(first.at).getTime());
};

export const AuditTimeline = ({ events }: { events: ConciliationAuditEvent[] }) => {
  if (events.length === 0) {
    return <EmptyDetailState>Nenhuma ação de conciliação registrada para este pedido.</EmptyDetailState>;
  }

  return (
    <div className="space-y-3">
      {events.map((event) => {
        const Icon = getAuditEventIcon(event.type);
        const details = Object.entries(event.details || {}).filter(([, value]) => value !== undefined);

        return (
          <div key={event.id} className="relative pl-8">
            <span className="absolute left-0 top-3 flex h-6 w-6 items-center justify-center rounded-full border bg-background">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <div className="rounded-lg border bg-background p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{event.title}</p>
                    {getAuditEventBadge(event.type)}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{event.description}</p>
                </div>
                <div className="text-left text-xs text-muted-foreground sm:text-right">
                  <p>{formatDateTime(event.at)}</p>
                  <p>{formatActor(event.actor)}</p>
                </div>
              </div>

              {details.length > 0 ? (
                <>
                  <Separator className="my-3" />
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {details.map(([key, value]) => (
                      <DetailItem
                        key={key}
                        label={auditDetailLabels[key] || key}
                        value={formatAuditDetailValue(value)}
                      />
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const SortableHeader = ({
  columnId,
  label,
  align = "left",
  sortConfig,
  sortFeedback,
  onSort,
}: {
  columnId: ConciliationColumnId;
  label: string;
  align?: "left" | "center" | "right";
  sortConfig: SortConfig;
  sortFeedback?: SortFeedback | null;
  onSort: (columnId: ConciliationColumnId) => void;
}) => {
  const active = sortConfig.columnId === columnId;
  const isSorting = sortFeedback?.columnId === columnId;
  const Icon = active ? (sortConfig.direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  const nextDirectionLabel = active && sortConfig.direction === "asc" ? "decrescente" : "crescente";

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "group h-8 px-2 font-medium text-slate-500 transition-colors hover:bg-zinc-100/70 hover:text-zinc-900",
        active && "text-zinc-900",
        align === "right" && "ml-auto",
        align === "center" && "mx-auto"
      )}
      aria-label={`Ordenar ${label} em ordem ${nextDirectionLabel}`}
      aria-pressed={active}
      onClick={() => onSort(columnId)}
    >
      <span>{label}</span>
      {isSorting ? (
        <Loader2 className="ml-1.5 h-3.5 w-3.5 animate-spin text-purple-500" aria-label="Ordenando coluna" />
      ) : (
        <Icon
          className={cn(
            "ml-1.5 h-3.5 w-3.5 transition-colors",
            active ? "text-purple-500" : "text-purple-400 group-hover:text-purple-500"
          )}
        />
      )}
    </Button>
  );
};

export const OrderCard = ({
  order,
  selected,
  isSaving,
  systemStatusSettings,
  onSelect,
  onOpen,
  onToggleReconciled,
}: {
  order: ConciliationOrder;
  selected: boolean;
  isSaving: boolean;
  systemStatusSettings?: ConciliationSystemStatusSettings;
  onSelect: (checked: boolean) => void;
  onOpen: () => void;
  onToggleReconciled: () => void;
}) => {
  const mainItem = order.items[0];
  const orderIdentifier = order.number || order.orderId;

  return (
    <div
      className={cn(
        "relative flex min-h-[168px] gap-3 rounded-lg border bg-white p-4 shadow-sm transition-colors hover:bg-zinc-50/80",
        order.isReconciled && "border-emerald-200 bg-emerald-50/40",
        selected && "border-primary/40 ring-2 ring-primary/15"
      )}
      onClick={(event) => {
        const target = event.target as HTMLElement;

        if (target.closest("button, input, [data-stop-row-click]")) return;

        onOpen();
      }}
    >
      <div
        className="absolute left-3 top-3 z-10 flex items-center gap-1.5"
        data-stop-row-click="true"
        onClick={(event) => event.stopPropagation()}
      >
        <Checkbox
          aria-label={`Selecionar pedido ${orderIdentifier}`}
          checked={selected}
          onCheckedChange={(checked) => onSelect(checked === true)}
          disabled={isSaving}
        />
        {order.isReconciled ? (
          <span
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-sky-600 shadow-sm"
            aria-label="Pedido conciliado"
            title="Pedido conciliado"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>

      <div className="ml-10 flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-100">
        <Package className="h-8 w-8 text-zinc-300" />
      </div>

      <div className="min-w-0 flex-1">
        <button type="button" className="block max-w-full text-left" onClick={onOpen} data-stop-row-click="true">
          <h3 className="truncate text-sm font-semibold text-zinc-950">
            {mainItem?.description || "Pedido sem itens registrados"}
          </h3>
          <p className="mt-1 truncate text-xs text-zinc-400">
            Pedido: <span className="font-medium text-zinc-600">#{orderIdentifier}</span>
            {order.items.length > 1 ? (
              <span className="ml-2 text-zinc-500">{formatNumber(order.items.length)} produtos</span>
            ) : null}
          </p>
        </button>

        <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          <div className="flex min-w-0 gap-1">
            <span className="text-zinc-400">Conta:</span>
            <span className="truncate text-zinc-700">{order.accountName || "-"}</span>
          </div>
          <div className="flex min-w-0 gap-1">
            <span className="text-zinc-400">Canal:</span>
            <span className="truncate text-zinc-700">{order.marketplace || "-"}</span>
          </div>
          <div className="flex min-w-0 gap-1">
            <span className="text-zinc-400">Cliente:</span>
            <span className="truncate text-zinc-700">{order.customerName || "-"}</span>
          </div>
          <div className="flex min-w-0 gap-1">
            <span className="text-zinc-400">Data:</span>
            <span className="truncate text-zinc-700">{formatDate(order.date)}</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge variant={getStatusVariant(order.statusName)} className="whitespace-nowrap">
            {order.statusName}
          </Badge>
          <SystemStatusBadge status={order.systemStatus} systemStatusSettings={systemStatusSettings} />
          <FinancialAdjustmentsBadge order={order} hideEmpty />
          <FinancialDivergenceBadge divergence={order.financialDivergence} compact />
          <PayoutComparisonBadge order={order} compact />
          <ConciliationSuggestionBadge order={order} />
        </div>
      </div>

      <div className="flex w-44 shrink-0 flex-col items-end justify-between gap-3" data-stop-row-click="true">
        <div className="grid w-full gap-1 text-right text-xs">
          <div>
            <p className="text-zinc-400">Bruto</p>
            <p className="font-semibold tabular-nums text-zinc-950">{formatCurrency(order.grossRevenue)}</p>
          </div>
          <div>
            <p className="text-zinc-400">Líquido</p>
            <p className="font-semibold tabular-nums text-zinc-950">{formatCurrency(order.netRevenue)}</p>
          </div>
          <div>
            <p className="text-zinc-400">Margem</p>
            <p className="font-semibold tabular-nums text-zinc-950">{formatCurrency(order.contributionMargin)}</p>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2">
          <Button type="button" variant="outline" size="sm" className="h-8 w-full" onClick={onOpen}>
            Detalhes
          </Button>
          <Button
            type="button"
            size="sm"
            variant={order.isReconciled ? "outline" : "default"}
            className="h-8 w-full"
            onClick={onToggleReconciled}
            disabled={isSaving}
          >
            {order.isReconciled ? (
              <>
                <Undo2 className="mr-2 h-4 w-4" />
                Desfazer
              </>
            ) : (
              <>
                <CheckCheck className="mr-2 h-4 w-4" />
                Conciliar
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
