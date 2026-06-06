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
  ConciliationSummary,
} from "@/types/conciliation";

type SystemStatusFilter = "Todos" | ConciliationSystemStatus;

type AppliedFilters = {
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

type ReconciliationStatusFilter = "Todos" | "Pendentes" | "Conciliados";
type FinancialAlertFilter = "Todos" | "Com alerta" | "Críticos" | "Atenção" | "Sem alerta";
type AdjustmentStatusFilter = "Todos" | "Com ajustes" | "Sem ajustes";
type PayoutStatusFilter = "Todos" | "Sem repasse" | "Repasse OK" | "Divergente";
type SuggestionFilter = "Todos" | "Sugeridos" | "Revisar";
type SortDirection = "asc" | "desc";

type SortConfig = {
  columnId: ConciliationColumnId;
  direction: SortDirection;
};

type SortFeedback = {
  columnId: ConciliationColumnId;
  columnLabel: string;
  totalRows: number;
};

type ColumnMoveFeedback = {
  columnId: ConciliationColumnId;
  columnLabel: string;
  detail: string;
};

type ViewMode = "table" | "cards";
type TableDensity = "compact" | "comfortable";

type SummaryMetricDefinition = {
  id: ConciliationSummaryMetricId;
  title: string;
  icon: React.ElementType;
  value: (summary: ConciliationSummary) => string;
  helper?: (summary: ConciliationSummary) => string;
};

const reconciliationStatusOptions: ReconciliationStatusFilter[] = ["Todos", "Pendentes", "Conciliados"];
const financialAlertOptions: FinancialAlertFilter[] = ["Todos", "Com alerta", "Críticos", "Atenção", "Sem alerta"];
const adjustmentStatusOptions: AdjustmentStatusFilter[] = ["Todos", "Com ajustes", "Sem ajustes"];
const payoutStatusOptions: PayoutStatusFilter[] = ["Todos", "Sem repasse", "Repasse OK", "Divergente"];
const suggestionOptions: SuggestionFilter[] = ["Todos", "Sugeridos", "Revisar"];

const conciliationColumnOptions = [
  { id: "conciliation", label: "Conciliação", group: "Sistema" },
  { id: "items", label: "Itens", group: "Pedido" },
  { id: "order", label: "Pedido", group: "Pedido" },
  { id: "date", label: "Data", group: "Pedido" },
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

type StaticConciliationColumnId = (typeof conciliationColumnOptions)[number]["id"];
const calculationColumnPrefix = "calculation:" as const;
type ConciliationCalculationColumnId = `${typeof calculationColumnPrefix}${string}`;
type ConciliationColumnId = StaticConciliationColumnId | ConciliationCalculationColumnId;
type ConciliationColumnOption = {
  id: ConciliationColumnId;
  label: string;
  group: string;
  description?: string;
  calculationId?: string;
  isDynamic?: boolean;
};

const allConciliationColumnIds = conciliationColumnOptions.map(
  (column) => column.id
) as StaticConciliationColumnId[];
const allConciliationColumnIdSet = new Set<StaticConciliationColumnId>(allConciliationColumnIds);
const defaultColumnOrderIds: ConciliationColumnId[] = [...allConciliationColumnIds];
const defaultVisibleColumnIds: ConciliationColumnId[] = [
  "conciliation",
  "items",
  "order",
  "date",
  "account",
  "marketplace",
  "product",
  "quantity",
  "status",
  "grossRevenue",
  "netRevenue",
  "taxes",
  "margin",
  "marginPercentage",
  "adjustments",
  "calculatedColumns",
];
const visibleColumnsStorageKey = "brsteel.conciliacao.visibleColumns.v9";
const columnOrderStorageKey = "brsteel.conciliacao.columnOrder.v2";
const knownCalculationColumnsStorageKey = "brsteel.conciliacao.knownCalculationColumns.v1";
const viewModeStorageKey = "brsteel.conciliacao.viewMode.v1";
const tableDensityStorageKey = "brsteel.conciliacao.tableDensity.v1";
const referencePanelClassName = "rounded-xl border-slate-200 bg-white shadow-sm transition-all duration-200 hover:shadow-md";
const referenceOutlineButtonClassName =
  "h-10 whitespace-nowrap rounded-md border-slate-200 bg-transparent px-4 text-sm font-medium text-slate-950 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-950 active:scale-[0.98]";
const referenceCompactButtonClassName =
  "h-8 whitespace-nowrap rounded-md border-slate-200 bg-transparent px-3 text-xs font-medium text-slate-950 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-950 active:scale-[0.98]";
const referenceToolbarButtonClassName =
  "h-9 whitespace-nowrap rounded-md border-slate-200 bg-transparent px-3 text-sm font-medium text-slate-950 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-950 active:scale-[0.98]";
const referenceDateButtonClassName =
  "h-10 rounded-lg border-zinc-300 bg-white px-4 text-sm font-normal text-slate-950 shadow-none transition-colors hover:border-[#4169E1] hover:bg-white hover:text-slate-950 focus:ring-[#4169E1]";
const referenceControlClassName =
  "h-9 rounded-md border-slate-300 bg-white text-sm text-slate-950 shadow-sm focus:ring-[#4169E1]";
const referencePrimaryButtonClassName =
  "h-10 min-w-[110px] rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-all duration-200 hover:bg-primary/90 active:scale-[0.98]";

const rowsPerPageOptions = [20, 50, 100];
const tableDensityOptions: Array<{ id: TableDensity; label: string }> = [
  { id: "compact", label: "Compacta" },
  { id: "comfortable", label: "Conforto" },
];
const automaticStatusSelectValue = "__auto__";
const defaultDivergenceRuleScopeValue = "__default__";
const financialAdjustmentFields: Array<{
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

const toCalculationColumnId = (calculationId: string): ConciliationCalculationColumnId =>
  `${calculationColumnPrefix}${calculationId}`;

const getCalculationIdFromColumnId = (columnId: ConciliationColumnId): string | null =>
  typeof columnId === "string" && columnId.startsWith(calculationColumnPrefix)
    ? columnId.slice(calculationColumnPrefix.length)
    : null;

const isCalculationColumnId = (value: unknown): value is ConciliationCalculationColumnId =>
  typeof value === "string" && value.startsWith(calculationColumnPrefix) && value.length > calculationColumnPrefix.length;

const isStaticConciliationColumnId = (value: unknown): value is StaticConciliationColumnId =>
  typeof value === "string" && allConciliationColumnIdSet.has(value as StaticConciliationColumnId);

const isConciliationColumnId = (value: unknown): value is ConciliationColumnId =>
  isStaticConciliationColumnId(value) || isCalculationColumnId(value);

const normalizeColumnOrderIds = (value: unknown): ConciliationColumnId[] => {
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

const getColumnAlignment = (columnId: ConciliationColumnId): "left" | "center" | "right" => {
  if (isCalculationColumnId(columnId)) return "right";
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

const buildCalculationColumnOptions = (
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

const buildDefaultColumnOrderWithCalculations = (
  calculationColumnIds: ConciliationCalculationColumnId[]
): ConciliationColumnId[] => {
  const next: ConciliationColumnId[] = [...defaultColumnOrderIds];
  const insertIndex = next.indexOf("calculatedColumns") + 1;

  next.splice(insertIndex > 0 ? insertIndex : next.length, 0, ...calculationColumnIds);

  return next;
};

type SystemStatusSelectValue = typeof automaticStatusSelectValue | ConciliationSystemStatus;
type DivergenceRuleField = keyof ConciliationFinancialDivergenceRule;
type FinancialAdjustmentDraft = Record<ConciliationFinancialAdjustmentFieldId, { value: string; reason: string }>;

const serializeStatusMappings = (mappings: ConciliationStatusMappings) =>
  JSON.stringify(
    Object.keys(mappings)
      .sort((first, second) => first.localeCompare(second, "pt-BR", { numeric: true }))
      .map((statusName) => [statusName, mappings[statusName]])
  );

const serializeSummaryMetricIds = (metricIds: ConciliationSummaryMetricId[]) => JSON.stringify(metricIds);

const serializeDivergenceRules = (rules: ConciliationFinancialDivergenceRules) => {
  const normalizedRules = normalizeConciliationFinancialDivergenceRules(rules);

  return JSON.stringify({
    defaultRule: normalizedRules.defaultRule,
    marketplaceRules: Object.keys(normalizedRules.marketplaceRules)
      .sort(compareString)
      .map((marketplace) => [marketplace, normalizedRules.marketplaceRules[marketplace]]),
  });
};

const compareString = (first: string, second: string) => first.localeCompare(second, "pt-BR", { numeric: true });

const emptySummary: ConciliationSummary = {
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

const formatCurrency = (value: number | undefined) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);

const formatCurrencyInput = (value: number | undefined | null) =>
  value === null || value === undefined
    ? ""
    : new Intl.NumberFormat("pt-BR", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }).format(value);

const parseCurrencyInput = (value: string): number | null => {
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

const formatNumber = (value: number | undefined) => new Intl.NumberFormat("pt-BR").format(value || 0);

const formatPercentage = (value: number | undefined) =>
  `${new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(value || 0)}%`;

const getItemAllocationShare = (order: ConciliationOrder, item: ConciliationOrderItem) => {
  const itemsGrossValue = order.items.reduce((total, currentItem) => total + currentItem.grossValue, 0);

  if (itemsGrossValue > 0) {
    return item.grossValue / itemsGrossValue;
  }

  if (order.totalQuantity > 0) {
    return item.quantity / order.totalQuantity;
  }

  return 0;
};

const allocateOrderAmountToItem = (
  order: ConciliationOrder,
  item: ConciliationOrderItem,
  amount: number | undefined
) => (amount || 0) * getItemAllocationShare(order, item);

const formatClock = (value: Date | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(value)
    : "--:--";

const summaryMetricDefinitions: SummaryMetricDefinition[] = [
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

const summaryMetricDefinitionById = new Map(summaryMetricDefinitions.map((definition) => [definition.id, definition]));

const formatDate = (dateString: string | undefined) => {
  if (!dateString || dateString.startsWith("0000")) return "N/A";

  try {
    return new Intl.DateTimeFormat("pt-BR").format(new Date(`${dateString}T00:00:00`));
  } catch {
    return dateString;
  }
};

const formatDateTime = (dateString: string | null | undefined) => {
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

const formatActor = (actor: ConciliationRecord["updatedBy"]) => {
  if (!actor) return "N/A";

  return actor.name || actor.email || "Usuário";
};

const isDateInRange = (dateString: string, dateRange: DateRange | undefined) => {
  if (!dateRange?.from || !dateRange?.to) return true;

  try {
    const orderDate = parseISO(dateString);

    return orderDate >= startOfDay(dateRange.from) && orderDate <= endOfDay(dateRange.to);
  } catch {
    return false;
  }
};

const getPayoutComparisonScore = (status: ConciliationPayoutComparisonStatus) => {
  if (status === "divergent") return 2;
  if (status === "matched") return 1;

  return 0;
};

const isConciliationSuggestionCandidate = (order: ConciliationOrder) =>
  !order.isReconciled &&
  order.systemStatus === "Entregue" &&
  order.financialDivergence.severity === "ok" &&
  order.payoutComparison.status === "matched";

const getOrderRowMarkerClassName = (order: ConciliationOrder) => {
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

const getActiveFinancialAdjustments = (order: ConciliationOrder): ConciliationFinancialAdjustment[] =>
  financialAdjustmentFields
    .map((field) => order.financialAdjustments[field.id])
    .filter((adjustment): adjustment is ConciliationFinancialAdjustment => Boolean(adjustment?.active));

const getFinancialAdjustmentSummary = (order: ConciliationOrder): string => {
  const activeAdjustments = getActiveFinancialAdjustments(order);

  if (activeAdjustments.length === 0) return "Sem ajustes manuais";

  return activeAdjustments
    .map((adjustment) => {
      const reason = adjustment.reason ? ` | ${adjustment.reason}` : "";

      return `${adjustment.label}: ${formatCurrency(adjustment.originalValue)} -> ${formatCurrency(adjustment.adjustedValue ?? 0)}${reason}`;
    })
    .join("\n");
};

const FinancialAdjustmentsBadge = ({
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

const getOrderCalculationValues = (order: ConciliationOrder) => Object.values(order.calculationValues || {});

const formatCalculationValue = (value: number, isPercentage: boolean) =>
  isPercentage ? formatPercentage(value) : formatCurrency(value);

const getCalculationSummary = (order: ConciliationOrder): string => {
  const values = getOrderCalculationValues(order);

  if (values.length === 0) return "Sem colunas calculadas";

  return values
    .map((value) => {
      const status = value.error ? ` | erro: ${value.error}` : "";

      return `${value.name}: ${formatCalculationValue(value.value, value.isPercentage)}${status}`;
    })
    .join("\n");
};

const CalculatedColumnsBadge = ({ order }: { order: ConciliationOrder }) => {
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

const getSortValue = (order: ConciliationOrder, columnId: ConciliationColumnId): string | number => {
  const calculationId = getCalculationIdFromColumnId(columnId);

  if (calculationId) {
    const calculation = order.calculationValues?.[calculationId];

    return calculation && !calculation.error ? calculation.value : 0;
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

const getStatusVariant = (statusName: string): "default" | "secondary" | "destructive" | "outline" => {
  const normalized = statusName
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  if (normalized.includes("cancelado")) return "destructive";
  if (normalized.includes("entregue") || normalized.includes("concluido") || normalized.includes("atendido")) return "default";
  if (normalized.includes("enviado") || normalized.includes("transito")) return "outline";

  return "secondary";
};

const getSystemStatusVariant = (
  status: ConciliationSystemStatus
): "default" | "secondary" | "destructive" | "outline" => {
  if (status === "Cancelado" || status === "Devolução" || status === "Devolução / Reembolso Parcial") {
    return "destructive";
  }
  if (status === "Entregue") return "default";
  if (status === "Em Trânsito" || status === "Extravio") return "outline";

  return "secondary";
};

const getSystemStatusControlClassName = (status: ConciliationSystemStatus) => {
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

const InlineSystemStatusSelect = ({
  order,
  isSaving,
  onSave,
}: {
  order: ConciliationOrder;
  isSaving: boolean;
  onSave: (order: ConciliationOrder, manualSystemStatus: ConciliationSystemStatus | null) => void;
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
        title={
          order.manualSystemStatus
            ? `Status manual. Automático: ${order.automaticSystemStatus}`
            : `Status automático: ${order.automaticSystemStatus}`
        }
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              order.manualSystemStatus ? "bg-slate-950" : "bg-slate-400"
            )}
          />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={automaticStatusSelectValue}>
          Automático ({order.automaticSystemStatus})
        </SelectItem>
        {conciliationSystemStatusOptions.map((statusOption) => (
          <SelectItem key={statusOption} value={statusOption}>
            {statusOption}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

const getFinancialDivergenceBadgeClass = (severity: ConciliationFinancialDivergenceSeverity) => {
  if (severity === "critical") return "border-transparent";
  if (severity === "attention") return "border-amber-200 bg-amber-50 text-amber-800";

  return "border-emerald-200 bg-emerald-50 text-emerald-800";
};

const getFinancialDivergenceVariant = (
  severity: ConciliationFinancialDivergenceSeverity
): "default" | "secondary" | "destructive" | "outline" => {
  if (severity === "critical") return "destructive";

  return "outline";
};

const FinancialDivergenceBadge = ({
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

const getPayoutComparisonBadgeClass = (status: ConciliationPayoutComparisonStatus) => {
  if (status === "matched") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "divergent") return "border-transparent";

  return "border-slate-200 bg-slate-50 text-slate-700";
};

const getPayoutComparisonVariant = (
  status: ConciliationPayoutComparisonStatus
): "default" | "secondary" | "destructive" | "outline" => {
  if (status === "divergent") return "destructive";

  return "outline";
};

const PayoutComparisonBadge = ({
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

const ConciliationSuggestionBadge = ({ order }: { order: ConciliationOrder }) => {
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

const FinancialDivergenceReasons = ({ divergence }: { divergence: ConciliationFinancialDivergence }) => {
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

const SummaryCard = ({
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

const PeriodSummaryMetricCard = ({
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

const QueryLoadingNotice = () => (
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

const ConciliationLoadingState = () => (
  <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center">
    <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
    <p className="mt-3 text-sm font-semibold text-slate-950">Carregando conciliação...</p>
    <p className="mt-1 max-w-sm text-xs text-slate-500">
      Conferindo pedidos, marcações e repasses do período.
    </p>
  </div>
);

const ConciliationTableLoadingState = ({
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

const ConciliationEmptyState = ({
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

const FinancialAlertsSummary = ({
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

const PayoutSummary = ({
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

const SuggestedReconciliationSummary = ({
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

const ColumnVisibilityPopover = ({
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

const DetailItem = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="min-w-0">
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
    <div className="mt-1 break-words text-sm text-foreground">
      {value === null || value === undefined || value === "" ? "N/A" : value}
    </div>
  </div>
);

const DetailCard = ({
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

const EmptyDetailState = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
    {children}
  </div>
);

const getAuditEventIcon = (type: ConciliationAuditEvent["type"]) => {
  if (type === "reconciled") return CheckCircle2;
  if (type === "unreconciled") return Undo2;
  if (type === "financial-adjustment-updated") return Banknote;

  return SlidersHorizontal;
};

const getAuditEventBadge = (type: ConciliationAuditEvent["type"]) => {
  if (type === "reconciled") return <Badge>Conciliação</Badge>;
  if (type === "unreconciled") return <Badge variant="outline">Desfeito</Badge>;
  if (type === "financial-adjustment-updated") return <Badge variant="outline">Ajuste financeiro</Badge>;

  return <Badge variant="secondary">Status</Badge>;
};

const auditDetailLabels: Record<string, string> = {
  previousSystemStatus: "Status anterior",
  systemStatus: "Status aplicado",
  manualSystemStatus: "Status manual",
  automaticSystemStatus: "Status automático",
  reconciled: "Conciliado",
  orderNumber: "Pedido",
  activeAdjustments: "Ajustes ativos",
  fields: "Campos",
};

const formatAuditDetailValue = (value: string | number | boolean | null) => {
  if (value === null || value === "") return "N/A";
  if (typeof value === "boolean") return value ? "Sim" : "Não";

  return String(value);
};

const buildConciliationAuditEvents = (order: ConciliationOrder): ConciliationAuditEvent[] => {
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

const AuditTimeline = ({ events }: { events: ConciliationAuditEvent[] }) => {
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

const SortableHeader = ({
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

const OrderCard = ({
  order,
  selected,
  isSaving,
  onSelect,
  onOpen,
  onToggleReconciled,
}: {
  order: ConciliationOrder;
  selected: boolean;
  isSaving: boolean;
  onSelect: (checked: boolean) => void;
  onOpen: () => void;
  onToggleReconciled: () => void;
}) => {
  const mainItem = order.items[0];

  return (
    <div className="flex min-h-[300px] flex-col rounded-lg border bg-white p-4 shadow-sm transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Checkbox
            aria-label={`Selecionar pedido ${order.number || order.orderId}`}
            checked={selected}
            onCheckedChange={(checked) => onSelect(checked === true)}
            disabled={isSaving}
          />
          {order.isReconciled ? (
            <Badge className="gap-1 whitespace-nowrap">
              <CheckCircle2 className="h-3 w-3" />
              Conciliado
            </Badge>
          ) : (
            <Badge variant="outline" className="whitespace-nowrap">
              Pendente
            </Badge>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant={getStatusVariant(order.statusName)} className="whitespace-nowrap">
            {order.statusName}
          </Badge>
          <Badge variant={getSystemStatusVariant(order.systemStatus)} className="whitespace-nowrap">
            {order.systemStatus}
          </Badge>
          <FinancialAdjustmentsBadge order={order} hideEmpty />
          <FinancialDivergenceBadge divergence={order.financialDivergence} compact />
          <PayoutComparisonBadge order={order} compact />
          <ConciliationSuggestionBadge order={order} />
        </div>
      </div>

      <div className="mt-4 min-w-0">
        <button type="button" className="text-left" onClick={onOpen}>
          <p className="text-lg font-semibold leading-none">#{order.number || order.orderId}</p>
          <p className="mt-1 text-xs text-muted-foreground">{order.storeNumber}</p>
        </button>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-md bg-muted px-2 py-1">{order.marketplace}</span>
          <span className="rounded-md bg-muted px-2 py-1">{order.accountName}</span>
          <span className="rounded-md bg-muted px-2 py-1">{formatDate(order.date)}</span>
        </div>
      </div>

      <button type="button" className="mt-4 min-w-0 text-left" onClick={onOpen}>
        <p className="line-clamp-2 text-sm font-medium leading-snug">
          {mainItem?.description || "Pedido sem itens registrados"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {mainItem?.sku || "Sem SKU"}
          {order.items.length > 1 ? ` +${order.items.length - 1}` : ""}
        </p>
      </button>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <DetailItem label="Bruto" value={formatCurrency(order.grossRevenue)} />
        <DetailItem label="Líquido" value={formatCurrency(order.netRevenue)} />
        <DetailItem label="Repasse" value={formatCurrency(order.payoutComparison.paidNetAmount)} />
        <DetailItem label="Margem" value={formatCurrency(order.contributionMargin)} />
        <DetailItem label="Margem %" value={formatPercentage(order.contributionMarginPercentage)} />
      </div>

      <div className="mt-auto flex flex-col gap-2 pt-4 sm:flex-row">
        <Button type="button" variant="outline" size="sm" className="flex-1" onClick={onOpen}>
          Detalhes
        </Button>
        <Button
          type="button"
          size="sm"
          variant={order.isReconciled ? "outline" : "default"}
          className="flex-1"
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
  );
};

const SummarySettingsDialog = ({
  open,
  onOpenChange,
  summarySettings,
  isSaving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summarySettings: ConciliationSummarySettings;
  isSaving: boolean;
  onSave: (metricIds: ConciliationSummaryMetricId[]) => void;
}) => {
  const [draftMetricIds, setDraftMetricIds] = React.useState<ConciliationSummaryMetricId[]>(
    defaultConciliationSummaryMetricIds
  );

  React.useEffect(() => {
    if (open) {
      setDraftMetricIds(normalizeConciliationSummaryMetricIds(summarySettings.metricIds));
    }
  }, [open, summarySettings.metricIds]);

  const hasChanges =
    serializeSummaryMetricIds(draftMetricIds) !==
    serializeSummaryMetricIds(normalizeConciliationSummaryMetricIds(summarySettings.metricIds));
  const selectedMetricIdSet = React.useMemo(() => new Set(draftMetricIds), [draftMetricIds]);
  const selectedMetricDefinitions = draftMetricIds
    .map((metricId) => summaryMetricDefinitionById.get(metricId))
    .filter((definition): definition is SummaryMetricDefinition => Boolean(definition));

  const toggleMetric = (metricId: ConciliationSummaryMetricId, checked: boolean) => {
    setDraftMetricIds((previous) => {
      if (checked) {
        return previous.includes(metricId) ? previous : [...previous, metricId];
      }

      return previous.length > 1 ? previous.filter((selectedMetricId) => selectedMetricId !== metricId) : previous;
    });
  };

  const moveMetric = (metricId: ConciliationSummaryMetricId, direction: -1 | 1) => {
    setDraftMetricIds((previous) => {
      const currentIndex = previous.indexOf(metricId);
      const nextIndex = currentIndex + direction;

      if (currentIndex === -1 || nextIndex < 0 || nextIndex >= previous.length) return previous;

      const next = [...previous];
      const [metric] = next.splice(currentIndex, 1);
      next.splice(nextIndex, 0, metric);

      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Configurar Resumo</DialogTitle>
          <DialogDescription>
            Escolha quais métricas aparecem no topo da conciliação e defina a ordem dos cards.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <div className="rounded-lg border">
            <div className="border-b p-3">
              <p className="text-sm font-medium">Métricas disponíveis</p>
              <p className="text-xs text-muted-foreground">Mantenha pelo menos uma métrica ativa.</p>
            </div>
            <div className="grid max-h-[46vh] gap-1 overflow-y-auto p-2">
              {conciliationSummaryMetricOptions.map((metricId) => {
                const definition = summaryMetricDefinitionById.get(metricId);
                if (!definition) return null;

                const checked = selectedMetricIdSet.has(metricId);

                return (
                  <label
                    key={metricId}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => toggleMetric(metricId, value === true)}
                      disabled={isSaving || (checked && draftMetricIds.length === 1)}
                    />
                    <definition.icon className="h-4 w-4 text-muted-foreground" />
                    <span>{definition.title}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border">
            <div className="border-b p-3">
              <p className="text-sm font-medium">Ordem dos cards</p>
              <p className="text-xs text-muted-foreground">{formatNumber(draftMetricIds.length)} card(s) ativo(s)</p>
            </div>
            <div className="max-h-[46vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Card</TableHead>
                    <TableHead className="w-24 text-right">Ordem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedMetricDefinitions.map((definition, index) => (
                    <TableRow key={definition.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <definition.icon className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{definition.title}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => moveMetric(definition.id, -1)}
                            disabled={isSaving || index === 0}
                            aria-label={`Mover ${definition.title} para cima`}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => moveMetric(definition.id, 1)}
                            disabled={isSaving || index === selectedMetricDefinitions.length - 1}
                            aria-label={`Mover ${definition.title} para baixo`}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <div className="grid gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
          <DetailItem label="Atualizado em" value={formatDateTime(summarySettings.updatedAt)} />
          <DetailItem label="Atualizado por" value={formatActor(summarySettings.updatedBy)} />
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDraftMetricIds(defaultConciliationSummaryMetricIds)}
            disabled={isSaving}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Resetar padrão
          </Button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Fechar
            </Button>
            <Button type="button" onClick={() => onSave(draftMetricIds)} disabled={!hasChanges || isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar resumo
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const emptyCalculationDraft: ConciliationCustomCalculationInput = {
  name: "",
  description: "",
  expression: "",
  isPercentage: false,
  enabled: true,
};

const serializeCustomCalculations = (calculations: ConciliationCustomCalculationInput[]) =>
  JSON.stringify(
    calculations.map((calculation) => ({
      id: calculation.id || "",
      name: calculation.name.trim(),
      description: calculation.description.trim(),
      expression: calculation.expression.trim(),
      isPercentage: Boolean(calculation.isPercentage),
      enabled: calculation.enabled !== false,
    }))
  );

const CalculationSettingsDialog = ({
  open,
  onOpenChange,
  calculationSettings,
  isSaving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calculationSettings: ConciliationCalculationSettings;
  isSaving: boolean;
  onSave: (calculations: ConciliationCustomCalculationInput[]) => void;
}) => {
  const [draftCalculations, setDraftCalculations] = React.useState<ConciliationCustomCalculationInput[]>([]);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<ConciliationCustomCalculationInput>(emptyCalculationDraft);

  React.useEffect(() => {
    if (!open) return;

    setDraftCalculations(
      calculationSettings.calculations.map((calculation) => ({
        id: calculation.id,
        name: calculation.name,
        description: calculation.description,
        expression: calculation.expression,
        isPercentage: calculation.isPercentage,
        enabled: calculation.enabled,
      }))
    );
    setEditingId(null);
    setDraft(emptyCalculationDraft);
  }, [calculationSettings.calculations, open]);

  const calculationIds = draftCalculations
    .filter((calculation) => calculation.enabled)
    .map((calculation) => calculation.id)
    .filter((id): id is string => Boolean(id));
  const expressionError = draft.expression.trim()
    ? validateConciliationCalculationExpression(
        draft.expression,
        calculationIds.filter((id) => id !== editingId)
      )
    : "Informe uma fórmula.";
  const hasDraftName = draft.name.trim().length > 0;
  const canAddOrUpdate = hasDraftName && !expressionError;
  const hasChanges =
    serializeCustomCalculations(draftCalculations) !== serializeCustomCalculations(calculationSettings.calculations);

  const updateDraft = <Field extends keyof ConciliationCustomCalculationInput>(
    field: Field,
    value: ConciliationCustomCalculationInput[Field]
  ) => {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const appendFieldToExpression = (fieldId: ConciliationCalculationFieldId | string) => {
    setDraft((current) => ({
      ...current,
      expression: `${current.expression}${current.expression.trim() ? " " : ""}{${fieldId}}`,
    }));
  };

  const resetDraft = () => {
    setEditingId(null);
    setDraft(emptyCalculationDraft);
  };

  const upsertDraftCalculation = () => {
    if (!canAddOrUpdate) return;

    const id = editingId || draft.id || sanitizeConciliationCalculationId(draft.name);
    const normalized: ConciliationCustomCalculationInput = {
      id,
      name: draft.name.trim(),
      description: draft.description.trim(),
      expression: draft.expression.trim(),
      isPercentage: draft.isPercentage,
      enabled: draft.enabled,
    };

    setDraftCalculations((current) => {
      if (editingId) {
        return current.map((calculation) => (calculation.id === editingId ? normalized : calculation));
      }

      return [...current, normalized];
    });
    resetDraft();
  };

  const editCalculation = (calculation: ConciliationCustomCalculationInput) => {
    setEditingId(calculation.id || null);
    setDraft({
      id: calculation.id,
      name: calculation.name,
      description: calculation.description,
      expression: calculation.expression,
      isPercentage: calculation.isPercentage,
      enabled: calculation.enabled,
    });
  };

  const removeCalculation = (calculationId: string | undefined) => {
    if (!calculationId) return;

    setDraftCalculations((current) => current.filter((calculation) => calculation.id !== calculationId));
    if (editingId === calculationId) resetDraft();
  };

  const moveCalculation = (calculationId: string | undefined, direction: -1 | 1) => {
    if (!calculationId) return;

    setDraftCalculations((current) => {
      const currentIndex = current.findIndex((calculation) => calculation.id === calculationId);
      const nextIndex = currentIndex + direction;

      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= current.length) return current;

      const next = [...current];
      const [movedCalculation] = next.splice(currentIndex, 1);

      if (!movedCalculation) return current;

      next.splice(nextIndex, 0, movedCalculation);

      return next;
    });
  };

  const customCalculationFields = draftCalculations
    .filter((calculation) => calculation.enabled && calculation.id && calculation.id !== editingId)
    .map((calculation) => ({
      id: calculation.id as string,
      label: calculation.name,
      helper: calculation.expression,
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Colunas calculadas</DialogTitle>
          <DialogDescription>
            Crie colunas com fórmulas aritméticas usando campos financeiros do pedido.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-4 rounded-lg border p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Nome</span>
                <Input
                  value={draft.name}
                  onChange={(event) => updateDraft("name", event.target.value)}
                  placeholder="Ex.: Lucro operacional"
                  disabled={isSaving}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Descrição</span>
                <Input
                  value={draft.description}
                  onChange={(event) => updateDraft("description", event.target.value)}
                  placeholder="Opcional"
                  disabled={isSaving}
                />
              </label>
            </div>

            <label className="grid gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fórmula</span>
              <Input
                value={draft.expression}
                onChange={(event) => updateDraft("expression", event.target.value)}
                placeholder="{netRevenue} - {productCost} - {shippingCost}"
                disabled={isSaving}
                className={cn(expressionError && draft.expression.trim() && "border-red-300 focus-visible:ring-red-300")}
              />
              <span className={cn("text-xs", expressionError ? "text-red-600" : "text-muted-foreground")}>
                {expressionError || "Use +, -, *, / e parênteses."}
              </span>
            </label>

            <div className="grid gap-2 rounded-lg border bg-muted/20 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Campos disponíveis</p>
              <div className="max-h-44 space-y-3 overflow-y-auto pr-1">
                <div className="flex flex-wrap gap-1.5">
                  {conciliationCalculationFieldOptions.map((field) => (
                    <Button
                      key={field.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => appendFieldToExpression(field.id)}
                      disabled={isSaving}
                      title={field.helper}
                    >
                      {field.label}
                    </Button>
                  ))}
                </div>
                {customCalculationFields.length > 0 ? (
                  <div className="space-y-1.5 border-t pt-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Cálculos da grade
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {customCalculationFields.map((field) => (
                        <Button
                          key={field.id}
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => appendFieldToExpression(field.id)}
                          disabled={isSaving}
                          title={field.helper}
                        >
                          {field.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.enabled}
                    onCheckedChange={(value) => updateDraft("enabled", value === true)}
                    disabled={isSaving}
                  />
                  Ativo
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.isPercentage}
                    onCheckedChange={(value) => updateDraft("isPercentage", value === true)}
                    disabled={isSaving}
                  />
                  Exibir como %
                </label>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={resetDraft} disabled={isSaving}>
                  Limpar
                </Button>
                <Button type="button" size="sm" onClick={upsertDraftCalculation} disabled={!canAddOrUpdate || isSaving}>
                  <Plus className="mr-2 h-4 w-4" />
                  {editingId ? "Atualizar" : "Adicionar"}
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border">
            <div className="flex items-center justify-between border-b p-3">
              <div>
                <p className="text-sm font-medium">Cálculos configurados</p>
                <p className="text-xs text-muted-foreground">{formatNumber(draftCalculations.length)} coluna(s)</p>
              </div>
              <Badge variant="outline">{formatNumber(draftCalculations.filter((calculation) => calculation.enabled).length)} ativo(s)</Badge>
            </div>
            <div className="max-h-[52vh] overflow-y-auto p-2">
              {draftCalculations.length > 0 ? (
                <div className="space-y-2">
                  {draftCalculations.map((calculation, index) => (
                    <div
                      key={calculation.id}
                      className={cn(
                        "rounded-md border p-3",
                        editingId === calculation.id && "border-primary bg-primary/5"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{calculation.name}</p>
                          <p className="mt-1 font-mono text-[11px] text-muted-foreground">{calculation.expression}</p>
                          {calculation.description ? (
                            <p className="mt-1 text-xs text-muted-foreground">{calculation.description}</p>
                          ) : null}
                        </div>
                        <Badge variant={calculation.enabled ? "default" : "outline"}>
                          {calculation.enabled ? "Ativo" : "Inativo"}
                        </Badge>
                      </div>
                      <div className="mt-3 flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => moveCalculation(calculation.id, -1)}
                          disabled={isSaving || index === 0}
                          aria-label={`Mover ${calculation.name} para cima`}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => moveCalculation(calculation.id, 1)}
                          disabled={isSaving || index === draftCalculations.length - 1}
                          aria-label={`Mover ${calculation.name} para baixo`}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => editCalculation(calculation)}
                          disabled={isSaving}
                        >
                          Editar
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeCalculation(calculation.id)}
                          disabled={isSaving}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Remover
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyDetailState>Nenhuma coluna calculada configurada.</EmptyDetailState>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
          <DetailItem label="Atualizado em" value={formatDateTime(calculationSettings.updatedAt)} />
          <DetailItem label="Atualizado por" value={formatActor(calculationSettings.updatedBy)} />
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Fechar
          </Button>
          <Button type="button" onClick={() => onSave(draftCalculations)} disabled={!hasChanges || isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Salvar cálculos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const DivergenceRuleNumberField = ({
  label,
  value,
  suffix,
  step = "0.01",
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  suffix?: string;
  step?: string;
  disabled: boolean;
  onChange: (value: number) => void;
}) => (
  <label className="grid gap-1.5">
    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
    <div className="relative">
      <Input
        type="number"
        min="0"
        step={step}
        value={Number.isFinite(value) ? String(value) : "0"}
        onChange={(event) => onChange(Number(event.target.value))}
        disabled={disabled}
        className={suffix ? "pr-10" : undefined}
      />
      {suffix ? (
        <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-muted-foreground">{suffix}</span>
      ) : null}
    </div>
  </label>
);

const DivergenceRuleCheckboxField = ({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <label className="flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
    <Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(value === true)} />
    <span>{label}</span>
  </label>
);

const DivergenceRuleEditor = ({
  rule,
  disabled,
  onRuleChange,
}: {
  rule: ConciliationFinancialDivergenceRule;
  disabled: boolean;
  onRuleChange: (rule: ConciliationFinancialDivergenceRule) => void;
}) => {
  const updateRule = (field: DivergenceRuleField, value: number | boolean) => {
    onRuleChange({
      ...rule,
      [field]: value,
    });
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DivergenceRuleNumberField
          label="Tolerância R$"
          value={rule.moneyTolerance}
          disabled={disabled}
          onChange={(value) => updateRule("moneyTolerance", value)}
        />
        <DivergenceRuleNumberField
          label="Diferença crítica R$"
          value={rule.grossDifferenceCriticalAmount}
          disabled={disabled}
          onChange={(value) => updateRule("grossDifferenceCriticalAmount", value)}
        />
        <DivergenceRuleNumberField
          label="Diferença crítica"
          value={rule.grossDifferenceCriticalPercentage}
          suffix="%"
          disabled={disabled}
          onChange={(value) => updateRule("grossDifferenceCriticalPercentage", value)}
        />
        <DivergenceRuleNumberField
          label="Margem mínima"
          value={rule.marginAttentionPercentage}
          suffix="%"
          disabled={disabled}
          onChange={(value) => updateRule("marginAttentionPercentage", value)}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <DivergenceRuleCheckboxField
          label="Exigir custo do produto"
          checked={rule.requireProductCost}
          disabled={disabled}
          onChange={(checked) => updateRule("requireProductCost", checked)}
        />
        <DivergenceRuleCheckboxField
          label="Exigir comissão em marketplace"
          checked={rule.requireMarketplaceCommission}
          disabled={disabled}
          onChange={(checked) => updateRule("requireMarketplaceCommission", checked)}
        />
        <DivergenceRuleCheckboxField
          label="Exigir custo de frete quando cliente paga frete"
          checked={rule.requireShippingCostWhenCustomerShipping}
          disabled={disabled}
          onChange={(checked) => updateRule("requireShippingCostWhenCustomerShipping", checked)}
        />
        <DivergenceRuleCheckboxField
          label="Alertar status sem receita com valor"
          checked={rule.flagNonRevenueStatusWithValue}
          disabled={disabled}
          onChange={(checked) => updateRule("flagNonRevenueStatusWithValue", checked)}
        />
      </div>
    </div>
  );
};

const FinancialDivergenceSettingsDialog = ({
  open,
  onOpenChange,
  orders,
  divergenceSettings,
  isSaving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: ConciliationOrder[];
  divergenceSettings: ConciliationDivergenceSettings;
  isSaving: boolean;
  onSave: (rules: ConciliationFinancialDivergenceRules) => void;
}) => {
  const [draftRules, setDraftRules] = React.useState<ConciliationFinancialDivergenceRules>(
    defaultConciliationFinancialDivergenceRules
  );
  const [selectedScope, setSelectedScope] = React.useState(defaultDivergenceRuleScopeValue);

  React.useEffect(() => {
    if (open) {
      setDraftRules(normalizeConciliationFinancialDivergenceRules(divergenceSettings));
      setSelectedScope(defaultDivergenceRuleScopeValue);
    }
  }, [open, divergenceSettings]);

  const marketplaceOptions = React.useMemo(() => {
    const marketplaces = new Set(orders.map((order) => order.marketplace).filter(Boolean));

    return Array.from(marketplaces).sort(compareString);
  }, [orders]);
  const selectedRule = React.useMemo(
    () =>
      selectedScope === defaultDivergenceRuleScopeValue
        ? draftRules.defaultRule
        : resolveConciliationFinancialDivergenceRule(selectedScope, draftRules),
    [draftRules, selectedScope]
  );
  const hasMarketplaceOverride =
    selectedScope !== defaultDivergenceRuleScopeValue && Boolean(draftRules.marketplaceRules[selectedScope]);
  const previewOrders = React.useMemo(
    () => applyFinancialDivergenceRules(orders, draftRules),
    [draftRules, orders]
  );
  const currentSummary = React.useMemo(
    () => (orders.length > 0 ? calculateConciliationSummary(orders) : emptySummary),
    [orders]
  );
  const previewSummary = React.useMemo(
    () => (previewOrders.length > 0 ? calculateConciliationSummary(previewOrders) : emptySummary),
    [previewOrders]
  );
  const hasChanges = serializeDivergenceRules(draftRules) !== serializeDivergenceRules(divergenceSettings);

  const handleRuleChange = (rule: ConciliationFinancialDivergenceRule) => {
    setDraftRules((previous) => {
      const normalizedRules = normalizeConciliationFinancialDivergenceRules(previous);

      if (selectedScope === defaultDivergenceRuleScopeValue) {
        return {
          ...normalizedRules,
          defaultRule: rule,
        };
      }

      return {
        ...normalizedRules,
        marketplaceRules: {
          ...normalizedRules.marketplaceRules,
          [selectedScope]: rule,
        },
      };
    });
  };

  const resetSelectedMarketplaceRule = () => {
    if (selectedScope === defaultDivergenceRuleScopeValue) return;

    setDraftRules((previous) => {
      const normalizedRules = normalizeConciliationFinancialDivergenceRules(previous);
      const marketplaceRules = { ...normalizedRules.marketplaceRules };

      delete marketplaceRules[selectedScope];

      return {
        ...normalizedRules,
        marketplaceRules,
      };
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Configurar Alertas Financeiros</DialogTitle>
          <DialogDescription>
            Ajuste as tolerâncias globais e regras específicas por marketplace para os alertas de divergência.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-muted/30 p-3">
            <DetailItem label="Marketplaces" value={formatNumber(marketplaceOptions.length)} />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <DetailItem label="Regras próprias" value={formatNumber(Object.keys(draftRules.marketplaceRules).length)} />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <DetailItem
              label="Alertas no preview"
              value={`${formatNumber(previewSummary.financialAlertCount)} / atual ${formatNumber(currentSummary.financialAlertCount)}`}
            />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <DetailItem label="Risco preview" value={formatCurrency(previewSummary.financialRiskAmount)} />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="rounded-lg border">
            <div className="border-b p-3">
              <p className="text-sm font-medium">Escopo</p>
              <p className="text-xs text-muted-foreground">Regra global ou marketplace.</p>
            </div>
            <div className="space-y-3 p-3">
              <Select value={selectedScope} onValueChange={setSelectedScope} disabled={isSaving}>
                <SelectTrigger>
                  <SelectValue placeholder="Escopo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={defaultDivergenceRuleScopeValue}>Padrão global</SelectItem>
                  {marketplaceOptions.map((marketplaceOption) => (
                    <SelectItem key={marketplaceOption} value={marketplaceOption}>
                      {marketplaceOption}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="rounded-lg bg-muted/40 p-3">
                <DetailItem
                  label="Origem da regra"
                  value={
                    selectedScope === defaultDivergenceRuleScopeValue ? (
                      <Badge variant="secondary">Global</Badge>
                    ) : hasMarketplaceOverride ? (
                      <Badge variant="outline">Marketplace</Badge>
                    ) : (
                      <Badge variant="secondary">Herdada</Badge>
                    )
                  }
                />
              </div>

              {selectedScope !== defaultDivergenceRuleScopeValue ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={resetSelectedMarketplaceRule}
                  disabled={isSaving || !hasMarketplaceOverride}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Usar padrão global
                </Button>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border">
            <div className="border-b p-3">
              <p className="text-sm font-medium">
                {selectedScope === defaultDivergenceRuleScopeValue ? "Regra global" : selectedScope}
              </p>
              <p className="text-xs text-muted-foreground">
                Alterações em marketplace criam uma regra própria para o escopo selecionado.
              </p>
            </div>
            <div className="p-3">
              <DivergenceRuleEditor rule={selectedRule} disabled={isSaving} onRuleChange={handleRuleChange} />
            </div>
          </div>
        </div>

        <div className="grid gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
          <DetailItem label="Atualizado em" value={formatDateTime(divergenceSettings.updatedAt)} />
          <DetailItem label="Atualizado por" value={formatActor(divergenceSettings.updatedBy)} />
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraftRules(defaultConciliationFinancialDivergenceRules);
              setSelectedScope(defaultDivergenceRuleScopeValue);
            }}
            disabled={isSaving}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Resetar tudo
          </Button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Fechar
            </Button>
            <Button type="button" onClick={() => onSave(draftRules)} disabled={!hasChanges || isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar alertas
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const StatusMappingsDialog = ({
  open,
  onOpenChange,
  orders,
  statusMappings,
  statusSettings,
  isSaving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: ConciliationOrder[];
  statusMappings: ConciliationStatusMappings;
  statusSettings: ConciliationStatusSettings;
  isSaving: boolean;
  onSave: (statusMappings: ConciliationStatusMappings) => void;
}) => {
  const [draftMappings, setDraftMappings] = React.useState<ConciliationStatusMappings>({});

  React.useEffect(() => {
    if (open) {
      setDraftMappings(statusMappings);
    }
  }, [open, statusMappings]);

  const statusRows = React.useMemo(() => {
    const rows = new Map<
      string,
      {
        statusName: string;
        orderCount: number;
        manualCount: number;
      }
    >();

    orders.forEach((order) => {
      const existing = rows.get(order.statusName) || {
        statusName: order.statusName,
        orderCount: 0,
        manualCount: 0,
      };

      existing.orderCount += 1;
      if (order.manualSystemStatus) existing.manualCount += 1;
      rows.set(order.statusName, existing);
    });

    return Array.from(rows.values()).sort((first, second) => compareString(first.statusName, second.statusName));
  }, [orders]);

  const hasChanges = serializeStatusMappings(draftMappings) !== serializeStatusMappings(statusMappings);
  const previewAffectedCount = React.useMemo(
    () =>
      orders.reduce((total, order) => {
        if (order.manualSystemStatus) return total;

        const nextAutomaticStatus = draftMappings[order.statusName] ?? resolveAutomaticSystemStatus(order.statusName);

        return total + (nextAutomaticStatus !== order.automaticSystemStatus ? 1 : 0);
      }, 0),
    [draftMappings, orders]
  );

  const handleStatusChange = (statusName: string, value: SystemStatusSelectValue) => {
    setDraftMappings((previous) => {
      const next = { ...previous };

      if (value === automaticStatusSelectValue) {
        delete next[statusName];
      } else {
        next[statusName] = value;
      }

      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Configurar Status de Sistema</DialogTitle>
          <DialogDescription>
            Mapeie os status dos pedidos para os status operacionais usados na conciliação.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-muted/30 p-3">
            <DetailItem label="Status encontrados" value={formatNumber(statusRows.length)} />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <DetailItem label="Pedidos no escopo" value={formatNumber(orders.length)} />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <DetailItem label="Preview de impacto" value={`${formatNumber(previewAffectedCount)} pedido(s)`} />
          </div>
        </div>

        <ScrollArea className="h-[48vh] rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status Pedido</TableHead>
                <TableHead className="text-right">Pedidos</TableHead>
                <TableHead className="text-right">Overrides</TableHead>
                <TableHead>Padrão</TableHead>
                <TableHead>Status Sistema</TableHead>
                <TableHead className="text-right">Afeta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statusRows.length > 0 ? (
                statusRows.map((row) => {
                  const defaultStatus = resolveAutomaticSystemStatus(row.statusName);
                  const selectedStatus = draftMappings[row.statusName] ?? automaticStatusSelectValue;
                  const proposedStatus = draftMappings[row.statusName] ?? defaultStatus;
                  const affectedCount = orders.filter(
                    (order) =>
                      order.statusName === row.statusName &&
                      !order.manualSystemStatus &&
                      order.automaticSystemStatus !== proposedStatus
                  ).length;

                  return (
                    <TableRow key={row.statusName}>
                      <TableCell className="font-medium">{row.statusName}</TableCell>
                      <TableCell className="text-right">{formatNumber(row.orderCount)}</TableCell>
                      <TableCell className="text-right">{formatNumber(row.manualCount)}</TableCell>
                      <TableCell>
                        <Badge variant={getSystemStatusVariant(defaultStatus)} className="whitespace-nowrap">
                          {defaultStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="min-w-52">
                        <Select
                          value={selectedStatus}
                          onValueChange={(value) => handleStatusChange(row.statusName, value as SystemStatusSelectValue)}
                          disabled={isSaving}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Status de sistema" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={automaticStatusSelectValue}>
                              Automático ({defaultStatus})
                            </SelectItem>
                            {conciliationSystemStatusOptions.map((statusOption) => (
                              <SelectItem key={statusOption} value={statusOption}>
                                {statusOption}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">{formatNumber(affectedCount)}</TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                    Nenhum status encontrado no escopo atual.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>

        <div className="grid gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
          <DetailItem label="Atualizado em" value={formatDateTime(statusSettings.updatedAt)} />
          <DetailItem label="Atualizado por" value={formatActor(statusSettings.updatedBy)} />
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={() => setDraftMappings({})} disabled={isSaving || Object.keys(draftMappings).length === 0}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Resetar regras
          </Button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Fechar
            </Button>
            <Button type="button" onClick={() => onSave(draftMappings)} disabled={!hasChanges || isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar mapeamento
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const normalizeImportHeader = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();

const findImportColumn = (headers: string[], aliases: string[]) => {
  const normalizedAliases = aliases.map(normalizeImportHeader);
  const entries = headers.map((header) => ({
    header,
    normalizedKey: normalizeImportHeader(header),
  }));
  const exactMatch = entries.find((entry) => normalizedAliases.includes(entry.normalizedKey));

  if (exactMatch) return exactMatch.header;

  return entries.find((entry) =>
    normalizedAliases.some(
      (alias) =>
        alias.length > 2 &&
        entry.normalizedKey.length > 2 &&
        (entry.normalizedKey.includes(alias) || alias.includes(entry.normalizedKey))
    )
  )?.header || "";
};

const parseImportMoney = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const rawValue = String(value ?? "").trim();
  if (!rawValue) return null;

  const negative = rawValue.includes("(") && rawValue.includes(")") || rawValue.trim().startsWith("-");
  let cleaned = rawValue.replace(/[^\d,.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "," || cleaned === ".") return null;

  const lastCommaIndex = cleaned.lastIndexOf(",");
  const lastDotIndex = cleaned.lastIndexOf(".");

  if (lastCommaIndex >= 0 && lastDotIndex >= 0) {
    cleaned =
      lastCommaIndex > lastDotIndex
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (lastCommaIndex >= 0) {
    cleaned = cleaned.replace(",", ".");
  } else {
    const dotCount = (cleaned.match(/\./g) || []).length;
    const lastGroupLength = cleaned.length - lastDotIndex - 1;

    if (dotCount > 1 || (dotCount === 1 && lastGroupLength === 3)) {
      cleaned = cleaned.replace(/\./g, "");
    }
  }

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;

  return negative ? -Math.abs(parsed) : parsed;
};

const parseImportDate = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "number") {
    const parsedDate = XLSX.SSF.parse_date_code(value);

    if (parsedDate) {
      return new Date(parsedDate.y, parsedDate.m - 1, parsedDate.d, parsedDate.H, parsedDate.M, parsedDate.S).toISOString();
    }
  }

  const rawValue = String(value).trim();
  if (!rawValue) return null;

  const brazilianDate = rawValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (brazilianDate) {
    const [, day, month, year, hour = "0", minute = "0"] = brazilianDate;
    const fullYear = year.length === 2 ? `20${year}` : year;
    const parsed = new Date(Number(fullYear), Number(month) - 1, Number(day), Number(hour), Number(minute));

    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const parsed = new Date(rawValue);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const payoutOrderKeyAliases = [
  "pedido",
  "numero pedido",
  "n pedido",
  "pedido loja",
  "pedido marketplace",
  "numero pedido marketplace",
  "id pedido",
  "order id",
  "order",
  "sale id",
];
const payoutPaidAtAliases = ["data repasse", "data pagamento", "data liquidacao", "paid at", "payment date", "data"];
const payoutGrossAliases = ["valor bruto", "bruto", "gross amount", "gross", "valor venda", "total venda"];
const payoutFeeAliases = ["taxa", "tarifa", "comissao", "fee", "fees", "marketplace fee"];
const payoutShippingAliases = ["frete", "shipping", "envio", "custo frete", "shipping amount"];
const payoutNetAliases = [
  "valor liquido",
  "liquido",
  "net amount",
  "net",
  "valor repasse",
  "repasse",
  "total recebido",
  "amount",
];

type PayoutImportColumnKey = "orderKey" | "paidAt" | "grossAmount" | "feeAmount" | "shippingAmount" | "netAmount";
type PayoutImportMapping = Record<PayoutImportColumnKey, string>;

type PayoutImportRawRow = {
  sourceRow: number;
  values: Record<string, unknown>;
  hasAnyValue: boolean;
};

const emptyPayoutImportMapping: PayoutImportMapping = {
  orderKey: "",
  paidAt: "",
  grossAmount: "",
  feeAmount: "",
  shippingAmount: "",
  netAmount: "",
};

const payoutImportFieldDefinitions: Array<{
  id: PayoutImportColumnKey;
  label: string;
  aliases: string[];
  required: boolean;
}> = [
  { id: "orderKey", label: "Pedido", aliases: payoutOrderKeyAliases, required: true },
  { id: "netAmount", label: "Líquido", aliases: payoutNetAliases, required: true },
  { id: "paidAt", label: "Data", aliases: payoutPaidAtAliases, required: false },
  { id: "grossAmount", label: "Bruto", aliases: payoutGrossAliases, required: false },
  { id: "feeAmount", label: "Taxas", aliases: payoutFeeAliases, required: false },
  { id: "shippingAmount", label: "Frete", aliases: payoutShippingAliases, required: false },
];

const noPayoutColumnSelectValue = "__none__";

const buildPayoutInputId = (fileName: string, marketplace: string, orderKey: string, sourceRow: number) => {
  const marketplacePart = normalizeConciliationPayoutOrderKey(marketplace) || "MARKETPLACE";
  const orderPart = normalizeConciliationPayoutOrderKey(orderKey) || "SEMCHAVE";
  const filePart = normalizeConciliationPayoutOrderKey(fileName).slice(0, 40) || "ARQUIVO";

  return `${marketplacePart}-${orderPart}-${filePart}-${sourceRow}`;
};

const buildUniqueImportHeaders = (headerRow: unknown[]): string[] => {
  const counts = new Map<string, number>();

  return headerRow.map((value, index) => {
    const baseHeader = String(value || `Coluna ${index + 1}`).trim() || `Coluna ${index + 1}`;
    const count = counts.get(baseHeader) || 0;

    counts.set(baseHeader, count + 1);

    return count === 0 ? baseHeader : `${baseHeader} (${count + 1})`;
  });
};

const readPayoutWorksheet = (
  worksheet: XLSX.WorkSheet
): {
  headers: string[];
  rows: PayoutImportRawRow[];
} => {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
  const headerRow = matrix[0] || [];
  const headers = buildUniqueImportHeaders(headerRow);
  const rows = matrix.slice(1).map<PayoutImportRawRow>((row, index) => {
    const values = headers.reduce<Record<string, unknown>>((record, header, columnIndex) => {
      record[header] = row[columnIndex] ?? "";

      return record;
    }, {});

    return {
      sourceRow: index + 2,
      values,
      hasAnyValue: Object.values(values).some((value) => String(value ?? "").trim()),
    };
  });

  return { headers, rows };
};

const buildSuggestedPayoutMapping = (headers: string[]): PayoutImportMapping =>
  payoutImportFieldDefinitions.reduce<PayoutImportMapping>(
    (mapping, field) => ({
      ...mapping,
      [field.id]: findImportColumn(headers, field.aliases),
    }),
    emptyPayoutImportMapping
  );

const parsePayoutRowsFromMapping = (
  rows: PayoutImportRawRow[],
  fileName: string,
  marketplace: string,
  mapping: PayoutImportMapping
): {
  payouts: ConciliationMarketplacePayoutInput[];
  invalidRows: number;
} => {
  let invalidRows = 0;
  const payouts = rows.reduce<ConciliationMarketplacePayoutInput[]>((parsedRows, row) => {
    const orderKey = String(row.values[mapping.orderKey] ?? "").trim();
    const netAmount = parseImportMoney(row.values[mapping.netAmount]);

    if (!row.hasAnyValue) return parsedRows;
    if (!orderKey || netAmount === null) {
      invalidRows += 1;
      return parsedRows;
    }

    const grossAmount = parseImportMoney(row.values[mapping.grossAmount]);
    const feeAmount = parseImportMoney(row.values[mapping.feeAmount]);
    const shippingAmount = parseImportMoney(row.values[mapping.shippingAmount]);

    parsedRows.push({
      id: buildPayoutInputId(fileName, marketplace, orderKey, row.sourceRow),
      marketplace,
      orderKey,
      paidAt: parseImportDate(row.values[mapping.paidAt]),
      grossAmount: grossAmount ?? netAmount,
      feeAmount: feeAmount ?? 0,
      shippingAmount: shippingAmount ?? 0,
      netAmount,
      sourceFileName: fileName,
      sourceRow: row.sourceRow,
    });

    return parsedRows;
  }, []);

  return {
    payouts,
    invalidRows,
  };
};

const getOrderPayoutImportKeys = (order: ConciliationOrder): string[] => {
  const originalOrder = order.originalOrder as unknown as Record<string, unknown>;
  const notaFiscal = originalOrder.notaFiscal as Record<string, unknown> | undefined;
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

type PayoutImportGroup = {
  id: string;
  importBatchId: string | null;
  sourceFileName: string;
  marketplace: string;
  importedAt: string | null;
  importedBy: ConciliationMarketplacePayout["importedBy"];
  payouts: ConciliationMarketplacePayout[];
  matchedCount: number;
  orphanCount: number;
  netAmount: number;
};

const getPayoutImportGroupId = (payout: ConciliationMarketplacePayout) =>
  payout.importBatchId || `${payout.sourceFileName}::${payout.importedAt || "sem-data"}`;

const buildPayoutImportGroups = (
  payouts: ConciliationMarketplacePayout[],
  orderKeySet: Set<string>
): PayoutImportGroup[] => {
  const groups = payouts.reduce<Map<string, PayoutImportGroup>>((map, payout) => {
    const groupId = getPayoutImportGroupId(payout);
    const existing = map.get(groupId) || {
      id: groupId,
      importBatchId: payout.importBatchId,
      sourceFileName: payout.sourceFileName,
      marketplace: payout.marketplace,
      importedAt: payout.importedAt,
      importedBy: payout.importedBy,
      payouts: [],
      matchedCount: 0,
      orphanCount: 0,
      netAmount: 0,
    };
    const matched = orderKeySet.has(normalizeConciliationPayoutOrderKey(payout.orderKey));

    existing.payouts.push(payout);
    existing.netAmount += payout.netAmount;
    existing.matchedCount += matched ? 1 : 0;
    existing.orphanCount += matched ? 0 : 1;
    map.set(groupId, existing);

    return map;
  }, new Map());

  return Array.from(groups.values()).sort(
    (first, second) => new Date(second.importedAt || "").getTime() - new Date(first.importedAt || "").getTime()
  );
};

const PayoutImportDialog = ({
  open,
  onOpenChange,
  orders,
  marketplaceOptions,
  isSaving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: ConciliationOrder[];
  marketplaceOptions: string[];
  isSaving: boolean;
  onSave: (payouts: ConciliationMarketplacePayoutInput[]) => Promise<void>;
}) => {
  const availableMarketplaces = React.useMemo(
    () => marketplaceOptions.filter((option) => option !== "Todos"),
    [marketplaceOptions]
  );
  const [selectedMarketplace, setSelectedMarketplace] = React.useState("");
  const [fileName, setFileName] = React.useState("");
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rawRows, setRawRows] = React.useState<PayoutImportRawRow[]>([]);
  const [columnMapping, setColumnMapping] = React.useState<PayoutImportMapping>(emptyPayoutImportMapping);
  const [parseError, setParseError] = React.useState("");
  const [isParsing, setIsParsing] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;

    setSelectedMarketplace((previous) => previous || availableMarketplaces[0] || "Marketplace");
    setFileName("");
    setHeaders([]);
    setRawRows([]);
    setColumnMapping(emptyPayoutImportMapping);
    setParseError("");
  }, [availableMarketplaces, open]);

  const orderKeySet = React.useMemo(() => {
    const keys = new Set<string>();

    orders.forEach((order) => {
      getOrderPayoutImportKeys(order).forEach((key) => keys.add(key));
    });

    return keys;
  }, [orders]);
  const mappingReady = Boolean(columnMapping.orderKey && columnMapping.netAmount);
  const parsedPayoutResult = React.useMemo(
    () =>
      mappingReady
        ? parsePayoutRowsFromMapping(rawRows, fileName, selectedMarketplace, columnMapping)
        : { payouts: [], invalidRows: rawRows.filter((row) => row.hasAnyValue).length },
    [columnMapping, fileName, mappingReady, rawRows, selectedMarketplace]
  );
  const payouts = parsedPayoutResult.payouts;
  const invalidRows = parsedPayoutResult.invalidRows;
  const matchedPayoutCount = React.useMemo(
    () => payouts.filter((payout) => orderKeySet.has(normalizeConciliationPayoutOrderKey(payout.orderKey))).length,
    [orderKeySet, payouts]
  );
  const netAmount = React.useMemo(
    () => payouts.reduce((total, payout) => total + payout.netAmount, 0),
    [payouts]
  );
  const previewRows = payouts.slice(0, 8);
  const hasFileRows = rawRows.length > 0;
  const mappingMissingMessage =
    hasFileRows && !mappingReady ? "Mapeie as colunas obrigatórias de pedido e líquido para gerar a prévia." : "";

  const handleMappingChange = (fieldId: PayoutImportColumnKey, value: string) => {
    setColumnMapping((previous) => ({
      ...previous,
      [fieldId]: value === noPayoutColumnSelectValue ? "" : value,
    }));
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    setFileName(file?.name || "");
    setHeaders([]);
    setRawRows([]);
    setColumnMapping(emptyPayoutImportMapping);
    setParseError("");

    if (!file) return;

    setIsParsing(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
      const firstSheetName = workbook.SheetNames[0];

      if (!firstSheetName) {
        throw new Error("O arquivo não possui abas para leitura.");
      }

      const result = readPayoutWorksheet(workbook.Sheets[firstSheetName]);

      setHeaders(result.headers);
      setRawRows(result.rows);
      setColumnMapping(buildSuggestedPayoutMapping(result.headers));
      if (result.headers.length === 0 || result.rows.length === 0) {
        setParseError("Nenhuma linha encontrada. Confira se a primeira linha possui cabeçalhos e se há dados abaixo.");
      }
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Não foi possível ler o arquivo.");
    } finally {
      setIsParsing(false);
      event.target.value = "";
    }
  };

  const handleSave = async () => {
    if (payouts.length === 0) return;

    await onSave(payouts);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Importar Repasses</DialogTitle>
          <DialogDescription>
            Carregue um CSV ou XLSX do marketplace para comparar o líquido repassado com os pedidos do período.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="space-y-4 rounded-lg border p-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Marketplace</span>
              <Select value={selectedMarketplace} onValueChange={setSelectedMarketplace} disabled={isSaving || isParsing}>
                <SelectTrigger>
                  <SelectValue placeholder="Marketplace" />
                </SelectTrigger>
                <SelectContent>
                  {availableMarketplaces.length > 0 ? (
                    availableMarketplaces.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="Marketplace">Marketplace</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Arquivo</span>
              <Input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                disabled={isSaving || isParsing}
              />
            </label>

            {parseError ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {parseError}
              </div>
            ) : null}

            {headers.length > 0 ? (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Mapeamento de colunas</p>
                    <p className="mt-1 text-xs text-muted-foreground">Ajuste os campos reconhecidos antes de importar.</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={() => setColumnMapping(buildSuggestedPayoutMapping(headers))}
                    disabled={isSaving || isParsing}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Sugerir
                  </Button>
                </div>
                <div className="grid gap-3">
                  {payoutImportFieldDefinitions.map((field) => (
                    <label key={field.id} className="grid gap-1.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {field.label}
                        {field.required ? " *" : ""}
                      </span>
                      <Select
                        value={columnMapping[field.id] || noPayoutColumnSelectValue}
                        onValueChange={(value) => handleMappingChange(field.id, value)}
                        disabled={isSaving || isParsing}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecionar coluna" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={noPayoutColumnSelectValue}>Não usar</SelectItem>
                          {headers.map((header) => (
                            <SelectItem key={`${field.id}-${header}`} value={header}>
                              {header}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border bg-muted/30 p-3">
                <DetailItem label="Linhas lidas" value={formatNumber(rawRows.length)} />
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <DetailItem label="Repasses válidos" value={formatNumber(payouts.length)} />
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <DetailItem label="Com pedido" value={formatNumber(matchedPayoutCount)} />
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <DetailItem label="Líquido arquivo" value={formatCurrency(netAmount)} />
              </div>
            </div>

            <div className="rounded-lg border">
              <div className="flex flex-col gap-1 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Prévia</p>
                  <p className="text-xs text-muted-foreground">
                    {fileName || "Nenhum arquivo selecionado"}
                    {invalidRows > 0 ? `, ${formatNumber(invalidRows)} linha(s) ignorada(s)` : ""}
                  </p>
                </div>
                {isParsing ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
              </div>

              {mappingMissingMessage ? (
                <div className="p-3">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    {mappingMissingMessage}
                  </div>
                </div>
              ) : previewRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pedido</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead className="text-right">Bruto</TableHead>
                        <TableHead className="text-right">Taxas</TableHead>
                        <TableHead className="text-right">Frete</TableHead>
                        <TableHead className="text-right">Líquido</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewRows.map((payout) => {
                        const matched = orderKeySet.has(normalizeConciliationPayoutOrderKey(payout.orderKey));

                        return (
                          <TableRow key={payout.id}>
                            <TableCell className="font-medium">{payout.orderKey}</TableCell>
                            <TableCell>{formatDateTime(payout.paidAt)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(payout.grossAmount)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(payout.feeAmount)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(payout.shippingAmount)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(payout.netAmount)}</TableCell>
                            <TableCell>
                              {matched ? (
                                <Badge className="whitespace-nowrap">Pedido encontrado</Badge>
                              ) : (
                                <Badge variant="outline" className="whitespace-nowrap">Sem pedido</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyDetailState>
                  {hasFileRows
                    ? "Nenhuma linha válida encontrada para o mapeamento atual."
                    : "Selecione um arquivo de repasse para visualizar as primeiras linhas."}
                </EmptyDetailState>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving || isParsing}>
            Fechar
          </Button>
          <Button type="button" onClick={handleSave} disabled={payouts.length === 0 || isSaving || isParsing}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Importar {payouts.length > 0 ? formatNumber(payouts.length) : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const PayoutHistoryDialog = ({
  open,
  onOpenChange,
  groups,
  orderKeySet,
  isSaving,
  onDeleteImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: PayoutImportGroup[];
  orderKeySet: Set<string>;
  isSaving: boolean;
  onDeleteImport: (group: PayoutImportGroup) => void;
}) => {
  const totalLines = groups.reduce((total, group) => total + group.payouts.length, 0);
  const totalMatched = groups.reduce((total, group) => total + group.matchedCount, 0);
  const totalOrphan = groups.reduce((total, group) => total + group.orphanCount, 0);
  const totalNetAmount = groups.reduce((total, group) => total + group.netAmount, 0);
  const orphanRows = React.useMemo(
    () =>
      groups.flatMap((group) =>
        group.payouts
          .filter((payout) => !orderKeySet.has(normalizeConciliationPayoutOrderKey(payout.orderKey)))
          .map((payout) => ({ group, payout }))
      ),
    [groups, orderKeySet]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Repasses Importados</DialogTitle>
          <DialogDescription>
            Consulte lotes importados, linhas sem pedido encontrado e desfaça importações quando necessário.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border bg-muted/30 p-3">
            <DetailItem label="Importações" value={formatNumber(groups.length)} />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <DetailItem label="Linhas importadas" value={formatNumber(totalLines)} />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <DetailItem label="Com pedido" value={formatNumber(totalMatched)} />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <DetailItem label="Líquido importado" value={formatCurrency(totalNetAmount)} />
          </div>
        </div>

        <Tabs defaultValue="imports" className="mt-2">
          <TabsList>
            <TabsTrigger value="imports">Importações</TabsTrigger>
            <TabsTrigger value="orphans">Linhas sem pedido ({formatNumber(totalOrphan)})</TabsTrigger>
          </TabsList>

          <TabsContent value="imports" className="mt-4">
            {groups.length > 0 ? (
              <ScrollArea className="h-[46vh] rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Arquivo</TableHead>
                      <TableHead>Marketplace</TableHead>
                      <TableHead>Importado em</TableHead>
                      <TableHead className="text-right">Linhas</TableHead>
                      <TableHead className="text-right">Com pedido</TableHead>
                      <TableHead className="text-right">Sem pedido</TableHead>
                      <TableHead className="text-right">Líquido</TableHead>
                      <TableHead className="text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((group) => (
                      <TableRow key={group.id}>
                        <TableCell>
                          <div className="max-w-72">
                            <p className="truncate font-medium">{group.sourceFileName}</p>
                            <p className="text-xs text-muted-foreground">{formatActor(group.importedBy)}</p>
                          </div>
                        </TableCell>
                        <TableCell>{group.marketplace}</TableCell>
                        <TableCell>{formatDateTime(group.importedAt)}</TableCell>
                        <TableCell className="text-right">{formatNumber(group.payouts.length)}</TableCell>
                        <TableCell className="text-right">{formatNumber(group.matchedCount)}</TableCell>
                        <TableCell className="text-right">
                          {group.orphanCount > 0 ? (
                            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                              {formatNumber(group.orphanCount)}
                            </Badge>
                          ) : (
                            formatNumber(0)
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(group.netAmount)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onDeleteImport(group)}
                            disabled={isSaving}
                          >
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                            Desfazer
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : (
              <EmptyDetailState>Nenhuma importação de repasse registrada.</EmptyDetailState>
            )}
          </TabsContent>

          <TabsContent value="orphans" className="mt-4">
            {orphanRows.length > 0 ? (
              <ScrollArea className="h-[46vh] rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pedido do arquivo</TableHead>
                      <TableHead>Arquivo</TableHead>
                      <TableHead>Marketplace</TableHead>
                      <TableHead>Data repasse</TableHead>
                      <TableHead className="text-right">Líquido</TableHead>
                      <TableHead>Importação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orphanRows.map(({ group, payout }) => (
                      <TableRow key={payout.id}>
                        <TableCell className="font-medium">{payout.orderKey}</TableCell>
                        <TableCell>
                          <div className="max-w-60">
                            <p className="truncate">{payout.sourceFileName}</p>
                            <p className="text-xs text-muted-foreground">Linha {formatNumber(payout.sourceRow)}</p>
                          </div>
                        </TableCell>
                        <TableCell>{payout.marketplace}</TableCell>
                        <TableCell>{formatDateTime(payout.paidAt)}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(payout.netAmount)}</TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <p>{formatDateTime(group.importedAt)}</p>
                            <p className="text-xs text-muted-foreground">{formatActor(group.importedBy)}</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : (
              <EmptyDetailState>Nenhuma linha órfã nas importações atuais.</EmptyDetailState>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const OrderDetailsDialog = ({
  order,
  onClose,
  isSaving,
  onSaveSystemStatus,
  onSaveFinancialAdjustments,
}: {
  order: ConciliationOrder | null;
  onClose: () => void;
  isSaving: boolean;
  onSaveSystemStatus: (order: ConciliationOrder, manualSystemStatus: ConciliationSystemStatus | null) => void;
  onSaveFinancialAdjustments: (order: ConciliationOrder, adjustments: ConciliationFinancialAdjustmentInput[]) => void;
}) => {
  const [systemStatusValue, setSystemStatusValue] = React.useState<SystemStatusSelectValue>(automaticStatusSelectValue);
  const [activeDetailTab, setActiveDetailTab] = React.useState("geral");
  const [financialAdjustmentDraft, setFinancialAdjustmentDraft] = React.useState<FinancialAdjustmentDraft>(() =>
    financialAdjustmentFields.reduce((draft, field) => {
      draft[field.id] = { value: "", reason: "" };
      return draft;
    }, {} as FinancialAdjustmentDraft)
  );

  React.useEffect(() => {
    setSystemStatusValue(order?.manualSystemStatus ?? automaticStatusSelectValue);
    setActiveDetailTab("geral");
    setFinancialAdjustmentDraft(
      financialAdjustmentFields.reduce((draft, field) => {
        const adjustment = order?.financialAdjustments[field.id];
        draft[field.id] = {
          value: adjustment?.active ? formatCurrencyInput(adjustment.adjustedValue) : "",
          reason: adjustment?.reason || "",
        };
        return draft;
      }, {} as FinancialAdjustmentDraft)
    );
  }, [order?.id, order?.manualSystemStatus, order?.financialAdjustments]);

  if (!order) return null;

  const original = order.originalOrder;
  const originalRecord = original as unknown as Record<string, unknown>;
  const deliveryAddress = original.transporte?.etiqueta;
  const volumes = original.transporte?.volumes || [];
  const returnRecords = [
    originalRecord.devolucoes,
    originalRecord.devolutions,
    originalRecord.returns,
    originalRecord.operationalReturns,
  ].find(Array.isArray) as unknown[] | undefined;
  const hasObservations = Boolean(original.observacoes || original.observacoesInternas);
  const selectedManualSystemStatus =
    systemStatusValue === automaticStatusSelectValue ? null : systemStatusValue;
  const hasSystemStatusChanges = selectedManualSystemStatus !== order.manualSystemStatus;
  const auditEvents = buildConciliationAuditEvents(order);
  const hasFinancialWarning = order.financialDivergence.severity !== "ok";
  const hasPayoutWarning = order.payoutComparison.status !== "matched";
  const financialAdjustmentRows = financialAdjustmentFields.map((field) => {
    const adjustment = order.financialAdjustments[field.id];
    const draft = financialAdjustmentDraft[field.id] || { value: "", reason: "" };
    const originalValue = adjustment?.active ? adjustment.originalValue : order[field.id];
    const appliedValue = order[field.id];
    const hasDraftValue = draft.value.trim() !== "";
    const draftReason = draft.reason.trim();
    const parsedValue = hasDraftValue ? parseCurrencyInput(draft.value) : null;
    const isValueInvalid = hasDraftValue && parsedValue === null;
    const shouldActivate =
      hasDraftValue && parsedValue !== null && Math.abs(parsedValue - originalValue) > 0.004;
    const isReasonMissing = shouldActivate && draftReason === "";
    const nextAdjustedValue = shouldActivate ? parsedValue : null;
    const currentAdjustedValue = adjustment?.active ? adjustment.adjustedValue : null;
    const valueChanged =
      shouldActivate || adjustment?.active
        ? Math.abs((nextAdjustedValue || 0) - (currentAdjustedValue || 0)) > 0.004 ||
          Boolean(shouldActivate) !== Boolean(adjustment?.active)
        : false;
    const reasonChanged =
      Boolean(shouldActivate || adjustment?.active) && draftReason !== (adjustment?.reason || "");

    return {
      ...field,
      adjustment,
      originalValue,
      appliedValue,
      draft,
      draftReason,
      parsedValue,
      isInvalid: isValueInvalid || isReasonMissing,
      isValueInvalid,
      isReasonMissing,
      shouldActivate,
      nextAdjustedValue,
      hasChanged: valueChanged || reasonChanged,
    };
  });
  const hasInvalidFinancialAdjustment = financialAdjustmentRows.some((row) => row.isInvalid);
  const hasFinancialAdjustmentChanges = financialAdjustmentRows.some((row) => row.hasChanged);
  const activeFinancialAdjustmentCount = financialAdjustmentRows.filter((row) => row.adjustment?.active).length;
  const hasFinancialAdjustments = activeFinancialAdjustmentCount > 0;

  const updateFinancialAdjustmentDraft = (
    fieldId: ConciliationFinancialAdjustmentFieldId,
    key: "value" | "reason",
    value: string
  ) => {
    setFinancialAdjustmentDraft((current) => ({
      ...current,
      [fieldId]: {
        ...(current[fieldId] || { value: "", reason: "" }),
        [key]: value,
      },
    }));
  };

  const clearFinancialAdjustmentDraft = (fieldId: ConciliationFinancialAdjustmentFieldId) => {
    setFinancialAdjustmentDraft((current) => ({
      ...current,
      [fieldId]: { value: "", reason: "" },
    }));
  };

  const handleSaveFinancialAdjustmentDrafts = () => {
    if (hasInvalidFinancialAdjustment) return;

    const inputs: ConciliationFinancialAdjustmentInput[] = financialAdjustmentRows.map((row) => ({
      fieldId: row.id,
      label: row.label,
      originalValue: row.originalValue,
      adjustedValue: row.nextAdjustedValue,
      reason: row.shouldActivate ? row.draftReason : "",
      active: row.shouldActivate,
    }));

    onSaveFinancialAdjustments(order, inputs);
  };

  return (
    <Dialog open={Boolean(order)} onOpenChange={onClose}>
      <DialogContent className="flex h-[90vh] w-[95vw] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pb-2 pt-6">
          <DialogTitle className="text-xl">Detalhes do Pedido: #{order.number || order.orderId}</DialogTitle>
          <DialogDescription>
            Pedido {order.storeNumber} em {order.marketplace}
          </DialogDescription>

          {order.isReconciled ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              <span className="flex items-center gap-1 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                Conciliado
              </span>
              {order.conciliation?.reconciledAt ? (
                <span>
                  em <strong>{formatDateTime(order.conciliation.reconciledAt)}</strong>
                </span>
              ) : null}
              {order.conciliation?.reconciledBy ? (
                <span>
                  por <strong>{formatActor(order.conciliation.reconciledBy)}</strong>
                </span>
              ) : null}
            </div>
          ) : null}

          {hasFinancialWarning || hasPayoutWarning || hasFinancialAdjustments ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {hasFinancialWarning ? (
                <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    {order.financialDivergence.label}: {formatCurrency(order.financialDivergence.riskAmount)}
                  </span>
                </div>
              ) : null}
              {hasPayoutWarning ? (
                <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                  <Wallet className="h-4 w-4 shrink-0" />
                  <span>
                    {order.payoutComparison.label}: {formatCurrency(order.payoutComparison.differenceAmount)}
                  </span>
                </div>
              ) : null}
              {hasFinancialAdjustments ? (
                <div
                  className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900"
                  title={getFinancialAdjustmentSummary(order)}
                >
                  <Banknote className="h-4 w-4 shrink-0" />
                  <span>{formatNumber(activeFinancialAdjustmentCount)} ajuste(s) financeiro(s) manual(is)</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogHeader>

        <div className="flex-1 overflow-hidden px-6 pb-2">
          <Tabs value={activeDetailTab} onValueChange={setActiveDetailTab} className="flex h-full flex-col">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-6">
              <TabsTrigger value="geral" className="px-2 text-xs leading-tight">Geral</TabsTrigger>
              <TabsTrigger value="cliente" className="px-2 text-xs leading-tight">Cliente</TabsTrigger>
	              <TabsTrigger value="itens" className="px-2 text-xs leading-tight">Itens</TabsTrigger>
	              <TabsTrigger value="financeiro" className="px-2 text-xs leading-tight">Financeiro</TabsTrigger>
	              <TabsTrigger value="calculos" className="px-2 text-xs leading-tight">Cálculos</TabsTrigger>
	              <TabsTrigger value="repasse" className="px-2 text-xs leading-tight">Repasse</TabsTrigger>
              <TabsTrigger value="transporte" className="px-2 text-xs leading-tight">Transporte</TabsTrigger>
              <TabsTrigger value="observacoes" className="px-2 text-xs leading-tight">Observações</TabsTrigger>
              <TabsTrigger value="marketplace" className="px-2 text-xs leading-tight">Marketplace</TabsTrigger>
              <TabsTrigger value="devolucoes" className="px-2 text-xs leading-tight">Devoluções</TabsTrigger>
              <TabsTrigger value="historico" className="px-2 text-xs leading-tight">Histórico</TabsTrigger>
              <TabsTrigger value="sistema" className="px-2 text-xs leading-tight">Sistema</TabsTrigger>
            </TabsList>

            <ScrollArea className="mt-4 flex-1 pr-2">
            <TabsContent value="geral" className="mt-0">
              <DetailCard title="Informações Gerais" icon={FileText}>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <DetailItem label="Pedido Bling" value={order.number || order.orderId} />
                <DetailItem label="Pedido loja" value={order.storeNumber} />
                <DetailItem label="Data" value={formatDate(order.date)} />
                <DetailItem label="Conta" value={order.accountName} />
                <DetailItem label="Marketplace" value={order.marketplace} />
                <DetailItem label="Status" value={<Badge variant={getStatusVariant(order.statusName)}>{order.statusName}</Badge>} />
                <DetailItem
                  label="Status sistema"
                  value={<Badge variant={getSystemStatusVariant(order.systemStatus)}>{order.systemStatus}</Badge>}
                />
                <DetailItem
                  label="Conciliação"
                  value={
                    order.isReconciled ? (
                      <Badge className="gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Conciliado
                      </Badge>
                    ) : (
                      <Badge variant="outline">Pendente</Badge>
                    )
                  }
                />
                <DetailItem
                  label="Sugestão"
                  value={<ConciliationSuggestionBadge order={order} />}
                />
                <DetailItem
                  label="Alerta financeiro"
                  value={<FinancialDivergenceBadge divergence={order.financialDivergence} compact />}
                />
                <DetailItem
                  label="Repasse"
                  value={<PayoutComparisonBadge order={order} compact />}
                />
	                <DetailItem
	                  label="Ajustes financeiros"
	                  value={<FinancialAdjustmentsBadge order={order} />}
	                />
	                <DetailItem
	                  label="Cálculos"
	                  value={<CalculatedColumnsBadge order={order} />}
	                />
	                <DetailItem label="Conciliado em" value={formatDateTime(order.conciliation?.reconciledAt)} />
                <DetailItem label="Conciliado por" value={formatActor(order.conciliation?.reconciledBy ?? null)} />
                <DetailItem label="Nota fiscal" value={original.notaFiscal?.numero || original.notaFiscal?.id} />
                </div>
              </DetailCard>
            </TabsContent>

            <TabsContent value="cliente" className="mt-0">
              <DetailCard title="Informações do Cliente" icon={User}>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <DetailItem label="Nome" value={original.contato?.nome} />
                  <DetailItem label="Documento" value={original.contato?.numeroDocumento} />
                  <DetailItem label="Tipo pessoa" value={original.contato?.tipoPessoa} />
                </div>
              </DetailCard>
            </TabsContent>

            <TabsContent value="itens" className="mt-0 space-y-3">
              <DetailCard title="Itens do Pedido" icon={Package}>
                {order.items.length > 0 ? (
                  <div className="space-y-3">
                    {order.items.map((item) => (
                      <div key={item.id} className="rounded-lg border bg-white p-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="font-medium leading-snug">{item.description}</p>
                            <p className="mt-1 text-xs text-muted-foreground">SKU: {item.sku}</p>
                          </div>
                          <div className="grid grid-cols-3 gap-4 text-right text-sm sm:min-w-64">
                            <DetailItem label="Qtd" value={formatNumber(item.quantity)} />
                            <DetailItem label="Unitário" value={formatCurrency(item.unitValue)} />
                            <DetailItem label="Total" value={formatCurrency(item.grossValue)} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyDetailState>Pedido sem itens registrados.</EmptyDetailState>
                )}
              </DetailCard>
            </TabsContent>

            <TabsContent value="financeiro" className="mt-0 space-y-5">
              <DetailCard title="Informações Financeiras" icon={Banknote}>
                <div className="rounded-lg border bg-muted/20 p-4">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h4 className="text-sm font-semibold">Divergência financeira</h4>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Regras aplicadas sobre os valores disponíveis no pedido.
                    </p>
                  </div>
                  <FinancialDivergenceBadge divergence={order.financialDivergence} compact />
                </div>
                <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <DetailItem label="Total esperado" value={formatCurrency(order.financialDivergence.expectedGrossRevenue)} />
                  <DetailItem label="Diferença bruto" value={formatCurrency(order.financialDivergence.grossRevenueDifference)} />
                  <DetailItem label="Cobertura deduções" value={formatPercentage(order.financialDivergence.deductionCoveragePercentage)} />
                  <DetailItem label="Risco estimado" value={formatCurrency(order.financialDivergence.riskAmount)} />
                </div>
                <FinancialDivergenceReasons divergence={order.financialDivergence} />
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <DetailItem label="Faturamento bruto" value={formatCurrency(order.grossRevenue)} />
                <DetailItem label="Produtos" value={formatCurrency(order.productRevenue)} />
                <DetailItem label="Frete cliente" value={formatCurrency(order.customerShippingRevenue)} />
                <DetailItem label="Desconto" value={formatCurrency(order.discountAmount)} />
                <DetailItem label="Outras despesas" value={formatCurrency(order.otherExpenses)} />
                <DetailItem label="Líquido estimado" value={formatCurrency(order.netRevenue)} />
                <DetailItem label="Custo produto" value={formatCurrency(order.productCost)} />
                <DetailItem label="Frete custo" value={formatCurrency(order.shippingCost)} />
                <DetailItem label="Comissão" value={formatCurrency(order.commissionFee)} />
                <DetailItem label="Impostos" value={formatCurrency(order.taxes)} />
                <DetailItem label="Margem" value={formatCurrency(order.contributionMargin)} />
                <DetailItem label="Margem %" value={formatPercentage(order.contributionMarginPercentage)} />
                </div>

                <Separator className="my-5" />

                <div className="space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h4 className="text-sm font-semibold">Ajustes manuais</h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Corrija campos financeiros de origem e informe o motivo da alteração.
                      </p>
                    </div>
                    <Badge variant={activeFinancialAdjustmentCount > 0 ? "default" : "outline"} className="w-fit">
                      {formatNumber(activeFinancialAdjustmentCount)} ativo(s)
                    </Badge>
                  </div>

                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Campo</TableHead>
                          <TableHead className="text-right">Original</TableHead>
                          <TableHead className="text-right">Aplicado</TableHead>
                          <TableHead>Correção</TableHead>
                          <TableHead>Motivo</TableHead>
                          <TableHead className="text-right">Ação</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {financialAdjustmentRows.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium">{row.label}</p>
                                <p className="text-xs text-muted-foreground">{row.helper}</p>
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right">
                              {formatCurrency(row.originalValue)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right font-medium">
                              {formatCurrency(row.appliedValue)}
                            </TableCell>
                            <TableCell className="min-w-36">
                              <Input
                                inputMode="decimal"
                                value={row.draft.value}
                                placeholder={formatCurrencyInput(row.originalValue)}
                                onChange={(event) => updateFinancialAdjustmentDraft(row.id, "value", event.target.value)}
                                className={cn(row.isValueInvalid && "border-red-300 focus-visible:ring-red-300")}
                              />
                              {row.isValueInvalid ? (
                                <p className="mt-1 text-xs text-red-600">Valor inválido.</p>
                              ) : null}
                            </TableCell>
                            <TableCell className="min-w-52">
                              <Input
                                value={row.draft.reason}
                                placeholder="Motivo da correção"
                                onChange={(event) => updateFinancialAdjustmentDraft(row.id, "reason", event.target.value)}
                                className={cn(row.isReasonMissing && "border-red-300 focus-visible:ring-red-300")}
                              />
                              {row.isReasonMissing ? (
                                <p className="mt-1 text-xs text-red-600">Informe o motivo do ajuste.</p>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => clearFinancialAdjustmentDraft(row.id)}
                                disabled={isSaving || (!row.draft.value && !row.draft.reason)}
                              >
                                Limpar
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                      Líquido, margem e alertas serão recalculados após salvar.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSaveFinancialAdjustmentDrafts}
                      disabled={!hasFinancialAdjustmentChanges || hasInvalidFinancialAdjustment || isSaving}
                    >
                      {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Salvar ajustes
                    </Button>
                  </div>
                </div>

                {original.parcelas?.length ? (
                  <>
                    <Separator className="my-5" />
                    <div>
                      <h4 className="mb-3 text-sm font-semibold">Parcelas</h4>
                      <div className="space-y-2">
                        {original.parcelas.map((parcel) => (
                          <div key={parcel.id} className="flex items-center justify-between rounded-lg bg-muted/40 p-3 text-sm">
                            <span>Vencimento: {formatDate(parcel.dataVencimento)}</span>
                            <span className="font-medium">{formatCurrency(parcel.valor)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
              </DetailCard>
	            </TabsContent>

	            <TabsContent value="calculos" className="mt-0">
	              <DetailCard title="Colunas Calculadas" icon={Calculator}>
	                {getOrderCalculationValues(order).length > 0 ? (
	                  <div className="space-y-3">
	                    {getOrderCalculationValues(order).map((calculation) => (
	                      <div
	                        key={calculation.id}
	                        className={cn(
	                          "rounded-lg border p-4",
	                          calculation.error ? "border-red-200 bg-red-50" : "bg-muted/20"
	                        )}
	                      >
	                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
	                          <div className="min-w-0">
	                            <p className="font-medium">{calculation.name}</p>
	                            {calculation.description ? (
	                              <p className="mt-1 text-xs text-muted-foreground">{calculation.description}</p>
	                            ) : null}
	                            <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">
	                              {calculation.expression}
	                            </p>
	                          </div>
	                          <div className="text-left sm:text-right">
	                            {calculation.error ? (
	                              <Badge variant="destructive">Erro</Badge>
	                            ) : (
	                              <p className="text-lg font-semibold">
	                                {formatCalculationValue(calculation.value, calculation.isPercentage)}
	                              </p>
	                            )}
	                            {calculation.error ? (
	                              <p className="mt-2 max-w-sm text-xs text-red-700">{calculation.error}</p>
	                            ) : null}
	                          </div>
	                        </div>
	                      </div>
	                    ))}
	                  </div>
	                ) : (
	                  <EmptyDetailState>Nenhuma coluna calculada configurada para este pedido.</EmptyDetailState>
	                )}
	              </DetailCard>
	            </TabsContent>

	            <TabsContent value="repasse" className="mt-0 space-y-5">
              <DetailCard title="Comparação de Repasse" icon={Wallet}>
                <div className="rounded-lg border bg-muted/20 p-4">
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h4 className="text-sm font-semibold">Resumo do repasse</h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Comparação entre o líquido estimado do pedido e as linhas importadas do marketplace.
                      </p>
                    </div>
                    <PayoutComparisonBadge order={order} compact />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    <DetailItem label="Líquido esperado" value={formatCurrency(order.payoutComparison.expectedNetAmount)} />
                    <DetailItem label="Líquido repassado" value={formatCurrency(order.payoutComparison.paidNetAmount)} />
                    <DetailItem label="Diferença" value={formatCurrency(order.payoutComparison.differenceAmount)} />
                    <DetailItem label="Tolerância" value={formatCurrency(order.payoutComparison.toleranceAmount)} />
                    <DetailItem label="Linhas" value={formatNumber(order.payoutComparison.payoutCount)} />
                  </div>
                </div>

                {order.marketplacePayouts.length > 0 ? (
                  <div className="mt-5 overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Pedido</TableHead>
                          <TableHead>Arquivo</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead className="text-right">Bruto</TableHead>
                          <TableHead className="text-right">Taxas</TableHead>
                          <TableHead className="text-right">Frete</TableHead>
                          <TableHead className="text-right">Líquido</TableHead>
                          <TableHead>Importado por</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {order.marketplacePayouts.map((payout) => (
                          <TableRow key={payout.id}>
                            <TableCell className="font-medium">{payout.orderKey}</TableCell>
                            <TableCell>
                              <div className="max-w-56">
                                <p className="truncate">{payout.sourceFileName}</p>
                                <p className="text-xs text-muted-foreground">Linha {formatNumber(payout.sourceRow)}</p>
                              </div>
                            </TableCell>
                            <TableCell>{formatDateTime(payout.paidAt)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(payout.grossAmount)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(payout.feeAmount)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(payout.shippingAmount)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(payout.netAmount)}</TableCell>
                            <TableCell>
                              <div className="text-sm">
                                <p>{formatActor(payout.importedBy)}</p>
                                <p className="text-xs text-muted-foreground">{formatDateTime(payout.importedAt)}</p>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="mt-5">
                    <EmptyDetailState>Nenhuma linha de repasse importada para este pedido.</EmptyDetailState>
                  </div>
                )}
              </DetailCard>
            </TabsContent>

            <TabsContent value="transporte" className="mt-0 space-y-5">
              <DetailCard title="Transporte e Entrega" icon={Truck}>
                {original.transporte ? (
                  <div className="space-y-5">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <DetailItem
                      label="Frete por conta"
                      value={original.transporte.fretePorConta === 1 ? "Destinatário" : "Emitente"}
                    />
                    <DetailItem label="Transportadora" value={original.transporte.contato?.nome} />
                    <DetailItem label="Frete cliente" value={formatCurrency(original.transporte.frete)} />
                    <DetailItem label="Custo frete" value={formatCurrency(order.shippingCost)} />
                    <DetailItem label="Volumes" value={formatNumber(original.transporte.quantidadeVolumes)} />
                    <DetailItem label="Peso bruto" value={`${formatNumber(original.transporte.pesoBruto)} kg`} />
                    <DetailItem label="Prazo entrega" value={`${formatNumber(original.transporte.prazoEntrega)} dia(s)`} />
                    <DetailItem label="Rastreamento" value={volumes[0]?.codigoRastreamento} />
                    </div>

                    {deliveryAddress ? (
                      <div className="rounded-lg border bg-muted/30 p-4">
                        <h4 className="mb-3 text-sm font-semibold">Endereço de entrega</h4>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          <DetailItem label="Nome" value={deliveryAddress.nome} />
                          <DetailItem label="Endereço" value={`${deliveryAddress.endereco}, ${deliveryAddress.numero}`} />
                          <DetailItem label="Complemento" value={deliveryAddress.complemento} />
                          <DetailItem label="Bairro" value={deliveryAddress.bairro} />
                          <DetailItem label="Cidade/UF" value={`${deliveryAddress.municipio}/${deliveryAddress.uf}`} />
                          <DetailItem label="CEP" value={deliveryAddress.cep} />
                        </div>
                      </div>
                    ) : null}

                    {volumes.length > 0 ? (
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold">Volumes</h4>
                        {volumes.map((volume) => (
                          <div key={volume.id} className="grid gap-3 rounded-lg border bg-white p-3 sm:grid-cols-3">
                            <DetailItem label="Serviço" value={volume.servico} />
                            <DetailItem label="Código rastreio" value={volume.codigoRastreamento} />
                            <DetailItem label="ID volume" value={volume.id} />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <EmptyDetailState>Pedido sem dados de transporte.</EmptyDetailState>
                )}
              </DetailCard>
            </TabsContent>

            <TabsContent value="observacoes" className="mt-0 space-y-4">
              <DetailCard title="Observações" icon={FileSearch}>
                {hasObservations ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border bg-white p-4">
                      <DetailItem
                        label="Observações do pedido"
                        value={<pre className="whitespace-pre-wrap font-sans text-sm">{original.observacoes}</pre>}
                      />
                    </div>
                    <div className="rounded-lg border bg-white p-4">
                      <DetailItem
                        label="Observações internas"
                        value={<pre className="whitespace-pre-wrap font-sans text-sm">{original.observacoesInternas}</pre>}
                      />
                    </div>
                  </div>
                ) : (
                  <EmptyDetailState>Pedido sem observações registradas.</EmptyDetailState>
                )}
              </DetailCard>
            </TabsContent>

            <TabsContent value="marketplace" className="mt-0 space-y-5">
              <DetailCard title="Dados do Marketplace" icon={Files}>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <DetailItem label="Marketplace" value={order.marketplace} />
                  <DetailItem label="Intermediador" value={original.intermediador?.nomeUsuario} />
                  <DetailItem label="CNPJ intermediador" value={original.intermediador?.cnpj} />
                  <DetailItem label="Pedido loja" value={order.storeNumber} />
                  <DetailItem label="Pedido compra" value={original.numeroPedidoCompra} />
                  <DetailItem label="Pedido loja NF" value={original.notaFiscal?.numeroPedidoLoja} />
                  <DetailItem label="Valor base taxa" value={formatCurrency(original.taxas?.valorBase)} />
                  <DetailItem label="Taxa comissão" value={formatCurrency(original.taxas?.taxaComissao)} />
                  <DetailItem label="Custo frete" value={formatCurrency(original.taxas?.custoFrete)} />
                  <DetailItem label="Rastreamento" value={volumes[0]?.codigoRastreamento} />
                </div>

                <Separator className="my-5" />

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <DetailItem label="Nota fiscal" value={original.notaFiscal?.numero || original.notaFiscal?.id} />
                  <DetailItem label="Chave acesso" value={original.notaFiscal?.chaveAcesso} />
                  <DetailItem label="Data emissão NF" value={formatDate(original.notaFiscal?.dataEmissao)} />
                  <DetailItem label="Valor NF" value={formatCurrency(original.notaFiscal?.valorNota)} />
                  <DetailItem label="Frete NF" value={formatCurrency(original.notaFiscal?.valorFrete)} />
                  <DetailItem label="XML disponível" value={original.notaFiscal?.xmlAvailable ? "Sim" : "Não"} />
                  <DetailItem label="Detalhes fiscais" value={original.notaFiscal?.hasFiscalDetails ? "Sim" : "Não"} />
                  <DetailItem label="Erro fiscal" value={original.notaFiscal?.fiscalDetailsError || original.notaFiscal?.xmlFetchError} />
                </div>
              </DetailCard>
            </TabsContent>

            <TabsContent value="devolucoes" className="mt-0 space-y-3">
              <DetailCard title="Devoluções" icon={Undo2}>
                {returnRecords && returnRecords.length > 0 ? (
                  <div className="space-y-3">
                    {returnRecords.map((returnRecord, index) => (
                      <div key={index} className="rounded-lg border bg-white p-4">
                        <DetailItem
                          label={`Registro ${index + 1}`}
                          value={<pre className="whitespace-pre-wrap font-mono text-xs">{JSON.stringify(returnRecord, null, 2)}</pre>}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyDetailState>Nenhuma devolução registrada para este pedido.</EmptyDetailState>
                )}
              </DetailCard>
            </TabsContent>

            <TabsContent value="historico" className="mt-0 space-y-4">
              <DetailCard title="Histórico da Conciliação" icon={History}>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <DetailItem label="Eventos" value={formatNumber(auditEvents.length)} />
                  <DetailItem label="Última ação" value={formatDateTime(auditEvents[0]?.at)} />
                  <DetailItem label="Último usuário" value={formatActor(auditEvents[0]?.actor ?? null)} />
                  <DetailItem
                    label="Status atual"
                    value={<Badge variant={getSystemStatusVariant(order.systemStatus)}>{order.systemStatus}</Badge>}
                  />
                </div>
                <div className="mt-5">
                  <AuditTimeline events={auditEvents} />
                </div>
              </DetailCard>
            </TabsContent>

            <TabsContent value="sistema" className="mt-0 space-y-5">
              <DetailCard title="Sistema" icon={SlidersHorizontal}>
                <div className="rounded-lg border bg-muted/30 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h4 className="text-sm font-semibold">Status de sistema</h4>
                      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <DetailItem label="Status pedido" value={order.statusName} />
                        <DetailItem label="Automático" value={order.automaticSystemStatus} />
                        <DetailItem
                          label="Aplicado"
                          value={<Badge variant={getSystemStatusVariant(order.systemStatus)}>{order.systemStatus}</Badge>}
                        />
                        <DetailItem
                          label="Origem"
                          value={order.manualSystemStatus ? <Badge variant="outline">Manual</Badge> : <Badge variant="secondary">Automático</Badge>}
                        />
                      </div>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:w-72">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Definição manual</p>
                      <Select
                        value={systemStatusValue}
                        onValueChange={(value) => setSystemStatusValue(value as SystemStatusSelectValue)}
                        disabled={isSaving}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Status de sistema" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={automaticStatusSelectValue}>
                            Automático ({order.automaticSystemStatus})
                          </SelectItem>
                          {conciliationSystemStatusOptions.map((statusOption) => (
                            <SelectItem key={statusOption} value={statusOption}>
                              {statusOption}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => onSaveSystemStatus(order, selectedManualSystemStatus)}
                        disabled={!hasSystemStatusChanges || isSaving}
                      >
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Salvar status
                      </Button>
                    </div>
                  </div>
                  <Separator className="my-4" />
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <DetailItem label="Status alterado em" value={formatDateTime(order.conciliation?.systemStatusUpdatedAt)} />
                    <DetailItem label="Status alterado por" value={formatActor(order.conciliation?.systemStatusUpdatedBy ?? null)} />
                    <DetailItem label="Atualizado em" value={formatDateTime(order.conciliation?.updatedAt)} />
                    <DetailItem label="Atualizado por" value={formatActor(order.conciliation?.updatedBy ?? null)} />
                  </div>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <DetailItem label="ID interno" value={order.orderId} />
                  <DetailItem label="Loja Bling" value={original.loja?.nome} />
                  <DetailItem label="Vendedor" value={original.vendedor?.nome} />
                  <DetailItem label="Intermediador" value={original.intermediador?.nomeUsuario} />
                  <DetailItem label="Rastreamento" value={original.transporte?.volumes?.[0]?.codigoRastreamento} />
                  <DetailItem label="Transportadora" value={original.transporte?.contato?.nome} />
                </div>
              </DetailCard>
            </TabsContent>
            </ScrollArea>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default function ConciliacaoClient() {
  const { toast } = useToast();
  const [baseOrders, setBaseOrders] = React.useState<ConciliationOrder[]>([]);
  const [conciliationRecords, setConciliationRecords] = React.useState<Map<string, ConciliationRecord>>(
    () => new Map()
  );
  const [payoutRecords, setPayoutRecords] = React.useState<ConciliationMarketplacePayout[]>([]);
  const [statusSettings, setStatusSettings] = React.useState<ConciliationStatusSettings>({
    statusMappings: {},
    updatedAt: null,
    updatedBy: null,
  });
  const [summarySettings, setSummarySettings] = React.useState<ConciliationSummarySettings>({
    metricIds: defaultConciliationSummaryMetricIds,
    updatedAt: null,
    updatedBy: null,
  });
  const [divergenceSettings, setDivergenceSettings] = React.useState<ConciliationDivergenceSettings>({
    ...defaultConciliationFinancialDivergenceRules,
    updatedAt: null,
    updatedBy: null,
  });
  const [calculationSettings, setCalculationSettings] = React.useState<ConciliationCalculationSettings>({
    calculations: [],
    updatedAt: null,
    updatedBy: null,
  });
  const [isOrdersLoading, setIsOrdersLoading] = React.useState(true);
  const [isRecordsLoading, setIsRecordsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isQueryApplying, setIsQueryApplying] = React.useState(false);
  const [isManualRefreshLoading, setIsManualRefreshLoading] = React.useState(false);
  const [isStatusSettingsOpen, setIsStatusSettingsOpen] = React.useState(false);
  const [isSummarySettingsOpen, setIsSummarySettingsOpen] = React.useState(false);
  const [isDivergenceSettingsOpen, setIsDivergenceSettingsOpen] = React.useState(false);
  const [isCalculationSettingsOpen, setIsCalculationSettingsOpen] = React.useState(false);
  const [isPayoutImportOpen, setIsPayoutImportOpen] = React.useState(false);
  const [isPayoutHistoryOpen, setIsPayoutHistoryOpen] = React.useState(false);
  const queryPreparationTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const sortFeedbackTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const columnMoveFeedbackTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [date, setDate] = React.useState<DateRange | undefined>(() => {
    const today = new Date();

    return {
      from: startOfMonth(today),
      to: today,
    };
  });
  const [marketplace, setMarketplace] = React.useState("Todos");
  const [account, setAccount] = React.useState("Todos");
  const [orderStatus, setOrderStatus] = React.useState("Todos");
  const [systemStatus, setSystemStatus] = React.useState<SystemStatusFilter>("Todos");
  const [financialAlert, setFinancialAlert] = React.useState<FinancialAlertFilter>("Todos");
  const [adjustmentStatus, setAdjustmentStatus] = React.useState<AdjustmentStatusFilter>("Todos");
  const [payoutStatus, setPayoutStatus] = React.useState<PayoutStatusFilter>("Todos");
  const [suggestion, setSuggestion] = React.useState<SuggestionFilter>("Todos");
  const [reconciliationStatus, setReconciliationStatus] = React.useState<ReconciliationStatusFilter>("Todos");
  const [searchTerm, setSearchTerm] = React.useState("");
  const [hasAppliedFilters, setHasAppliedFilters] = React.useState(false);
  const [lastAppliedAt, setLastAppliedAt] = React.useState<Date | null>(null);
  const [appliedFilters, setAppliedFilters] = React.useState<AppliedFilters>(() => {
    const today = new Date();

    return {
      date: {
        from: startOfMonth(today),
        to: today,
      },
      marketplace: "Todos",
      account: "Todos",
      orderStatus: "Todos",
      systemStatus: "Todos",
      financialAlert: "Todos",
      adjustmentStatus: "Todos",
      payoutStatus: "Todos",
      suggestion: "Todos",
      reconciliationStatus: "Todos",
      searchTerm: "",
    };
  });
  const [visibleColumnIds, setVisibleColumnIds] = React.useState<Set<ConciliationColumnId>>(() => {
    if (typeof window === "undefined") {
      return new Set(defaultVisibleColumnIds);
    }

    try {
      const stored = window.localStorage.getItem(visibleColumnsStorageKey);
      const parsed = stored ? JSON.parse(stored) : null;
      const selected = Array.isArray(parsed)
        ? parsed.filter((columnId): columnId is ConciliationColumnId => isConciliationColumnId(columnId))
        : [];

      return new Set(selected.length > 0 ? selected : defaultVisibleColumnIds);
    } catch {
      return new Set(defaultVisibleColumnIds);
    }
  });
  const [columnOrderIds, setColumnOrderIds] = React.useState<ConciliationColumnId[]>(() => {
    if (typeof window === "undefined") {
      return [...defaultColumnOrderIds];
    }

    try {
      const stored = window.localStorage.getItem(columnOrderStorageKey);
      const parsed = stored ? JSON.parse(stored) : null;

      return normalizeColumnOrderIds(parsed);
    } catch {
      return [...defaultColumnOrderIds];
    }
  });
  const [currentPage, setCurrentPage] = React.useState(1);
  const [rowsPerPage, setRowsPerPage] = React.useState(20);
  const [selectedOrder, setSelectedOrder] = React.useState<ConciliationOrder | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = React.useState<Set<string>>(() => new Set());
  const [expandedOrderIds, setExpandedOrderIds] = React.useState<Set<string>>(() => new Set());
  const [viewMode, setViewMode] = React.useState<ViewMode>(() => {
    if (typeof window === "undefined") return "table";

    const stored = window.localStorage.getItem(viewModeStorageKey);
    return stored === "cards" ? "cards" : "table";
  });
  const [tableDensity, setTableDensity] = React.useState<TableDensity>(() => {
    if (typeof window === "undefined") return "comfortable";

    const stored = window.localStorage.getItem(tableDensityStorageKey);
    return stored === "compact" ? "compact" : "comfortable";
  });
  const [sortConfig, setSortConfig] = React.useState<SortConfig>({
    columnId: "date",
    direction: "desc",
  });
  const [sortFeedback, setSortFeedback] = React.useState<SortFeedback | null>(null);
  const [columnMoveFeedback, setColumnMoveFeedback] = React.useState<ColumnMoveFeedback | null>(null);
  const [draggedColumnId, setDraggedColumnId] = React.useState<ConciliationColumnId | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = React.useState<ConciliationColumnId | null>(null);
  const knownCalculationColumnIdsRef = React.useRef<Set<ConciliationCalculationColumnId> | null>(null);

  if (knownCalculationColumnIdsRef.current === null) {
    const storedColumnIds = (() => {
      if (typeof window === "undefined") return [];

      try {
        const stored = window.localStorage.getItem(knownCalculationColumnsStorageKey);
        const parsed = stored ? JSON.parse(stored) : null;

        return Array.isArray(parsed)
          ? parsed.filter((columnId): columnId is ConciliationCalculationColumnId => isCalculationColumnId(columnId))
          : [];
      } catch {
        return [];
      }
    })();

    knownCalculationColumnIdsRef.current = new Set(storedColumnIds);
  }

  const calculationColumnOptions = React.useMemo(
    () => buildCalculationColumnOptions(calculationSettings.calculations),
    [calculationSettings.calculations]
  );
  const calculationColumnIds = React.useMemo(
    () => calculationColumnOptions.map((column) => column.id as ConciliationCalculationColumnId),
    [calculationColumnOptions]
  );
  const availableColumnOptions = React.useMemo<ConciliationColumnOption[]>(
    () => [...conciliationColumnOptions, ...calculationColumnOptions],
    [calculationColumnOptions]
  );
  const availableColumnIds = React.useMemo(
    () => availableColumnOptions.map((column) => column.id),
    [availableColumnOptions]
  );
  const availableColumnIdSet = React.useMemo(() => new Set(availableColumnIds), [availableColumnIds]);
  const availableColumnOptionById = React.useMemo(
    () => new Map(availableColumnOptions.map((column) => [column.id, column])),
    [availableColumnOptions]
  );

  const isLoading = isOrdersLoading || isRecordsLoading;
  const isQueryLoading = hasAppliedFilters && (isLoading || isQueryApplying);
  const allOrders = React.useMemo(() => {
    const statusMappedOrders = applyStatusMappings(baseOrders, statusSettings.statusMappings);
    const recordMappedOrders = applyConciliationRecords(statusMappedOrders, conciliationRecords);
    const divergenceMappedOrders = applyFinancialDivergenceRules(recordMappedOrders, divergenceSettings);
    const payoutMappedOrders = applyMarketplacePayouts(divergenceMappedOrders, payoutRecords);

    return applyCustomCalculationsToOrders(payoutMappedOrders, calculationSettings.calculations);
  }, [
    baseOrders,
    calculationSettings.calculations,
    conciliationRecords,
    divergenceSettings,
    payoutRecords,
    statusSettings.statusMappings,
  ]);

  React.useEffect(() => {
    setIsOrdersLoading(true);

    return subscribeConciliationOrders(
      (orders) => {
        setBaseOrders(orders);
        setIsOrdersLoading(false);
      },
      (error) => {
        console.error("Erro ao carregar pedidos para conciliacao:", error);
        setIsOrdersLoading(false);
        toast({
          variant: "destructive",
          title: "Erro ao carregar conciliação",
          description: "Não foi possível buscar os pedidos de venda.",
        });
      }
    );
  }, [toast]);

  React.useEffect(() => {
    let isMounted = true;

    setIsRecordsLoading(true);
    fetchConciliationState()
      .then((state) => {
        if (!isMounted) return;

        setConciliationRecords(state.records);
        setPayoutRecords(state.payouts);
        setStatusSettings(state.statusSettings);
        setSummarySettings(state.summarySettings);
        setDivergenceSettings(state.divergenceSettings);
        setCalculationSettings(state.calculationSettings);
      })
      .catch((error) => {
        console.error("Erro ao carregar sidecar de conciliacao:", error);
        if (!isMounted) return;
        toast({
          variant: "destructive",
          title: "Erro ao carregar marcações",
          description: error instanceof Error ? error.message : "Não foi possível carregar as marcações salvas.",
        });
      })
      .finally(() => {
        if (isMounted) setIsRecordsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [toast]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(visibleColumnsStorageKey, JSON.stringify(Array.from(visibleColumnIds)));
  }, [visibleColumnIds]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(columnOrderStorageKey, JSON.stringify(columnOrderIds));
  }, [columnOrderIds]);

  React.useEffect(() => {
    if (typeof window === "undefined" || isRecordsLoading) return;

    const knownColumnIds = knownCalculationColumnIdsRef.current ?? new Set<ConciliationCalculationColumnId>();
    const newColumnIds = calculationColumnIds.filter((columnId) => !knownColumnIds.has(columnId));

    if (newColumnIds.length > 0) {
      setVisibleColumnIds((previous) => {
        const next = new Set(previous);

        newColumnIds.forEach((columnId) => next.add(columnId));

        return next;
      });
    }

    calculationColumnIds.forEach((columnId) => knownColumnIds.add(columnId));
    knownCalculationColumnIdsRef.current = knownColumnIds;
    window.localStorage.setItem(knownCalculationColumnsStorageKey, JSON.stringify(Array.from(knownColumnIds)));
  }, [calculationColumnIds, isRecordsLoading]);

  React.useEffect(() => {
    if (isRecordsLoading) return;

    setColumnOrderIds((previous) => {
      const next = previous.filter((columnId) => isStaticConciliationColumnId(columnId) || availableColumnIdSet.has(columnId));

      defaultColumnOrderIds.forEach((columnId) => {
        if (!next.includes(columnId)) {
          next.push(columnId);
        }
      });

      const missingCalculationColumnIds = calculationColumnIds.filter((columnId) => !next.includes(columnId));

      if (missingCalculationColumnIds.length > 0) {
        const baseIndex = next.indexOf("calculatedColumns");
        const insertIndex = baseIndex >= 0 ? baseIndex + 1 : next.length;

        next.splice(insertIndex, 0, ...missingCalculationColumnIds);
      }

      const changed = next.length !== previous.length || next.some((columnId, index) => columnId !== previous[index]);

      return changed ? next : previous;
    });
  }, [availableColumnIdSet, calculationColumnIds, isRecordsLoading]);

  React.useEffect(() => {
    if (isRecordsLoading) return;

    setVisibleColumnIds((previous) => {
      const next = new Set(Array.from(previous).filter((columnId) => availableColumnIdSet.has(columnId)));

      if (next.size === 0) {
        next.add("conciliation");
      }

      const changed = next.size !== previous.size || Array.from(next).some((columnId) => !previous.has(columnId));

      return changed ? next : previous;
    });
  }, [availableColumnIdSet, isRecordsLoading]);

  React.useEffect(() => {
    if (availableColumnIdSet.has(sortConfig.columnId)) return;

    setSortConfig({ columnId: "date", direction: "desc" });
  }, [availableColumnIdSet, sortConfig.columnId]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(viewModeStorageKey, viewMode);
  }, [viewMode]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(tableDensityStorageKey, tableDensity);
  }, [tableDensity]);

  React.useEffect(() => {
    return () => {
      if (queryPreparationTimeoutRef.current) {
        clearTimeout(queryPreparationTimeoutRef.current);
      }

      if (sortFeedbackTimeoutRef.current) {
        clearTimeout(sortFeedbackTimeoutRef.current);
      }

      if (columnMoveFeedbackTimeoutRef.current) {
        clearTimeout(columnMoveFeedbackTimeoutRef.current);
      }
    };
  }, []);

  const startQueryPreparationFeedback = React.useCallback(() => {
    setIsQueryApplying(true);

    if (queryPreparationTimeoutRef.current) {
      clearTimeout(queryPreparationTimeoutRef.current);
    }

    queryPreparationTimeoutRef.current = setTimeout(() => {
      setIsQueryApplying(false);
      queryPreparationTimeoutRef.current = null;
    }, 900);
  }, []);

  const marketplaceOptions = React.useMemo(() => {
    const names = new Set(allOrders.map((order) => order.marketplace).filter(Boolean));

    return ["Todos", ...Array.from(names).sort((first, second) => first.localeCompare(second, "pt-BR"))];
  }, [allOrders]);

  const accountOptions = React.useMemo(() => {
    const names = new Set(allOrders.map((order) => order.accountName).filter(Boolean));

    return ["Todos", ...Array.from(names).sort(compareString)];
  }, [allOrders]);

  const orderStatusOptions = React.useMemo(() => {
    const names = new Set(allOrders.map((order) => order.statusName).filter(Boolean));

    return ["Todos", ...Array.from(names).sort(compareString)];
  }, [allOrders]);

  const filteredOrders = React.useMemo(() => {
    if (!hasAppliedFilters) return [];

    const normalizedSearch = appliedFilters.searchTerm.trim().toLowerCase();

    return allOrders.filter((order) => {
      if (!isDateInRange(order.date, appliedFilters.date)) return false;
      if (appliedFilters.marketplace !== "Todos" && order.marketplace !== appliedFilters.marketplace) return false;
      if (appliedFilters.account !== "Todos" && order.accountName !== appliedFilters.account) return false;
      if (appliedFilters.orderStatus !== "Todos" && order.statusName !== appliedFilters.orderStatus) return false;
      if (appliedFilters.systemStatus !== "Todos" && order.systemStatus !== appliedFilters.systemStatus) return false;
      if (appliedFilters.financialAlert === "Com alerta" && order.financialDivergence.severity === "ok") return false;
      if (appliedFilters.financialAlert === "Críticos" && order.financialDivergence.severity !== "critical") return false;
      if (appliedFilters.financialAlert === "Atenção" && order.financialDivergence.severity !== "attention") return false;
      if (appliedFilters.financialAlert === "Sem alerta" && order.financialDivergence.severity !== "ok") return false;
      const activeAdjustments = getActiveFinancialAdjustments(order);
      if (appliedFilters.adjustmentStatus === "Com ajustes" && activeAdjustments.length === 0) return false;
      if (appliedFilters.adjustmentStatus === "Sem ajustes" && activeAdjustments.length > 0) return false;
      if (appliedFilters.payoutStatus === "Sem repasse" && order.payoutComparison.status !== "missing") return false;
      if (appliedFilters.payoutStatus === "Repasse OK" && order.payoutComparison.status !== "matched") return false;
      if (appliedFilters.payoutStatus === "Divergente" && order.payoutComparison.status !== "divergent") return false;
      if (appliedFilters.suggestion === "Sugeridos" && !isConciliationSuggestionCandidate(order)) return false;
      if (appliedFilters.suggestion === "Revisar" && isConciliationSuggestionCandidate(order)) return false;
      if (appliedFilters.reconciliationStatus === "Pendentes" && order.isReconciled) return false;
      if (appliedFilters.reconciliationStatus === "Conciliados" && !order.isReconciled) return false;

      if (!normalizedSearch) return true;

      const calculationValues = getOrderCalculationValues(order);
      const searchableText = [
        order.orderId,
        order.number,
        order.storeNumber,
        order.customerName,
        order.accountName,
        order.marketplace,
        order.statusName,
        order.systemStatus,
        order.financialDivergence.label,
        order.payoutComparison.label,
        isConciliationSuggestionCandidate(order) ? "Pronto para conciliar" : "Revisar",
        ...activeAdjustments.flatMap((adjustment) => [adjustment.label, adjustment.reason]),
        ...calculationValues.flatMap((calculation) => [calculation.name, calculation.description, calculation.error]),
        ...order.marketplacePayouts.flatMap((payout) => [payout.orderKey, payout.sourceFileName]),
        ...order.financialDivergence.reasons.flatMap((reason) => [reason.title, reason.description]),
        ...order.items.flatMap((item) => [item.sku, item.description]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(normalizedSearch);
    });
  }, [allOrders, appliedFilters, hasAppliedFilters]);

  const summary = React.useMemo(
    () => (filteredOrders.length > 0 ? calculateConciliationSummary(filteredOrders) : emptySummary),
    [filteredOrders]
  );
  const suggestedOrders = React.useMemo(
    () => filteredOrders.filter(isConciliationSuggestionCandidate),
    [filteredOrders]
  );

  const sortedOrders = React.useMemo(() => {
    const directionModifier = sortConfig.direction === "asc" ? 1 : -1;

    return filteredOrders
      .map((order, index) => ({ order, index }))
      .sort((first, second) => {
        const firstValue = getSortValue(first.order, sortConfig.columnId);
        const secondValue = getSortValue(second.order, sortConfig.columnId);

        if (typeof firstValue === "number" && typeof secondValue === "number") {
          return (firstValue - secondValue) * directionModifier || first.index - second.index;
        }

        return compareString(String(firstValue), String(secondValue)) * directionModifier || first.index - second.index;
      })
      .map(({ order }) => order);
  }, [filteredOrders, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(sortedOrders.length / rowsPerPage));
  const paginatedOrders = React.useMemo(
    () => sortedOrders.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage),
    [currentPage, rowsPerPage, sortedOrders]
  );
  const selectedOrders = React.useMemo(
    () => allOrders.filter((order) => selectedOrderIds.has(order.id)),
    [allOrders, selectedOrderIds]
  );
  const payoutOrderKeySet = React.useMemo(() => {
    const keys = new Set<string>();

    allOrders.forEach((order) => {
      getOrderPayoutImportKeys(order).forEach((key) => keys.add(key));
    });

    return keys;
  }, [allOrders]);
  const payoutImportGroups = React.useMemo(
    () => buildPayoutImportGroups(payoutRecords, payoutOrderKeySet),
    [payoutOrderKeySet, payoutRecords]
  );
  const selectedPageCount = paginatedOrders.filter((order) => selectedOrderIds.has(order.id)).length;
  const allPageSelected = paginatedOrders.length > 0 && selectedPageCount === paginatedOrders.length;
  const somePageSelected = selectedPageCount > 0 && !allPageSelected;
  const selectedFilteredCount = filteredOrders.filter((order) => selectedOrderIds.has(order.id)).length;
  const allFilteredSelected = filteredOrders.length > 0 && selectedFilteredCount === filteredOrders.length;
  const someFilteredSelected = selectedFilteredCount > 0 && !allFilteredSelected;
  const isColumnVisible = React.useCallback(
    (columnId: ConciliationColumnId) => visibleColumnIds.has(columnId) && availableColumnIdSet.has(columnId),
    [availableColumnIdSet, visibleColumnIds]
  );
  const orderedVisibleColumnIds = React.useMemo(
    () => columnOrderIds.filter((columnId) => visibleColumnIds.has(columnId) && availableColumnIdSet.has(columnId)),
    [availableColumnIdSet, columnOrderIds, visibleColumnIds]
  );
  const visibleDataColumnCount = orderedVisibleColumnIds.length;
  const tableColSpan = visibleDataColumnCount + 2;
  const tableStyle = React.useMemo<React.CSSProperties>(
    () => ({ minWidth: Math.max(1760, 260 + visibleDataColumnCount * 150) }),
    [visibleDataColumnCount]
  );
  const tableHeaderClassName = cn(
    "sticky top-0 z-20 bg-zinc-50/95 shadow-[0_1px_0_0_rgba(0,0,0,0.06)] backdrop-blur supports-[backdrop-filter]:bg-zinc-50/80 [&_th]:whitespace-nowrap [&_th]:font-medium [&_th]:text-slate-500 [&_tr]:border-slate-200",
    tableDensity === "compact" ? "[&_th]:h-10" : "[&_th]:h-12"
  );
  const tableBodyClassName = cn(
    "[&_td]:text-slate-950 [&_tr]:border-slate-200",
    tableDensity === "compact" ? "[&_td]:py-2 [&_td]:text-xs" : "[&_td]:py-4 [&_td]:text-sm"
  );
  const mainTableRowClassName = cn(
    "group cursor-pointer hover:bg-zinc-50/80",
    tableDensity === "compact" ? "h-[48px]" : "h-[66px]"
  );
  const itemTableRowClassName = cn(
    "bg-zinc-50/70 hover:bg-zinc-50",
    tableDensity === "compact" ? "h-[40px]" : "h-[52px]"
  );
  const stickyActionHeaderClassName =
    "sticky right-0 top-0 z-30 w-[132px] bg-zinc-50/95 text-right shadow-[-8px_0_14px_-14px_rgba(15,23,42,0.45)]";
  const stickyActionCellClassName =
    "sticky right-0 z-10 bg-white text-right shadow-[-8px_0_14px_-14px_rgba(15,23,42,0.45)] transition-colors group-hover:bg-zinc-50";
  const stickyItemActionCellClassName =
    "sticky right-0 z-10 bg-zinc-50 text-right text-xs text-zinc-400 shadow-[-8px_0_14px_-14px_rgba(15,23,42,0.45)]";
  const tableOperationMetrics = [
    {
      label: "Resultado",
      value: `${formatNumber(sortedOrders.length)} pedido(s)`,
      helper: hasAppliedFilters ? "consulta aplicada" : "aguardando filtros",
    },
    {
      label: "Selecionados",
      value: formatNumber(selectedOrders.length),
      helper: `${formatNumber(selectedFilteredCount)} no filtro atual`,
    },
    {
      label: "Alertas",
      value: `${formatNumber(summary.financialCriticalCount)} críticos`,
      helper: `${formatNumber(summary.financialAttentionCount)} em atenção`,
    },
    {
      label: "Colunas",
      value: `${formatNumber(visibleDataColumnCount)} visíveis`,
      helper: `${formatNumber(availableColumnOptions.length)} disponíveis`,
    },
  ];

  React.useEffect(() => {
    setCurrentPage(1);
    setSelectedOrderIds(new Set());
    setExpandedOrderIds(new Set());
  }, [appliedFilters, rowsPerPage]);

  React.useEffect(() => {
    const validOrderIds = new Set(allOrders.map((order) => order.id));

    setSelectedOrderIds((previous) => {
      const next = new Set(Array.from(previous).filter((orderId) => validOrderIds.has(orderId)));

      return next.size === previous.size ? previous : next;
    });
    setExpandedOrderIds((previous) => {
      const next = new Set(Array.from(previous).filter((orderId) => validOrderIds.has(orderId)));

      return next.size === previous.size ? previous : next;
    });
  }, [allOrders]);

  React.useEffect(() => {
    if (!selectedOrder) return;

    const updatedOrder = allOrders.find((order) => order.id === selectedOrder.id);
    if (updatedOrder && updatedOrder !== selectedOrder) {
      setSelectedOrder(updatedOrder);
    }
  }, [allOrders, selectedOrder]);

  const handleApplyFilters = () => {
    startQueryPreparationFeedback();
    setAppliedFilters({
      date,
      marketplace,
      account,
      orderStatus,
      systemStatus,
      financialAlert,
      adjustmentStatus,
      payoutStatus,
      suggestion,
      reconciliationStatus,
      searchTerm,
    });
    setHasAppliedFilters(true);
    setLastAppliedAt(new Date());
    setSelectedOrderIds(new Set());
  };

  const handlePostQueryAccountChange = (value: string) => {
    setAccount(value);
    setAppliedFilters((previous) => ({ ...previous, account: value }));
    setCurrentPage(1);
    setSelectedOrderIds(new Set());
  };

  const handleRefreshConciliationState = async () => {
    setIsRecordsLoading(true);

    try {
      const state = await fetchConciliationState();

      setConciliationRecords(state.records);
      setPayoutRecords(state.payouts);
      setStatusSettings(state.statusSettings);
      setSummarySettings(state.summarySettings);
      setDivergenceSettings(state.divergenceSettings);
      setCalculationSettings(state.calculationSettings);
    } catch (error) {
      console.error("Erro ao atualizar sidecar de conciliacao:", error);
      toast({
        variant: "destructive",
        title: "Erro ao atualizar conciliação",
        description: error instanceof Error ? error.message : "Não foi possível atualizar as marcações salvas.",
      });
    } finally {
      setIsRecordsLoading(false);
    }
  };

  const handleUpdateQuery = () => {
    setIsManualRefreshLoading(true);
    handleApplyFilters();
    void handleRefreshConciliationState().finally(() => setIsManualRefreshLoading(false));
  };

  const handleSort = (columnId: ConciliationColumnId) => {
    setCurrentPage(1);
    const columnLabel = availableColumnOptionById.get(columnId)?.label ?? columnId;
    const nextDirection =
      sortConfig.columnId === columnId && sortConfig.direction === "asc" ? "desc" : "asc";

    setSortFeedback({
      columnId,
      columnLabel,
      totalRows: filteredOrders.length,
    });

    if (sortFeedbackTimeoutRef.current) {
      clearTimeout(sortFeedbackTimeoutRef.current);
    }

    sortFeedbackTimeoutRef.current = setTimeout(() => {
      setSortFeedback(null);
      sortFeedbackTimeoutRef.current = null;
    }, 450);

    setSortConfig({ columnId, direction: nextDirection });
  };

  const showColumnMoveFeedback = React.useCallback(
    (columnId: ConciliationColumnId, detail: string) => {
      const columnLabel = availableColumnOptionById.get(columnId)?.label ?? columnId;

      setColumnMoveFeedback({ columnId, columnLabel, detail });

      if (columnMoveFeedbackTimeoutRef.current) {
        clearTimeout(columnMoveFeedbackTimeoutRef.current);
      }

      columnMoveFeedbackTimeoutRef.current = setTimeout(() => {
        setColumnMoveFeedback(null);
        columnMoveFeedbackTimeoutRef.current = null;
      }, 850);
    },
    [availableColumnOptionById]
  );

  const moveColumn = React.useCallback((sourceColumnId: ConciliationColumnId, targetColumnId: ConciliationColumnId) => {
    if (sourceColumnId === targetColumnId) return;

    setColumnOrderIds((previous) => {
      const sourceIndex = previous.indexOf(sourceColumnId);
      const targetIndex = previous.indexOf(targetColumnId);

      if (sourceIndex === -1 || targetIndex === -1) return previous;

      const next = [...previous];
      const [movedColumnId] = next.splice(sourceIndex, 1);

      if (!movedColumnId) return previous;

      next.splice(targetIndex, 0, movedColumnId);

      return next;
    });
    const targetLabel = availableColumnOptionById.get(targetColumnId)?.label ?? targetColumnId;

    showColumnMoveFeedback(sourceColumnId, `Reposicionada perto de ${targetLabel}`);
  }, [availableColumnOptionById, showColumnMoveFeedback]);

  const moveVisibleColumn = React.useCallback(
    (columnId: ConciliationColumnId, direction: -1 | 1) => {
      const currentIndex = orderedVisibleColumnIds.indexOf(columnId);
      const targetColumnId = orderedVisibleColumnIds[currentIndex + direction];

      if (currentIndex < 0 || !targetColumnId) return;

      moveColumn(columnId, targetColumnId);
    },
    [moveColumn, orderedVisibleColumnIds]
  );

  const handleColumnDragStart = (
    event: React.DragEvent<HTMLElement>,
    columnId: ConciliationColumnId
  ) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", columnId);
    setDraggedColumnId(columnId);
    setDragOverColumnId(null);
  };

  const handleColumnDragOver = (
    event: React.DragEvent<HTMLElement>,
    columnId: ConciliationColumnId
  ) => {
    if (!draggedColumnId || draggedColumnId === columnId) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverColumnId(columnId);
  };

  const handleColumnDrop = (
    event: React.DragEvent<HTMLElement>,
    targetColumnId: ConciliationColumnId
  ) => {
    event.preventDefault();

    const transferColumnId = event.dataTransfer.getData("text/plain");
    const sourceColumnId = isConciliationColumnId(transferColumnId) ? transferColumnId : draggedColumnId;

    if (sourceColumnId) {
      moveColumn(sourceColumnId, targetColumnId);
    }

    setDraggedColumnId(null);
    setDragOverColumnId(null);
  };

  const handleColumnDragEnd = () => {
    setDraggedColumnId(null);
    setDragOverColumnId(null);
  };

  const toggleOrderSelection = (orderId: string, checked: boolean) => {
    setSelectedOrderIds((previous) => {
      const next = new Set(previous);

      if (checked) {
        next.add(orderId);
      } else {
        next.delete(orderId);
      }

      return next;
    });
  };

  const togglePageSelection = (checked: boolean) => {
    setSelectedOrderIds((previous) => {
      const next = new Set(previous);

      paginatedOrders.forEach((order) => {
        if (checked) {
          next.add(order.id);
        } else {
          next.delete(order.id);
        }
      });

      return next;
    });
  };

  const toggleFilteredSelection = (checked: boolean) => {
    setSelectedOrderIds((previous) => {
      const next = new Set(previous);

      filteredOrders.forEach((order) => {
        if (checked) {
          next.add(order.id);
        } else {
          next.delete(order.id);
        }
      });

      return next;
    });
  };

  const toggleOrderExpansion = (orderId: string) => {
    setExpandedOrderIds((previous) => {
      const next = new Set(previous);

      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }

      return next;
    });
  };

  const toggleColumnVisibility = (columnId: ConciliationColumnId, checked: boolean) => {
    setVisibleColumnIds((previous) => {
      const next = new Set(previous);

      if (checked) {
        next.add(columnId);
      } else if (next.size > 1) {
        next.delete(columnId);
      }

      return next;
    });
  };

  const resetVisibleColumns = () => {
    setVisibleColumnIds(new Set([...defaultVisibleColumnIds, ...calculationColumnIds]));
    setColumnOrderIds(buildDefaultColumnOrderWithCalculations(calculationColumnIds));
  };

  const showAllColumns = () => {
    setVisibleColumnIds(new Set(availableColumnIds));
  };

  const hideAllColumns = () => {
    setVisibleColumnIds(new Set<ConciliationColumnId>(["conciliation"]));
  };

  const handleExportOrders = () => {
    if (sortedOrders.length === 0) {
      toast({
        variant: "destructive",
        title: "Nenhum dado para exportar",
        description: "A consulta atual não possui pedidos.",
      });
      return;
    }

    const visibleCalculationColumnOptions = orderedVisibleColumnIds
      .map((columnId) => availableColumnOptionById.get(columnId))
      .filter(
        (column): column is ConciliationColumnOption & { calculationId: string } =>
          Boolean(column?.calculationId)
      );

    const exportedRows = sortedOrders.flatMap((order) => {
      const exportItems = order.items.length > 0 ? order.items : [null];

      return exportItems.map((item, itemIndex) => {
        const row: Record<string, string | number> = {};

        if (isColumnVisible("conciliation")) {
          const auditEvents = buildConciliationAuditEvents(order);

          row["Conciliação"] = order.isReconciled ? "Conciliado" : "Pendente";
          row["Conciliado em"] = formatDateTime(order.conciliation?.reconciledAt);
          row["Conciliado por"] = formatActor(order.conciliation?.reconciledBy ?? null);
          row["Última ação"] = auditEvents[0]?.title || "";
          row["Última ação em"] = formatDateTime(auditEvents[0]?.at);
          row["Última ação por"] = formatActor(auditEvents[0]?.actor ?? null);
          row["Histórico"] = auditEvents
            .map((event) => `${formatDateTime(event.at)} - ${event.title} (${formatActor(event.actor)})`)
            .join("; ");
        }
        if (isColumnVisible("suggestion")) {
          row["Sugestão"] = isConciliationSuggestionCandidate(order) ? "Pronto para conciliar" : "Revisar";
          row["Critério sugestão"] = "Pendente, Entregue, Sem alerta e Repasse OK";
        }
        if (isColumnVisible("financialAlert")) {
          row["Alerta Financeiro"] = order.financialDivergence.label;
          row["Qtd Alertas Financeiros"] =
            order.financialDivergence.criticalCount + order.financialDivergence.attentionCount;
          row["Alertas Críticos"] = order.financialDivergence.criticalCount;
          row["Alertas Atenção"] = order.financialDivergence.attentionCount;
          row["Risco Estimado"] = order.financialDivergence.riskAmount;
          row["Motivos Financeiros"] =
            order.financialDivergence.reasons.map((reason) => reason.title).join("; ") || "";
        }
        if (isColumnVisible("adjustments")) {
          const activeAdjustments = getActiveFinancialAdjustments(order);

          row["Ajustes Financeiros"] = activeAdjustments.length;
          row["Campos Ajustados"] = activeAdjustments.map((adjustment) => adjustment.label).join("; ");
          row["Detalhe Ajustes"] = activeAdjustments
            .map(
              (adjustment) =>
                `${adjustment.label}: ${formatCurrency(adjustment.originalValue)} -> ${formatCurrency(
                  adjustment.adjustedValue ?? 0
                )}`
            )
            .join("; ");
          row["Motivos Ajustes"] = activeAdjustments
            .map((adjustment) => [adjustment.label, adjustment.reason].filter(Boolean).join(": "))
            .join("; ");
        }
        if (isColumnVisible("calculatedColumns")) {
          const calculationValues = getOrderCalculationValues(order);

          row["Cálculos Configurados"] = calculationValues.length;
          row["Cálculos com Erro"] = calculationValues.filter((calculation) => calculation.error).length;
          row["Resumo Cálculos"] = calculationValues
            .map((calculation) =>
              calculation.error
                ? `${calculation.name}: Erro - ${calculation.error}`
                : `${calculation.name}: ${formatCalculationValue(calculation.value, calculation.isPercentage)}`
            )
            .join("; ");
        }
        visibleCalculationColumnOptions.forEach((column) => {
          const calculation = order.calculationValues?.[column.calculationId];

          row[`Cálculo - ${column.label}`] = calculation
            ? calculation.error
              ? `Erro: ${calculation.error}`
              : calculation.value
            : "";
        });
        if (isColumnVisible("payout")) {
          row["Repasse"] = order.payoutComparison.label;
          row["Qtd Repasses"] = order.payoutComparison.payoutCount;
          row["Líquido Esperado"] = order.payoutComparison.expectedNetAmount;
          row["Líquido Repassado"] = order.payoutComparison.paidNetAmount;
          row["Diferença Repasse"] = order.payoutComparison.differenceAmount;
          row["Tolerância Repasse"] = order.payoutComparison.toleranceAmount;
          row["Chaves Repasse"] = order.marketplacePayouts.map((payout) => payout.orderKey).join("; ");
          row["Arquivos Repasse"] = order.marketplacePayouts
            .map((payout) => `${payout.sourceFileName}#${payout.sourceRow}`)
            .join("; ");
        }
        if (isColumnVisible("order")) {
          row["Pedido"] = order.number || order.orderId;
          row["Pedido loja"] = order.storeNumber;
        }
        if (isColumnVisible("date")) row["Data"] = formatDate(order.date);
        if (isColumnVisible("account")) row["Conta"] = order.accountName;
        if (isColumnVisible("marketplace")) row["Marketplace"] = order.marketplace;
        if (isColumnVisible("items")) {
          row["Itens Pedido"] = order.items.length;
          row["Item #"] = item ? itemIndex + 1 : "";
        }
        if (isColumnVisible("product")) {
          row["Produto"] = item?.description || "Sem itens";
          row["SKU"] = item?.sku || "";
          row["Valor Unitário Item"] = item?.unitValue ?? "";
          row["Total Item"] = item?.grossValue ?? "";
        }
        if (isColumnVisible("quantity")) {
          row["Qtd Pedido"] = order.totalQuantity;
          row["Qtd Item"] = item?.quantity ?? "";
        }
        if (isColumnVisible("status")) row["Status Pedido"] = order.statusName;
        if (isColumnVisible("systemStatus")) {
          row["Status Sistema"] = order.systemStatus;
          row["Status Sistema Automático"] = order.automaticSystemStatus;
          row["Status Sistema Manual"] = order.manualSystemStatus || "";
        }
        if (isColumnVisible("grossRevenue")) row["Faturamento Bruto"] = order.grossRevenue;
        if (isColumnVisible("netRevenue")) row["Líquido"] = order.netRevenue;
        if (isColumnVisible("taxes")) row["Imposto"] = order.taxes;
        if (isColumnVisible("productCost")) row["Custo Produto"] = order.productCost;
        if (isColumnVisible("margin")) row["Margem de Contribuição"] = order.contributionMargin;
        if (isColumnVisible("marginPercentage")) row["Margem %"] = order.contributionMarginPercentage;

        return row;
      });
    });

    const worksheet = XLSX.utils.json_to_sheet(exportedRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Conciliação");

    if (exportedRows.length > 0) {
      const headers = Object.keys(exportedRows[0]);
      worksheet["!cols"] = headers.map((header) => ({
        wch: Math.min(
          48,
          Math.max(
            header.length + 2,
            ...exportedRows.map((row) => String(row[header] ?? "").length + 2)
          )
        ),
      }));
    }

    const fromDate = appliedFilters.date?.from ? format(appliedFilters.date.from, "yyyy-MM-dd") : "inicio";
    const toDate = appliedFilters.date?.to ? format(appliedFilters.date.to, "yyyy-MM-dd") : "fim";
    const filename = `conciliacao-brsteel-${fromDate}-a-${toDate}.xlsx`;

    XLSX.writeFile(workbook, filename);

    toast({
      title: "Exportação concluída",
      description: `${sortedOrders.length} pedido(s) em ${exportedRows.length} linha(s) exportado(s) para ${filename}.`,
    });
  };

  const handleSaveConciliation = async (orders: ConciliationOrder[], reconciled: boolean) => {
    if (orders.length === 0) return;

    setIsSaving(true);
    try {
      const updatedRecords = await saveConciliationRecords(orders, reconciled);

      setConciliationRecords((previous) => {
        const next = new Map(previous);
        updatedRecords.forEach((record, orderId) => next.set(orderId, record));

        return next;
      });
      setSelectedOrderIds(new Set());

      toast({
        title: reconciled ? "Pedido(s) conciliado(s)" : "Conciliação desfeita",
        description: `${orders.length} pedido(s) atualizado(s) com snapshot financeiro.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar conciliação",
        description: error instanceof Error ? error.message : "Não foi possível atualizar os pedidos selecionados.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSuggestedConciliations = () => {
    if (suggestedOrders.length === 0) return;

    if (suggestedOrders.length > 450) {
      toast({
        variant: "destructive",
        title: "Muitos pedidos sugeridos",
        description: "Refine a consulta para conciliar até 450 pedidos por operação.",
      });
      return;
    }

    handleSaveConciliation(suggestedOrders, true);
  };

  const handleSaveSystemStatus = async (
    order: ConciliationOrder,
    manualSystemStatus: ConciliationSystemStatus | null
  ) => {
    setIsSaving(true);
    try {
      const updatedRecord = await saveConciliationSystemStatus(order, manualSystemStatus);

      setConciliationRecords((previous) => {
        const next = new Map(previous);
        next.set(order.id, updatedRecord);

        return next;
      });

      toast({
        title: "Status atualizado",
        description: `Pedido #${order.number || order.orderId} atualizado para ${updatedRecord.systemStatus}.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar status",
        description: error instanceof Error ? error.message : "Não foi possível atualizar o status do pedido.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveFinancialAdjustments = async (
    order: ConciliationOrder,
    financialAdjustments: ConciliationFinancialAdjustmentInput[]
  ) => {
    setIsSaving(true);
    try {
      const updatedRecord = await saveConciliationFinancialAdjustments(order, financialAdjustments);

      setConciliationRecords((previous) => {
        const next = new Map(previous);
        next.set(order.id, updatedRecord);

        return next;
      });

      toast({
        title: "Ajustes financeiros salvos",
        description: `Pedido #${order.number || order.orderId} será recalculado com as correções manuais.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar ajustes",
        description: error instanceof Error ? error.message : "Não foi possível salvar os ajustes financeiros.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveStatusMappings = async (statusMappings: ConciliationStatusMappings) => {
    setIsSaving(true);
    try {
      const updatedSettings = await saveConciliationStatusMappings(statusMappings);

      setStatusSettings(updatedSettings);
      setIsStatusSettingsOpen(false);

      toast({
        title: "Mapeamento salvo",
        description: `${formatNumber(Object.keys(updatedSettings.statusMappings).length)} regra(s) de status atualizada(s).`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar mapeamento",
        description: error instanceof Error ? error.message : "Não foi possível salvar as regras de status.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSummarySettings = async (metricIds: ConciliationSummaryMetricId[]) => {
    setIsSaving(true);
    try {
      const updatedSettings = await saveConciliationSummarySettings(metricIds);

      setSummarySettings(updatedSettings);
      setIsSummarySettingsOpen(false);

      toast({
        title: "Resumo atualizado",
        description: `${formatNumber(updatedSettings.metricIds.length)} card(s) configurado(s).`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar resumo",
        description: error instanceof Error ? error.message : "Não foi possível salvar a configuração do resumo.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveCalculationSettings = async (calculations: ConciliationCustomCalculationInput[]) => {
    setIsSaving(true);
    try {
      const updatedSettings = await saveConciliationCalculationSettings(calculations);

      setCalculationSettings(updatedSettings);
      setIsCalculationSettingsOpen(false);

      toast({
        title: "Cálculos atualizados",
        description: `${formatNumber(updatedSettings.calculations.length)} coluna(s) calculada(s) configurada(s).`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar cálculos",
        description: error instanceof Error ? error.message : "Não foi possível salvar as colunas calculadas.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDivergenceSettings = async (divergenceRules: ConciliationFinancialDivergenceRules) => {
    setIsSaving(true);
    try {
      const updatedSettings = await saveConciliationDivergenceSettings(divergenceRules);

      setDivergenceSettings(updatedSettings);
      setIsDivergenceSettingsOpen(false);

      toast({
        title: "Alertas atualizados",
        description: `${formatNumber(Object.keys(updatedSettings.marketplaceRules).length)} regra(s) específica(s) configurada(s).`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar alertas",
        description: error instanceof Error ? error.message : "Não foi possível salvar as regras financeiras.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleImportPayouts = async (payouts: ConciliationMarketplacePayoutInput[]) => {
    setIsSaving(true);
    try {
      const importedPayouts = await saveConciliationMarketplacePayouts(payouts);

      setPayoutRecords((previous) => {
        const next = new Map(previous.map((payout) => [payout.id, payout]));

        importedPayouts.forEach((payout) => next.set(payout.id, payout));

        return Array.from(next.values()).sort((first, second) =>
          compareString(`${second.importedAt || ""}-${second.id}`, `${first.importedAt || ""}-${first.id}`)
        );
      });
      setIsPayoutImportOpen(false);

      toast({
        title: "Repasses importados",
        description: `${formatNumber(importedPayouts.length)} linha(s) de repasse adicionada(s) à conciliação.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro ao importar repasses",
        description: error instanceof Error ? error.message : "Não foi possível importar os repasses.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeletePayoutImport = async (group: PayoutImportGroup) => {
    const confirmed = window.confirm(
      `Desfazer a importação "${group.sourceFileName}" com ${formatNumber(group.payouts.length)} linha(s)?`
    );

    if (!confirmed) return;

    setIsSaving(true);
    try {
      const deletedIds = await deleteConciliationMarketplacePayoutImport({
        importBatchId: group.importBatchId,
        sourceFileName: group.sourceFileName,
        importedAt: group.importedAt,
      });
      const deletedIdSet = new Set(deletedIds);

      setPayoutRecords((previous) => previous.filter((payout) => !deletedIdSet.has(payout.id)));

      toast({
        title: "Importação desfeita",
        description: `${formatNumber(deletedIds.length)} linha(s) de repasse removida(s).`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro ao desfazer importação",
        description: error instanceof Error ? error.message : "Não foi possível remover as linhas de repasse.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const setDatePreset = (preset: "today" | "yesterday" | "last7" | "last30" | "thisMonth" | "lastMonth") => {
    const today = new Date();

    switch (preset) {
      case "today":
        setDate({ from: today, to: today });
        break;
      case "yesterday": {
        const yesterday = subDays(today, 1);
        setDate({ from: yesterday, to: yesterday });
        break;
      }
      case "last7":
        setDate({ from: subDays(today, 6), to: today });
        break;
      case "last30":
        setDate({ from: subDays(today, 29), to: today });
        break;
      case "thisMonth":
        setDate({ from: startOfMonth(today), to: today });
        break;
      case "lastMonth": {
        const previousMonth = subMonths(today, 1);
        setDate({ from: startOfMonth(previousMonth), to: endOfMonth(previousMonth) });
        break;
      }
    }
  };

  const renderOrderColumnCell = (
    order: ConciliationOrder,
    columnId: ConciliationColumnId,
    isExpanded: boolean,
    columnIndex: number
  ) => {
    const firstColumnStickyClassName =
      columnId === "conciliation" && columnIndex === 0
        ? "sticky left-12 z-10 bg-white transition-colors group-hover:bg-zinc-50"
        : undefined;
    const calculationId = getCalculationIdFromColumnId(columnId);

    if (calculationId) {
      const calculation = order.calculationValues?.[calculationId];

      return (
        <TableCell key={columnId} className="whitespace-nowrap text-right tabular-nums">
          {calculation ? (
            calculation.error ? (
              <Badge variant="destructive" className="max-w-40 truncate" title={calculation.error}>
                Erro
              </Badge>
            ) : (
              <span title={calculation.expression}>
                {formatCalculationValue(calculation.value, calculation.isPercentage)}
              </span>
            )
          ) : (
            <span className="text-zinc-400">-</span>
          )}
        </TableCell>
      );
    }

    if (!isStaticConciliationColumnId(columnId)) return null;

    switch (columnId) {
      case "conciliation":
        return (
          <TableCell key={columnId} className={firstColumnStickyClassName}>
            {order.isReconciled ? (
              <Badge className="gap-1 whitespace-nowrap">
                <CheckCircle2 className="h-3 w-3" />
                Conciliado
              </Badge>
            ) : (
              <Badge variant="outline" className="whitespace-nowrap">
                Pendente
              </Badge>
            )}
          </TableCell>
        );
      case "suggestion":
        return (
          <TableCell key={columnId}>
            <ConciliationSuggestionBadge order={order} />
          </TableCell>
        );
      case "financialAlert":
        return (
          <TableCell key={columnId}>
            <FinancialDivergenceBadge divergence={order.financialDivergence} compact />
          </TableCell>
        );
      case "adjustments":
        return (
          <TableCell key={columnId}>
            <FinancialAdjustmentsBadge order={order} />
          </TableCell>
        );
      case "calculatedColumns":
        return (
          <TableCell key={columnId}>
            <div className="space-y-1">
              <CalculatedColumnsBadge order={order} />
              {getOrderCalculationValues(order).slice(0, 2).map((calculation) => (
                <p
                  key={calculation.id}
                  className={cn("text-xs text-muted-foreground", calculation.error && "text-red-600")}
                  title={calculation.error || calculation.expression}
                >
                  {calculation.name}:{" "}
                  {calculation.error
                    ? "Erro"
                    : formatCalculationValue(calculation.value, calculation.isPercentage)}
                </p>
              ))}
            </div>
          </TableCell>
        );
      case "payout":
        return (
          <TableCell key={columnId}>
            <div className="space-y-1">
              <PayoutComparisonBadge order={order} compact />
              <p className="text-xs text-muted-foreground">
                {formatCurrency(order.payoutComparison.paidNetAmount)} repassado
              </p>
            </div>
          </TableCell>
        );
      case "items":
        return (
          <TableCell key={columnId} data-stop-row-click="true" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2">
              {order.items.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  aria-label={`${isExpanded ? "Recolher" : "Expandir"} itens do pedido ${order.number || order.orderId}`}
                  aria-expanded={isExpanded}
                  onClick={() => toggleOrderExpansion(order.id)}
                >
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
              ) : (
                <span className="h-8 w-8" aria-hidden="true" />
              )}
              <span>{formatNumber(order.items.length)}</span>
            </div>
          </TableCell>
        );
      case "order":
        return (
          <TableCell key={columnId} className="whitespace-nowrap font-medium">
            #{order.number || order.orderId}
            <div className="text-xs font-normal text-muted-foreground">{order.storeNumber}</div>
          </TableCell>
        );
      case "date":
        return (
          <TableCell key={columnId} className="whitespace-nowrap">
            {formatDate(order.date)}
          </TableCell>
        );
      case "account":
        return <TableCell key={columnId}>{order.accountName}</TableCell>;
      case "marketplace":
        return <TableCell key={columnId}>{order.marketplace}</TableCell>;
      case "product":
        return (
          <TableCell key={columnId} className="min-w-64">
            {order.items[0] ? (
              <div className="max-w-sm">
                <p className="truncate text-sm">{order.items[0].description}</p>
                <p className="text-xs text-muted-foreground">
                  {order.items[0].sku}
                  {order.items.length > 1 ? ` +${order.items.length - 1}` : ""}
                </p>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Sem itens</span>
            )}
          </TableCell>
        );
      case "quantity":
        return (
          <TableCell key={columnId} className="text-center">
            {formatNumber(order.totalQuantity)}
          </TableCell>
        );
      case "status":
        return (
          <TableCell key={columnId}>
            <Badge variant={getStatusVariant(order.statusName)} className="whitespace-nowrap">
              {order.statusName}
            </Badge>
          </TableCell>
        );
      case "systemStatus":
        return (
          <TableCell key={columnId}>
            <InlineSystemStatusSelect
              order={order}
              isSaving={isSaving}
              onSave={handleSaveSystemStatus}
            />
          </TableCell>
        );
      case "grossRevenue":
        return (
          <TableCell key={columnId} className="whitespace-nowrap text-right">
            {formatCurrency(order.grossRevenue)}
          </TableCell>
        );
      case "netRevenue":
        return (
          <TableCell key={columnId} className="whitespace-nowrap text-right">
            {formatCurrency(order.netRevenue)}
          </TableCell>
        );
      case "taxes":
        return (
          <TableCell key={columnId} className="whitespace-nowrap text-right">
            {formatCurrency(order.taxes)}
          </TableCell>
        );
      case "productCost":
        return (
          <TableCell key={columnId} className="whitespace-nowrap text-right">
            {formatCurrency(order.productCost)}
          </TableCell>
        );
      case "margin":
        return (
          <TableCell key={columnId} className="whitespace-nowrap text-right">
            {formatCurrency(order.contributionMargin)}
          </TableCell>
        );
      case "marginPercentage":
        return (
          <TableCell key={columnId} className="whitespace-nowrap text-right">
            {formatPercentage(order.contributionMarginPercentage)}
          </TableCell>
        );
    }

    return null;
  };

  const renderOrderItemColumnCell = (
    order: ConciliationOrder,
    item: ConciliationOrderItem,
    itemIndex: number,
    columnId: ConciliationColumnId,
    columnIndex: number
  ) => {
    const lineLabel = `Item ${itemIndex + 1}/${order.items.length}`;
    const mutedDash = <span className="text-zinc-400">-</span>;
    const firstColumnStickyClassName =
      columnId === "conciliation" && columnIndex === 0
        ? "sticky left-12 z-10 bg-zinc-50 transition-colors"
        : undefined;
    const renderEstimatedCurrency = (value: number) => (
      <span
        className="whitespace-nowrap tabular-nums text-zinc-700"
        title="Valor estimado por rateio proporcional do pedido entre os itens."
      >
        {formatCurrency(value)}
      </span>
    );
    const itemNetRevenue = allocateOrderAmountToItem(order, item, order.netRevenue);
    const itemContributionMargin = allocateOrderAmountToItem(order, item, order.contributionMargin);
    const itemMarginPercentage = itemNetRevenue !== 0 ? (itemContributionMargin / itemNetRevenue) * 100 : 0;

    if (isCalculationColumnId(columnId)) {
      return <TableCell key={columnId}>{mutedDash}</TableCell>;
    }

    if (!isStaticConciliationColumnId(columnId)) return null;

    switch (columnId) {
      case "conciliation":
        return (
          <TableCell key={columnId} className={firstColumnStickyClassName}>
            <span className="inline-flex h-6 items-center rounded border border-zinc-200 bg-white px-2 text-[11px] font-semibold text-zinc-500">
              {lineLabel}
            </span>
          </TableCell>
        );
      case "items":
        return (
          <TableCell key={columnId}>
            <span className="inline-flex h-6 w-6 items-center justify-center rounded border border-zinc-200 bg-white text-[11px] font-semibold text-zinc-500">
              {itemIndex + 1}
            </span>
          </TableCell>
        );
      case "order":
        return (
          <TableCell key={columnId} className="whitespace-nowrap">
            <span className="text-xs font-medium text-zinc-600">{lineLabel}</span>
          </TableCell>
        );
      case "product":
        return (
          <TableCell key={columnId} className="min-w-64">
            <div className="max-w-sm">
              <p className="truncate text-sm font-medium text-zinc-800">{item.description || "Sem descrição"}</p>
              <p className="font-mono text-[10px] text-zinc-500">{item.sku || "SKU N/A"}</p>
            </div>
          </TableCell>
        );
      case "quantity":
        return (
          <TableCell key={columnId} className="text-center tabular-nums">
            {formatNumber(item.quantity)}
          </TableCell>
        );
      case "grossRevenue":
        return (
          <TableCell key={columnId} className="whitespace-nowrap text-right font-medium tabular-nums">
            {formatCurrency(item.grossValue)}
          </TableCell>
        );
      case "netRevenue":
        return (
          <TableCell key={columnId} className="text-right">
            {renderEstimatedCurrency(itemNetRevenue)}
          </TableCell>
        );
      case "taxes":
        return (
          <TableCell key={columnId} className="text-right">
            {renderEstimatedCurrency(allocateOrderAmountToItem(order, item, order.taxes))}
          </TableCell>
        );
      case "productCost":
        return (
          <TableCell key={columnId} className="text-right">
            {renderEstimatedCurrency(allocateOrderAmountToItem(order, item, order.productCost))}
          </TableCell>
        );
      case "margin":
        return (
          <TableCell key={columnId} className="text-right">
            {renderEstimatedCurrency(itemContributionMargin)}
          </TableCell>
        );
      case "marginPercentage":
        return (
          <TableCell key={columnId} className="whitespace-nowrap text-right tabular-nums">
            {formatPercentage(itemMarginPercentage)}
          </TableCell>
        );
      case "suggestion":
      case "financialAlert":
      case "adjustments":
      case "calculatedColumns":
      case "payout":
      case "date":
      case "account":
      case "marketplace":
      case "status":
      case "systemStatus":
        return <TableCell key={columnId}>{mutedDash}</TableCell>;
    }

    return null;
  };

  const appliedFromLabel = appliedFilters.date?.from ? format(appliedFilters.date.from, "dd/MM/yyyy") : "inicio";
  const appliedToLabel = appliedFilters.date?.to ? format(appliedFilters.date.to, "dd/MM/yyyy") : "fim";
  const appliedMarketplaceLabel = appliedFilters.marketplace === "Todos" ? "Todos marketplaces" : appliedFilters.marketplace;
  const postQueryCommissionAmount = React.useMemo(
    () => filteredOrders.reduce((total, order) => total + order.commissionFee, 0),
    [filteredOrders]
  );
  const periodSummaryMetrics = [
    {
      title: "Faturamento Bruto",
      value: formatCurrency(summary.grossRevenue),
      tone: "blue" as const,
    },
    {
      title: "Custo do Produto (CMV)",
      value: formatCurrency(summary.productCost),
      tone: "red" as const,
    },
    {
      title: "Margem de Contribuição",
      value: formatCurrency(summary.contributionMargin),
      tone: "green" as const,
    },
    {
      title: "Taxa de Afiliados",
      value: formatCurrency(postQueryCommissionAmount),
      tone: "cyan" as const,
    },
  ];

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-5 bg-slate-50 p-4 pt-6 text-slate-950 md:p-8" style={{ fontFamily: "Manrope, sans-serif" }}>
        <div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Conciliação de Vendas</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Analise suas vendas, adicione custos e encontre o lucro líquido de cada operação.
            </p>
          </div>
        </div>

        <Card className={referencePanelClassName}>
          <CardHeader className="gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>Seleção de Período</CardTitle>
              <CardDescription className="text-slate-500">Filtre as vendas que você deseja analisar.</CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className={referenceOutlineButtonClassName}
                onClick={() => void handleRefreshConciliationState()}
                disabled={isLoading}
              >
                Sincronizar
              </Button>
              <Button
                type="button"
	                variant="outline"
	                className={referenceOutlineButtonClassName}
	                onClick={() => setIsCalculationSettingsOpen(true)}
	                disabled={isLoading}
	              >
	                Calcular
              </Button>
              <Button
                type="button"
                variant="outline"
                className={referenceOutlineButtonClassName}
                onClick={handleUpdateQuery}
                disabled={isLoading || isManualRefreshLoading}
              >
                {isManualRefreshLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isManualRefreshLoading ? "Atualizando..." : "Atualizar"}
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(referenceOutlineButtonClassName, "h-10 w-10 px-0")}
                    aria-label="Configurações da conciliação"
                    title="Configurações da conciliação"
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64" align="end">
                  <div className="grid gap-2">
	                    <Button
	                      type="button"
	                      variant="ghost"
	                      className="justify-start"
	                      onClick={() => setIsCalculationSettingsOpen(true)}
	                      disabled={isLoading}
	                    >
	                      <Calculator className="mr-2 h-4 w-4" />
	                      Colunas calculadas
	                    </Button>
	                    <Button
	                      type="button"
	                      variant="ghost"
	                      className="justify-start"
	                      onClick={() => setIsDivergenceSettingsOpen(true)}
	                      disabled={isLoading}
	                    >
                      <AlertTriangle className="mr-2 h-4 w-4" />
                      Configurar alertas
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="justify-start"
                      onClick={() => setIsStatusSettingsOpen(true)}
                      disabled={isLoading}
                    >
                      <SlidersHorizontal className="mr-2 h-4 w-4" />
                      Configurar status
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="justify-start"
                      onClick={() => setIsPayoutImportOpen(true)}
                      disabled={isLoading}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      Importar repasses
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="justify-start"
                      onClick={() => setIsPayoutHistoryOpen(true)}
                      disabled={isLoading}
                    >
                      <Files className="mr-2 h-4 w-4" />
                      Repasses importados
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        id="conciliation-date"
                        variant="outline"
                        className={cn("w-full justify-start text-left sm:w-auto", referenceDateButtonClassName, !date && "text-slate-500")}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {date?.from ? (
                          date.to ? (
                            <>
                              {format(date.from, "dd/MM/yyyy")} - {format(date.to, "dd/MM/yyyy")}
                            </>
                          ) : (
                            format(date.from, "dd/MM/yyyy")
                          )
                        ) : (
                          <span>Escolha um período</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="flex w-auto p-0" align="start">
                      <div className="flex w-40 flex-col gap-1 border-r p-2">
                        <Button variant="ghost" className="h-8 justify-start px-2 text-left font-normal" onClick={() => setDatePreset("today")}>
                          Hoje
                        </Button>
                        <Button variant="ghost" className="h-8 justify-start px-2 text-left font-normal" onClick={() => setDatePreset("yesterday")}>
                          Ontem
                        </Button>
                        <Button variant="ghost" className="h-8 justify-start px-2 text-left font-normal" onClick={() => setDatePreset("last7")}>
                          Últimos 7 dias
                        </Button>
                        <Button variant="ghost" className="h-8 justify-start px-2 text-left font-normal" onClick={() => setDatePreset("last30")}>
                          Últimos 30 dias
                        </Button>
                        <Separator />
                        <Button variant="ghost" className="h-8 justify-start px-2 text-left font-normal" onClick={() => setDatePreset("thisMonth")}>
                          Este mês
                        </Button>
                        <Button variant="ghost" className="h-8 justify-start px-2 text-left font-normal" onClick={() => setDatePreset("lastMonth")}>
                          Mês passado
                        </Button>
                      </div>
                      <Calendar
                        initialFocus
                        mode="range"
                        defaultMonth={date?.from}
                        selected={date}
                        onSelect={setDate}
                        numberOfMonths={2}
                        locale={ptBR}
                      />
                    </PopoverContent>
                  </Popover>

                  <div className="flex gap-1">
                    <Button type="button" variant="outline" className={referenceCompactButtonClassName} onClick={() => setDatePreset("lastMonth")}>
                      Mês Passado
                    </Button>
                    <Button type="button" variant="outline" className={referenceCompactButtonClassName} onClick={() => setDatePreset("thisMonth")}>
                      Mês Atual
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-start gap-2">
                  <Select value={marketplace} onValueChange={setMarketplace}>
                    <SelectTrigger className={cn(referenceControlClassName, "w-full min-w-[220px] sm:w-[240px]")}>
                      <SelectValue placeholder="Marketplace" />
                    </SelectTrigger>
                    <SelectContent>
                      {marketplaceOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option === "Todos" ? "Marketplace" : option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="relative w-full min-w-[220px] sm:w-[290px]">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    <Input
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      className={cn(referenceControlClassName, "pl-9")}
                      placeholder="Buscar pedido global"
                      aria-label="Buscar pedido global"
                    />
                  </div>
                </div>

                <Button className={referencePrimaryButtonClassName} onClick={handleApplyFilters} disabled={isLoading || isQueryApplying}>
                  {isQueryApplying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  {isQueryApplying ? "Preparando..." : "Aplicar"}
                </Button>
              </div>

              <div className="space-y-2 text-right">
                {hasAppliedFilters ? (
                  <>
                    <div className="flex items-center justify-end gap-2 text-sm font-semibold text-slate-500">
                      {isQueryLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      )}
                      <span>{isQueryLoading ? "Carregando vendas" : "Dados conciliados"}</span>
                      {isQueryLoading ? (
                        <Skeleton className="h-4 w-10" />
                      ) : (
                        <span className="font-bold text-primary">{Math.round(summary.reconciledPercentage || 0)}%</span>
                      )}
                    </div>
                    <Progress value={isQueryLoading ? 45 : summary.reconciledPercentage} className="h-2 w-full sm:w-48" />
                  </>
                ) : (
                  <div className="text-sm font-semibold text-slate-500">Aguardando aplicação</div>
                )}
                <div className="text-xs text-slate-500">
                  {hasAppliedFilters
                    ? isQueryLoading
                      ? "Preparando consulta..."
                      : `${appliedFromLabel} a ${appliedToLabel} · ${appliedMarketplaceLabel}`
                    : "Nenhuma consulta aplicada"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {!hasAppliedFilters ? (
          <Alert className="border-slate-200 bg-muted/30 text-slate-950">
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>Consulta não aplicada</AlertTitle>
            <AlertDescription className="text-slate-500">
              Defina período e marketplace, depois aplique para carregar apenas os pedidos necessários.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Card className={referencePanelClassName}>
              <CardHeader className="gap-3 lg:flex-row lg:items-center lg:justify-between">
                <CardTitle>Resumo do Período</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  className={referenceCompactButtonClassName}
                  onClick={() => setIsSummarySettingsOpen(true)}
                  disabled={isLoading}
                >
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Configurar Resumo
                </Button>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {periodSummaryMetrics.map((metric) => (
                    <PeriodSummaryMetricCard
                      key={metric.title}
                      title={metric.title}
                      value={metric.value}
                      tone={metric.tone}
                      isLoading={isQueryLoading}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
              <div className="text-sm text-slate-500">
                {isQueryLoading ? (
                  <Skeleton className="h-5 w-36" />
                ) : (
                  <>
                    {formatNumber(filteredOrders.length)} pedido(s) - {formatClock(lastAppliedAt)}
                  </>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                {suggestedOrders.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    className={referenceCompactButtonClassName}
                    onClick={handleSaveSuggestedConciliations}
                    disabled={isLoading || isSaving || suggestedOrders.length > 450}
                  >
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-2 h-4 w-4" />}
                    Conciliar sugeridos
                  </Button>
                ) : null}
                <Select value={account} onValueChange={handlePostQueryAccountChange}>
                  <SelectTrigger className={cn(referenceControlClassName, "h-10 w-full rounded-lg sm:w-52")}>
                    <SelectValue placeholder="Todas as contas" />
                  </SelectTrigger>
                  <SelectContent>
                    {accountOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option === "Todos" ? "Todas as contas" : option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className={cn(referenceCompactButtonClassName, "h-8 rounded-lg")}>
                      <SlidersHorizontal className="mr-2 h-4 w-4" />
                      Filtros Adicionais
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[min(92vw,780px)]" align="end">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <Select value={orderStatus} onValueChange={setOrderStatus}>
                        <SelectTrigger className={referenceControlClassName}>
                          <SelectValue placeholder="Status pedido" />
                        </SelectTrigger>
                        <SelectContent>
                          {orderStatusOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option === "Todos" ? "Todos status" : option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select value={systemStatus} onValueChange={(value) => setSystemStatus(value as SystemStatusFilter)}>
                        <SelectTrigger className={referenceControlClassName}>
                          <SelectValue placeholder="Status sistema" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Todos">Todos sistemas</SelectItem>
                          {conciliationSystemStatusOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select value={financialAlert} onValueChange={(value) => setFinancialAlert(value as FinancialAlertFilter)}>
                        <SelectTrigger className={referenceControlClassName}>
                          <SelectValue placeholder="Alerta financeiro" />
                        </SelectTrigger>
                        <SelectContent>
                          {financialAlertOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option === "Todos" ? "Todos alertas" : option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select
                        value={adjustmentStatus}
                        onValueChange={(value) => setAdjustmentStatus(value as AdjustmentStatusFilter)}
                      >
                        <SelectTrigger className={referenceControlClassName}>
                          <SelectValue placeholder="Ajustes" />
                        </SelectTrigger>
                        <SelectContent>
                          {adjustmentStatusOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option === "Todos" ? "Todos ajustes" : option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select value={payoutStatus} onValueChange={(value) => setPayoutStatus(value as PayoutStatusFilter)}>
                        <SelectTrigger className={referenceControlClassName}>
                          <SelectValue placeholder="Repasse" />
                        </SelectTrigger>
                        <SelectContent>
                          {payoutStatusOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option === "Todos" ? "Todos repasses" : option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select value={suggestion} onValueChange={(value) => setSuggestion(value as SuggestionFilter)}>
                        <SelectTrigger className={referenceControlClassName}>
                          <SelectValue placeholder="Sugestão" />
                        </SelectTrigger>
                        <SelectContent>
                          {suggestionOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option === "Todos" ? "Todas sugestões" : option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select value={reconciliationStatus} onValueChange={(value) => setReconciliationStatus(value as ReconciliationStatusFilter)}>
                        <SelectTrigger className={referenceControlClassName}>
                          <SelectValue placeholder="Conciliação" />
                        </SelectTrigger>
                        <SelectContent>
                          {reconciliationStatusOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option === "Todos" ? "Todas conciliações" : option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <Button
                        type="button"
                        className={referencePrimaryButtonClassName}
                        onClick={handleApplyFilters}
                        disabled={isQueryApplying}
                      >
                        {isQueryApplying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {isQueryApplying ? "Preparando..." : "Aplicar filtros"}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {isQueryLoading ? <QueryLoadingNotice /> : null}

            <Card className={referencePanelClassName}>
              <CardHeader className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-slate-500" />
                  <CardTitle className="text-lg">Detalhes das Vendas</CardTitle>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className={referenceToolbarButtonClassName}
                    onClick={handleExportOrders}
                    disabled={sortedOrders.length === 0 || isQueryLoading}
                  >
                    <FileDown className="mr-2 h-4 w-4" />
                    Exportar
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={referenceToolbarButtonClassName}
                    onClick={() => setViewMode(viewMode === "table" ? "cards" : "table")}
                  >
                    {viewMode === "table" ? <LayoutGrid className="mr-2 h-4 w-4" /> : <Table2 className="mr-2 h-4 w-4" />}
                    {viewMode === "table" ? "Cards" : "Tabela"}
                  </Button>
                  <div
                    className="inline-flex h-9 rounded-md border border-slate-200 bg-white p-0.5 shadow-sm"
                    aria-label="Densidade da tabela"
                  >
                    {tableDensityOptions.map((option) => {
                      const active = tableDensity === option.id;

                      return (
                        <Button
                          key={option.id}
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-8 rounded px-2.5 text-xs",
                            active
                              ? "bg-slate-900 text-white hover:bg-slate-900 hover:text-white"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                          )}
                          aria-pressed={active}
                          onClick={() => setTableDensity(option.id)}
                        >
                          <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
                          {option.label}
                        </Button>
                      );
                    })}
                  </div>
                  <ColumnVisibilityPopover
                    columnOptions={availableColumnOptions}
                    visibleColumnIds={visibleColumnIds}
                    visibleCount={visibleDataColumnCount}
                    onToggleColumn={toggleColumnVisibility}
                    onShowAll={showAllColumns}
                    onHideAll={hideAllColumns}
                    onReset={resetVisibleColumns}
                    isLoading={isQueryLoading}
                  />
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid gap-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3 sm:grid-cols-2 xl:grid-cols-4">
              {tableOperationMetrics.map((metric) => (
                <div key={metric.label} className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{metric.label}</p>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-950">{metric.value}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{metric.helper}</p>
                </div>
              ))}
            </div>

            {selectedOrders.length > 0 ? (
              <div className="mb-4 flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {formatNumber(selectedOrders.length)} pedido(s) selecionado(s)
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatNumber(selectedPageCount)} nesta página · {formatNumber(selectedFilteredCount)} no filtro atual
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                  {selectedFilteredCount < filteredOrders.length ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleFilteredSelection(true)}
                      disabled={isSaving || filteredOrders.length === 0}
                    >
                      <Files className="mr-2 h-4 w-4" />
                      Selecionar filtrados
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedOrderIds(new Set())}
                    disabled={isSaving}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Limpar seleção
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleSaveConciliation(selectedOrders, true)}
                    disabled={isSaving}
                  >
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-2 h-4 w-4" />}
                    Conciliar selecionados
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSaveConciliation(selectedOrders, false)}
                    disabled={isSaving}
                  >
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Undo2 className="mr-2 h-4 w-4" />}
                    Desfazer conciliação
                  </Button>
                </div>
              </div>
            ) : null}

            {viewMode === "cards" ? (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                    <Checkbox
                      aria-label="Selecionar pedidos da página"
                      checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                      onCheckedChange={(checked) => togglePageSelection(checked === true)}
                      disabled={paginatedOrders.length === 0 || isSaving}
                    />
                    Selecionar página
                  </label>
                  <p className="text-sm text-muted-foreground">
                    {formatNumber(paginatedOrders.length)} pedido(s) nesta página
                  </p>
                </div>

                {isQueryLoading ? (
                  <ConciliationLoadingState />
                ) : paginatedOrders.length > 0 ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {paginatedOrders.map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        selected={selectedOrderIds.has(order.id)}
                        isSaving={isSaving}
                        onSelect={(checked) => toggleOrderSelection(order.id, checked)}
                        onOpen={() => setSelectedOrder(order)}
                        onToggleReconciled={() => handleSaveConciliation([order], !order.isReconciled)}
                      />
                    ))}
                  </div>
                ) : (
                  <ConciliationEmptyState
                    hasAppliedFilters={hasAppliedFilters}
                    searchTerm={appliedFilters.searchTerm}
                  />
                )}
              </div>
            ) : (
              <div className="relative rounded-md border border-slate-200 bg-white" aria-busy={Boolean(sortFeedback)}>
                {sortFeedback ? (
                  <div
                    className="pointer-events-none absolute left-1/2 top-16 z-50 -translate-x-1/2 rounded-md border border-purple-200 bg-white/95 px-4 py-3 text-sm shadow-lg backdrop-blur"
                    role="status"
                    aria-live="polite"
                  >
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
                      <div>
                        <p className="font-medium text-zinc-900">Ordenando pedidos...</p>
                        <p className="text-xs text-zinc-500">
                          {sortFeedback.columnLabel} · {formatNumber(sortFeedback.totalRows)} registros
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
                {columnMoveFeedback ? (
                  <div
                    className="pointer-events-none absolute left-1/2 top-16 z-50 -translate-x-1/2 rounded-md border border-slate-200 bg-white/95 px-4 py-3 text-sm shadow-lg backdrop-blur"
                    role="status"
                    aria-live="polite"
                  >
                    <div className="flex items-center gap-3">
                      <Columns3 className="h-4 w-4 text-slate-600" />
                      <div>
                        <p className="font-medium text-zinc-900">Coluna movida</p>
                        <p className="text-xs text-zinc-500">
                          {columnMoveFeedback.columnLabel} · {columnMoveFeedback.detail}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className={cn("max-h-[70vh] overflow-auto transition-opacity", sortFeedback && "opacity-60")}>
                <Table
                  className="min-w-[1760px]"
                  style={tableStyle}
                >
                <TableHeader className={tableHeaderClassName}>
                  <TableRow className="bg-zinc-50/60 hover:bg-transparent">
                    <TableHead className="sticky left-0 top-0 z-30 w-12 bg-zinc-50/95">
                      <Checkbox
                        aria-label={
                          allFilteredSelected
                            ? `Desmarcar todos os ${formatNumber(filteredOrders.length)} pedidos filtrados`
                            : `Selecionar todos os ${formatNumber(filteredOrders.length)} pedidos filtrados`
                        }
                        checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
                        onCheckedChange={(checked) => toggleFilteredSelection(checked === true)}
                        disabled={filteredOrders.length === 0 || isSaving}
                      />
                    </TableHead>
                    {orderedVisibleColumnIds.map((columnId, columnIndex) => {
                      const column = availableColumnOptionById.get(columnId);
                      const align = getColumnAlignment(columnId);
                      const isDragging = draggedColumnId === columnId;
                      const isDropTarget =
                        dragOverColumnId === columnId && draggedColumnId !== null && draggedColumnId !== columnId;
                      const canMoveLeft = columnIndex > 0;
                      const canMoveRight = columnIndex < orderedVisibleColumnIds.length - 1;

                      if (!column) return null;

                      return (
                        <TableHead
                          key={columnId}
                          className={cn(
                            "select-none transition-colors",
                            columnId === "conciliation" && columnIndex === 0 && "sticky left-12 top-0 z-30 bg-zinc-50/95",
                            isDragging && "opacity-40",
                            isDropTarget && "bg-purple-50 shadow-[inset_2px_0_0_rgba(147,51,234,0.65)]"
                          )}
                          onDragOver={(event) => handleColumnDragOver(event, columnId)}
                          onDragLeave={() => {
                            if (dragOverColumnId === columnId) {
                              setDragOverColumnId(null);
                            }
                          }}
                          onDrop={(event) => handleColumnDrop(event, columnId)}
                        >
                          <div
                            className={cn(
                              "group/header flex items-center gap-1.5",
                              align === "right" && "justify-end",
                              align === "center" && "justify-center"
                            )}
                          >
                            <span
                              role="button"
                              tabIndex={0}
                              draggable
                              className="inline-flex h-7 w-5 cursor-grab items-center justify-center rounded text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-500 active:cursor-grabbing"
                              title="Arraste para reordenar"
                              aria-label={`Reordenar coluna ${column.label}`}
                              onClick={(event) => event.stopPropagation()}
                              onDragStart={(event) => handleColumnDragStart(event, columnId)}
                              onDragEnd={handleColumnDragEnd}
                            >
                              <GripVertical className="h-4 w-4" />
                            </span>
                            <div className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-white p-0.5 opacity-0 shadow-sm transition-opacity group-hover/header:opacity-100 group-focus-within/header:opacity-100">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                disabled={!canMoveLeft}
                                aria-label={`Mover coluna ${column.label} para a esquerda`}
                                title="Mover para a esquerda"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  moveVisibleColumn(columnId, -1);
                                }}
                              >
                                <ChevronLeft className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                disabled={!canMoveRight}
                                aria-label={`Mover coluna ${column.label} para a direita`}
                                title="Mover para a direita"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  moveVisibleColumn(columnId, 1);
                                }}
                              >
                                <ChevronRight className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            <SortableHeader
                              columnId={columnId}
                              label={column.label}
                              align={align}
                              sortConfig={sortConfig}
                              sortFeedback={sortFeedback}
                              onSort={handleSort}
                            />
                          </div>
                        </TableHead>
                      );
                    })}
                    <TableHead className={stickyActionHeaderClassName}>Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className={tableBodyClassName}>
                  {isQueryLoading ? (
                    <TableRow>
                      <TableCell colSpan={tableColSpan} className="p-6">
                        <ConciliationTableLoadingState
                          columnCount={visibleDataColumnCount}
                          density={tableDensity}
                        />
                      </TableCell>
                    </TableRow>
                  ) : paginatedOrders.length > 0 ? (
                    paginatedOrders.map((order) => {
                      const isExpanded = expandedOrderIds.has(order.id);

                      return (
                      <React.Fragment key={order.id}>
                      <TableRow
                        className={cn(mainTableRowClassName, isExpanded && "bg-muted/20")}
                        onClick={(event) => {
                          const target = event.target as HTMLElement;

                          if (target.closest("button, input, a, [data-stop-row-click]")) return;

                          setSelectedOrder(order);
                        }}
                      >
                        <TableCell
                          className={cn(
                            "sticky left-0 z-10 bg-white transition-colors group-hover:bg-zinc-50",
                            getOrderRowMarkerClassName(order)
                          )}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Checkbox
                            aria-label={`Selecionar pedido ${order.number || order.orderId}`}
                            checked={selectedOrderIds.has(order.id)}
                            onCheckedChange={(checked) => toggleOrderSelection(order.id, checked === true)}
                            disabled={isSaving}
                          />
                        </TableCell>
                        {orderedVisibleColumnIds.map((columnId, columnIndex) =>
                          renderOrderColumnCell(order, columnId, isExpanded, columnIndex)
                        )}
                        <TableCell
                          className={stickyActionCellClassName}
                          data-stop-row-click="true"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Button
                            size="sm"
                            variant={order.isReconciled ? "outline" : "default"}
                            onClick={() => handleSaveConciliation([order], !order.isReconciled)}
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
                        </TableCell>
                      </TableRow>
                      {isExpanded
                        ? order.items.map((item, itemIndex) => (
                            <TableRow
                              key={`${order.id}:item:${item.id || itemIndex}`}
                              className={itemTableRowClassName}
                            >
                              <TableCell className="sticky left-0 z-10 bg-zinc-50" />
                              {orderedVisibleColumnIds.map((columnId, columnIndex) =>
                                renderOrderItemColumnCell(order, item, itemIndex, columnId, columnIndex)
                              )}
                              <TableCell className={stickyItemActionCellClassName}>
                                Item
                              </TableCell>
                            </TableRow>
                          ))
                        : null}
                      </React.Fragment>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={tableColSpan} className="p-6">
                        <ConciliationEmptyState
                          hasAppliedFilters={hasAppliedFilters}
                          searchTerm={appliedFilters.searchTerm}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
                </Table>
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-col gap-4 border-t pt-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="text-sm text-muted-foreground">
                Página {currentPage} de {totalPages}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Itens por página</span>
                  <Select
                    value={String(rowsPerPage)}
                    onValueChange={(value) => setRowsPerPage(Number(value))}
                  >
                    <SelectTrigger className="h-8 w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {rowsPerPageOptions.map((option) => (
                        <SelectItem key={option} value={String(option)}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="hidden h-8 w-8 p-0 sm:inline-flex"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                  >
                    <span className="sr-only">Primeira página</span>
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className="h-8 w-8 p-0"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={currentPage === 1}
                  >
                    <span className="sr-only">Página anterior</span>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className="h-8 w-8 p-0"
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    disabled={currentPage === totalPages}
                  >
                    <span className="sr-only">Próxima página</span>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className="hidden h-8 w-8 p-0 sm:inline-flex"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                  >
                    <span className="sr-only">Última página</span>
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
            </Card>
          </>
        )}
      </div>

      <SummarySettingsDialog
        open={isSummarySettingsOpen}
        onOpenChange={setIsSummarySettingsOpen}
        summarySettings={summarySettings}
        isSaving={isSaving}
        onSave={handleSaveSummarySettings}
      />
      <CalculationSettingsDialog
        open={isCalculationSettingsOpen}
        onOpenChange={setIsCalculationSettingsOpen}
        calculationSettings={calculationSettings}
        isSaving={isSaving}
        onSave={handleSaveCalculationSettings}
      />
      <FinancialDivergenceSettingsDialog
        open={isDivergenceSettingsOpen}
        onOpenChange={setIsDivergenceSettingsOpen}
        orders={filteredOrders}
        divergenceSettings={divergenceSettings}
        isSaving={isSaving}
        onSave={handleSaveDivergenceSettings}
      />
      <StatusMappingsDialog
        open={isStatusSettingsOpen}
        onOpenChange={setIsStatusSettingsOpen}
        orders={filteredOrders}
        statusMappings={statusSettings.statusMappings}
        statusSettings={statusSettings}
        isSaving={isSaving}
        onSave={handleSaveStatusMappings}
      />
      <PayoutImportDialog
        open={isPayoutImportOpen}
        onOpenChange={setIsPayoutImportOpen}
        orders={allOrders}
        marketplaceOptions={marketplaceOptions}
        isSaving={isSaving}
        onSave={handleImportPayouts}
      />
      <PayoutHistoryDialog
        open={isPayoutHistoryOpen}
        onOpenChange={setIsPayoutHistoryOpen}
        groups={payoutImportGroups}
        orderKeySet={payoutOrderKeySet}
        isSaving={isSaving}
        onDeleteImport={handleDeletePayoutImport}
      />
      <OrderDetailsDialog
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        isSaving={isSaving}
        onSaveSystemStatus={handleSaveSystemStatus}
        onSaveFinancialAdjustments={handleSaveFinancialAdjustments}
      />
    </DashboardLayout>
  );
}
