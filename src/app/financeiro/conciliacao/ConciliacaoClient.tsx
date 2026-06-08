"use client";

import * as React from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  Calendar as CalendarIcon,
  BarChart3,
  Calculator,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  DollarSign,
  Filter,
  FileDown,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Files,
  GripVertical,
  Hash,
  History,
  CircleAlert,
  ListChecks,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  LayoutGrid,
  Loader2,
  Lock,
  Package,
  Percent,
  Plus,
  ReceiptText,
  RotateCcw,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Table2,
  TrendingUp,
  Truck,
  Trash2,
  Undo2,
  Upload,
  User,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { endOfDay, endOfMonth, format, parseISO, startOfDay, startOfMonth, subDays, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useRouter } from "next/navigation";
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
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
  conciliationSystemStatusColorSwatches,
  defaultConciliationSystemStatusSettings,
  getConciliationSystemStatusDefinition,
  getConciliationSystemStatusDisplayName,
  normalizeConciliationSystemStatusSettings,
  serializeConciliationSystemStatusSettings,
} from "@/lib/conciliation/system-status-settings";
import { cn } from "@/lib/utils";
import {
  applyAccountMappings,
  applyStatusMappings,
  applyMarketplacePayouts,
  applyCustomCalculationsToOrders,
  applySheetAssociationsToOrders,
  applyFinancialDivergenceRules,
  applyConciliationRecords,
  calculateConciliationSummary,
  fetchConciliationState,
  deleteConciliationMarketplacePayoutImport,
  saveConciliationAccountMappings,
  saveConciliationRecords,
  saveConciliationCalculationSettings,
  saveConciliationDivergenceSettings,
  saveConciliationFinancialAdjustments,
  saveConciliationMarketplacePayouts,
  saveConciliationStatusMappings,
  saveConciliationSummarySettings,
  saveConciliationSystemStatus,
  saveConciliationSystemStatusSettings,
  normalizeConciliationPayoutOrderKey,
  subscribeConciliationOrders,
} from "@/services/conciliation-service";
import { fetchSheetAssociations } from "@/services/planilhas-service";
import type { ConciliationSheetAssociation } from "@/types/conciliation-planilhas";
import type {
  ConciliationAccountMappings,
  ConciliationAccountSettings,
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
  ConciliationSystemStatusDefinition,
  ConciliationSystemStatusSettings,
  ConciliationSummary,
} from "@/types/conciliation";


import {
  AdjustmentStatusFilter,
  AppliedFilters,
  CalculatedColumnsBadge,
  ColumnMoveFeedback,
  ColumnVisibilityPopover,
  ConciliationCalculationColumnId,
  ConciliationColumnId,
  ConciliationColumnOption,
  ConciliationEmptyState,
  ConciliationLoadingState,
  ConciliationSuggestionBadge,
  ConciliationTableLoadingState,
  FinancialAdjustmentsBadge,
  FinancialAlertFilter,
  FinancialDivergenceBadge,
  InlineSystemStatusSelect,
  OrderCard,
  PayoutComparisonBadge,
  PayoutStatusFilter,
  PeriodSummaryMetricCard,
  QueryLoadingNotice,
  ReconciliationStatusFilter,
  SortConfig,
  SortFeedback,
  SortableHeader,
  SuggestionFilter,
  SystemStatusBadge,
  SystemStatusFilter,
  SystemStatusSelectValue,
  TableDensity,
  ViewMode,
  adjustmentStatusOptions,
  allocateOrderAmountToItem,
  automaticStatusSelectValue,
  appliedQueryStorageKey,
  buildCalculationColumnOptions,
  buildConciliationAuditEvents,
  buildDefaultColumnOrderWithCalculations,
  columnOrderStorageKey,
  compareString,
  conciliationColumnOptions,
  defaultColumnOrderIds,
  defaultVisibleColumnIds,
  emptySummary,
  financialAlertOptions,
  formatActor,
  formatCalculationValue,
  formatClock,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercentage,
  getActiveFinancialAdjustments,
  getCalculationIdFromColumnId,
  getColumnAlignment,
  getOrderCalculationValues,
  getOrderRowMarkerClassName,
  getSortValue,
  getStatusVariant,
  isCalculationColumnId,
  isConciliationColumnId,
  isConciliationSuggestionCandidate,
  isDateInRange,
  isStaticConciliationColumnId,
  knownCalculationColumnsStorageKey,
  normalizeColumnOrderIds,
  payoutStatusOptions,
  reconciliationStatusOptions,
  referenceCompactButtonClassName,
  referenceControlClassName,
  referenceDateButtonClassName,
  referenceOutlineButtonClassName,
  referencePanelClassName,
  referencePrimaryButtonClassName,
  referenceToolbarButtonClassName,
  buildSheetColumnOptions,
  getSheetKeyFromColumnId,
  rowsPerPageOptions,
  serializeStatusMappings,
  suggestionOptions,
  summaryMetricDefinitionById,
  viewModeStorageKey,
  visibleColumnsStorageKey,
} from "./components/shared";
import {
  CalculationSettingsDialog,
  FinancialDivergenceSettingsDialog,
  StatusMappingsDialog,
  SummarySettingsDialog,
} from "./components/settings-dialogs";
import {
  PayoutHistoryDialog,
  PayoutImportDialog,
  PayoutImportGroup,
  buildPayoutImportGroups,
  getOrderPayoutImportKeys,
} from "./components/payouts";
import {
  OrderDetailsDialog,
} from "./components/OrderDetailsDialog";

type SummaryMetricTone = "blue" | "red" | "green" | "cyan";

const summaryToneByMetricId: Partial<Record<ConciliationSummaryMetricId, SummaryMetricTone>> = {
  grossRevenue: "blue",
  netRevenue: "cyan",
  productCost: "red",
  contributionMargin: "green",
  contributionMarginPercentage: "green",
  averageTicket: "blue",
  itemsQuantity: "blue",
  ordersCount: "blue",
  reconciledPercentage: "cyan",
  financialAlertCount: "red",
  financialRiskAmount: "red",
};

type StoredAppliedQuery = {
  filters: AppliedFilters;
  appliedAt: Date | null;
};

const CompactFilterGroup = ({
  title,
  active,
  children,
}: {
  title: string;
  active: number;
  children: React.ReactNode;
}) => (
  <div className="min-w-[180px] space-y-3">
    <div className="flex min-h-5 items-center justify-between gap-2">
      <h5 className="text-xs font-bold uppercase tracking-widest text-zinc-500">{title}</h5>
      {active > 0 ? (
        <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px]">
          {active}
        </Badge>
      ) : null}
    </div>
    <div className="space-y-1">{children}</div>
  </div>
);

const CompactFilterOption = ({
  checked,
  color,
  count,
  label,
  muted,
  onClick,
}: {
  checked: boolean;
  color?: string;
  count?: number;
  label: string;
  muted?: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    onClick={onClick}
    className="group flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-50"
  >
    <span
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-zinc-300 bg-white group-hover:border-primary/60"
      )}
    >
      {checked ? <Check className="h-3 w-3" /> : null}
    </span>
    {color ? (
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
    ) : null}
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-sm text-zinc-600 group-hover:text-zinc-950",
        muted && "text-zinc-400"
      )}
    >
      {label}
    </span>
    {typeof count === "number" ? (
      <span
        className={cn(
          "ml-auto inline-flex h-5 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
          checked ? "bg-primary/10 text-primary" : "bg-zinc-100 text-zinc-500"
        )}
      >
        {count.toLocaleString("pt-BR")}
      </span>
    ) : null}
  </button>
);

const SettingsMenuItem = ({
  icon: Icon,
  title,
  description,
  badge,
  disabled,
  onClick,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  badge?: string;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <Button
    type="button"
    variant="ghost"
    className="h-auto w-full justify-start rounded-lg px-3 py-2.5 text-left hover:bg-slate-50"
    onClick={onClick}
    disabled={disabled}
  >
    <span className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm">
      <Icon className="h-4 w-4" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2">
        <span className="truncate text-sm font-semibold text-slate-950">{title}</span>
        {badge ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="mt-0.5 block whitespace-normal text-xs font-normal leading-snug text-slate-500">
        {description}
      </span>
    </span>
  </Button>
);

const SettingsMenuSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{title}</p>
    {children}
  </div>
);

const SettingsDetailLine = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="space-y-1">
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
    <div className="text-sm font-semibold text-slate-950">{value}</div>
  </div>
);

const normalizeAccountMappingsDraft = (mappings: ConciliationAccountMappings): ConciliationAccountMappings =>
  Object.entries(mappings).reduce<ConciliationAccountMappings>((normalized, [accountId, name]) => {
    const trimmedAccountId = accountId.trim();
    const trimmedName = name.trim();

    if (trimmedAccountId && trimmedName) {
      normalized[trimmedAccountId] = trimmedName;
    }

    return normalized;
  }, {});

const serializeAccountMappings = (mappings: ConciliationAccountMappings) =>
  JSON.stringify(
    Object.entries(normalizeAccountMappingsDraft(mappings))
      .sort(([first], [second]) => compareString(first, second))
      .map(([accountId, name]) => [accountId, name])
  );

type ConciliationSettingsHubTab =
  | "account-mapping"
  | "order-status"
  | "auto-reconciliation"
  | "system-status";

const settingsHubTabItems: Array<{
  value: ConciliationSettingsHubTab;
  label: string;
  icon: React.ElementType;
}> = [
  { value: "account-mapping", label: "Mapeamento de Conta", icon: BadgeCheck },
  { value: "order-status", label: "Mapeamento Status", icon: Settings2 },
  { value: "auto-reconciliation", label: "Conciliação Automática", icon: Zap },
  { value: "system-status", label: "Status Sistema", icon: ListChecks },
];

const ConciliationSettingsHubDialog = ({
  open,
  onOpenChange,
  orders,
  isLoading,
  isSaving,
  accountSettings,
  statusSettings,
  systemStatusSettings,
  summaryCardsCount,
  calculationColumnsCount,
  divergenceRulesCount,
  statusMappingsCount,
  payoutRowsCount,
  onSaveAccountMappings,
  onSaveStatusMappings,
  onSaveSystemStatusSettings,
  onApplySuggestedConciliations,
  onOpenSummarySettings,
  onOpenCalculationSettings,
  onOpenDivergenceSettings,
  onOpenStatusSettings,
  onOpenPayoutImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: ConciliationOrder[];
  isLoading: boolean;
  isSaving: boolean;
  accountSettings: ConciliationAccountSettings;
  statusSettings: ConciliationStatusSettings;
  systemStatusSettings: ConciliationSystemStatusSettings;
  summaryCardsCount: number;
  calculationColumnsCount: number;
  divergenceRulesCount: number;
  statusMappingsCount: number;
  payoutRowsCount: number;
  onSaveAccountMappings: (accountMappings: ConciliationAccountMappings) => void | Promise<void>;
  onSaveStatusMappings: (statusMappings: ConciliationStatusMappings) => void | Promise<void>;
  onSaveSystemStatusSettings: (
    systemStatusSettings: ConciliationSystemStatusSettings
  ) => void | Promise<void>;
  onApplySuggestedConciliations: () => void;
  onOpenSummarySettings: () => void;
  onOpenCalculationSettings: () => void;
  onOpenDivergenceSettings: () => void;
  onOpenStatusSettings: () => void;
  onOpenPayoutImport: () => void;
}) => {
  const [activeTab, setActiveTab] = React.useState<ConciliationSettingsHubTab>("account-mapping");
  const [draftAccountMappings, setDraftAccountMappings] = React.useState<ConciliationAccountMappings>({});
  const [draftStatusMappings, setDraftStatusMappings] = React.useState<ConciliationStatusMappings>({});
  const [draftSystemStatusSettings, setDraftSystemStatusSettings] =
    React.useState<ConciliationSystemStatusSettings>(defaultConciliationSystemStatusSettings);
  const normalizedSystemStatusSettings = React.useMemo(
    () => normalizeConciliationSystemStatusSettings(systemStatusSettings),
    [systemStatusSettings]
  );

  React.useEffect(() => {
    if (open) {
      setActiveTab("account-mapping");
    }
  }, [open]);

  React.useEffect(() => {
    if (open) setDraftAccountMappings(accountSettings.accountMappings);
  }, [accountSettings.accountMappings, open]);

  React.useEffect(() => {
    if (open) setDraftStatusMappings(statusSettings.statusMappings);
  }, [open, statusSettings.statusMappings]);

  React.useEffect(() => {
    if (open) setDraftSystemStatusSettings(normalizedSystemStatusSettings);
  }, [normalizedSystemStatusSettings, open]);

  const accountSections = React.useMemo(() => {
    const sections = new Map<
      string,
      {
        marketplace: string;
        entries: Map<
          string,
          {
            accountId: string;
            accountName: string;
            originalAccountName: string;
            mappedName: string;
            marketplace: string;
            orderCount: number;
          }
        >;
      }
    >();

    orders.forEach((order) => {
      const originalAccountName = order.originalOrder?.loja?.nome || "Conta não informada";
      const marketplace = order.marketplace || "Sem marketplace";
      const accountId = String(order.originalOrder?.loja?.id || originalAccountName || "sem-conta");
      const mappedName = accountSettings.accountMappings[accountId] || "";
      const accountName = mappedName || originalAccountName;
      const section = sections.get(marketplace) || { marketplace, entries: new Map() };
      const current = section.entries.get(accountId) || {
        accountId,
        accountName,
        originalAccountName,
        mappedName,
        marketplace,
        orderCount: 0,
      };

      current.orderCount += 1;
      section.entries.set(accountId, current);
      sections.set(marketplace, section);
    });

    return Array.from(sections.values())
      .map((section) => ({
        ...section,
        entries: Array.from(section.entries.values()).sort(
          (first, second) => compareString(first.accountName, second.accountName) || compareString(first.accountId, second.accountId)
        ),
      }))
      .sort((first, second) => compareString(first.marketplace, second.marketplace));
  }, [accountSettings.accountMappings, orders]);

  const accountEntries = React.useMemo(
    () => accountSections.flatMap((section) => section.entries),
    [accountSections]
  );

  const statusRows = React.useMemo(() => {
    const rows = new Map<string, { statusName: string; orderCount: number; manualCount: number }>();

    orders.forEach((order) => {
      const current =
        rows.get(order.statusName) || {
          statusName: order.statusName,
          orderCount: 0,
          manualCount: 0,
        };

      current.orderCount += 1;
      if (order.manualSystemStatus) current.manualCount += 1;
      rows.set(order.statusName, current);
    });

    return Array.from(rows.values()).sort((first, second) => compareString(first.statusName, second.statusName));
  }, [orders]);

  const autoReconciliationMatchedOrders = React.useMemo(
    () =>
      orders.filter(
        (order) =>
          order.systemStatus === "Entregue" &&
          order.financialDivergence.severity === "ok" &&
          order.payoutComparison.status === "matched"
      ),
    [orders]
  );
  const autoReconciliationPendingOrders = React.useMemo(
    () => autoReconciliationMatchedOrders.filter((order) => !order.isReconciled),
    [autoReconciliationMatchedOrders]
  );
  const autoReconciliationAlreadyOrders = React.useMemo(
    () => autoReconciliationMatchedOrders.filter((order) => order.isReconciled),
    [autoReconciliationMatchedOrders]
  );
  const autoReconciliationExamples = React.useMemo(
    () =>
      autoReconciliationPendingOrders
        .slice(0, 6)
        .map((order) => `#${order.number || order.orderId}`),
    [autoReconciliationPendingOrders]
  );
  const autoReconciliationBlockedCount = Math.max(
    0,
    orders.filter((order) => !order.isReconciled).length - autoReconciliationPendingOrders.length
  );

  const openNestedSettings = (handler: () => void) => {
    onOpenChange(false);
    handler();
  };

  const accountMappingsChanged =
    serializeAccountMappings(draftAccountMappings) !== serializeAccountMappings(accountSettings.accountMappings);
  const statusMappingsChanged =
    serializeStatusMappings(draftStatusMappings) !== serializeStatusMappings(statusSettings.statusMappings);
  const systemStatusSettingsChanged =
    serializeConciliationSystemStatusSettings(draftSystemStatusSettings) !==
    serializeConciliationSystemStatusSettings(normalizedSystemStatusSettings);
  const systemStatusDefaultChanged =
    serializeConciliationSystemStatusSettings(draftSystemStatusSettings) !==
    serializeConciliationSystemStatusSettings(defaultConciliationSystemStatusSettings);
  const systemStatusActiveCount = draftSystemStatusSettings.statuses.filter((status) => status.active).length;
  const systemStatusInactiveCount = draftSystemStatusSettings.statuses.length - systemStatusActiveCount;
  const normalizedDraftAccountMappings = React.useMemo(
    () => normalizeAccountMappingsDraft(draftAccountMappings),
    [draftAccountMappings]
  );
  const previewStatusAffectedCount = React.useMemo(
    () =>
      orders.reduce((total, order) => {
        if (order.manualSystemStatus) return total;

        const nextAutomaticStatus =
          draftStatusMappings[order.statusName] ?? resolveAutomaticSystemStatus(order.statusName);

        return total + (nextAutomaticStatus !== order.automaticSystemStatus ? 1 : 0);
      }, 0),
    [draftStatusMappings, orders]
  );

  const updateAccountMapping = (accountId: string, name: string) => {
    setDraftAccountMappings((previous) => ({
      ...previous,
      [accountId]: name,
    }));
  };

  const handleSaveAccountMappings = () => {
    onSaveAccountMappings(normalizedDraftAccountMappings);
  };

  const handleStatusMappingChange = (statusName: string, value: SystemStatusSelectValue) => {
    setDraftStatusMappings((previous) => {
      const next = { ...previous };

      if (value === automaticStatusSelectValue) {
        delete next[statusName];
      } else {
        next[statusName] = value;
      }

      return next;
    });
  };

  const handleSaveStatusMappings = () => {
    onSaveStatusMappings(draftStatusMappings);
  };

  const updateSystemStatusDefinition = (
    statusId: ConciliationSystemStatus,
    updates: Partial<Pick<ConciliationSystemStatusDefinition, "active" | "color" | "displayName">>
  ) => {
    setDraftSystemStatusSettings((previous) =>
      normalizeConciliationSystemStatusSettings({
        ...previous,
        statuses: previous.statuses.map((definition) =>
          definition.id === statusId
            ? {
                ...definition,
                ...updates,
                updatedAt: new Date().toISOString(),
              }
            : definition
        ),
      })
    );
  };

  const resetSystemStatusSettings = () => {
    setDraftSystemStatusSettings(normalizeConciliationSystemStatusSettings(defaultConciliationSystemStatusSettings));
  };

  const handleSaveSystemStatusSettings = () => {
    onSaveSystemStatusSettings(normalizeConciliationSystemStatusSettings(draftSystemStatusSettings));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[98vw] max-w-[1800px] flex-col overflow-x-hidden p-4 sm:p-6">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="text-lg leading-tight sm:text-xl">Configurações da conciliação</DialogTitle>
          <DialogDescription className="break-words leading-relaxed">
            Ajuste contas, status do sistema e mapeamentos da conciliação.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div
            role="tablist"
            className="inline-flex max-w-full flex-wrap items-center gap-1 self-start rounded-full bg-muted p-1"
          >
            {settingsHubTabItems.map((item) => {
              const active = item.value === activeTab;
              const Icon = item.icon;
              const count =
                item.value === "account-mapping"
                  ? accountEntries.length
                  : item.value === "order-status"
                    ? statusRows.length
                    : item.value === "auto-reconciliation"
                      ? 1
                      : systemStatusActiveCount;

              return (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(item.value)}
                  className={cn(
                    "relative inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-all",
                    active
                      ? "bg-white text-slate-950 shadow-sm"
                      : "text-muted-foreground hover:text-slate-950"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="truncate">{item.label}</span>
                  <span
                    className={cn(
                      "ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold",
                      active ? "bg-blue-50 text-blue-700" : "bg-zinc-200 text-zinc-600"
                    )}
                  >
                    {formatNumber(count)}
                  </span>
                </button>
              );
            })}
          </div>

          {activeTab === "account-mapping" ? (
            <div className="mt-0 flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-gradient-to-b from-zinc-50/60 to-white">
                <div className="space-y-6 p-4 sm:p-5">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border bg-white p-3">
                      <SettingsDetailLine label="Contas detectadas" value={formatNumber(accountEntries.length)} />
                    </div>
                    <div className="rounded-lg border bg-white p-3">
                      <SettingsDetailLine label="Pedidos no escopo" value={formatNumber(orders.length)} />
                    </div>
                    <div className="rounded-lg border bg-white p-3">
                      <SettingsDetailLine
                        label="Sem conta"
                        value={formatNumber(
                          accountEntries.filter((account) => !(draftAccountMappings[account.accountId] || "").trim()).length
                        )}
                      />
                    </div>
                  </div>

                  {accountSections.length > 0 ? (
                    accountSections.map((section) => {
                      const totalOrders = section.entries.reduce((total, account) => total + account.orderCount, 0);
                      const unnamedCount = section.entries.filter(
                        (account) => !(draftAccountMappings[account.accountId] || "").trim()
                      ).length;

                      return (
                        <section key={section.marketplace}>
                          <header className="mb-3 flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-white text-slate-600 shadow-sm">
                                <BadgeCheck className="h-4 w-4" />
                              </span>
                              <div className="min-w-0">
                                <h3 className="truncate text-sm font-semibold text-slate-950">{section.marketplace}</h3>
                                <p className="text-xs text-muted-foreground">
                                  {formatNumber(section.entries.length)}{" "}
                                  {section.entries.length === 1 ? "conta" : "contas"} ·{" "}
                                  {formatNumber(totalOrders)} pedidos
                                </p>
                              </div>
                            </div>
                            {unnamedCount > 0 ? (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                                <AlertTriangle className="h-3 w-3" />
                                {formatNumber(unnamedCount)} sem nome
                              </span>
                            ) : null}
                          </header>

                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {section.entries.map((account) => {
                              const draftValue = draftAccountMappings[account.accountId] ?? "";
                              const isNamed = draftValue.trim() !== "";

                              return (
                                <div
                                  key={`${section.marketplace}-${account.accountId}`}
                                  className={cn(
                                    "group relative rounded-xl border bg-white p-3.5 transition-all hover:shadow-md",
                                    isNamed ? "border-border" : "border-amber-300/70 ring-1 ring-amber-200/40"
                                  )}
                                >
                                  <div className="flex items-start gap-3">
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-slate-50 text-slate-600">
                                      <BadgeCheck className="h-4 w-4" />
                                    </span>

                                    <div className="min-w-0 flex-1">
                                      <Input
                                        value={draftValue}
                                        placeholder="Defina um nome..."
                                        aria-label={`Nome exibido da conta ${account.accountId}`}
                                        disabled={isSaving}
                                        onChange={(event) => updateAccountMapping(account.accountId, event.target.value)}
                                        className={cn(
                                          "h-7 border-transparent bg-transparent px-0 text-sm font-semibold shadow-none focus-visible:border-blue-300 focus-visible:bg-blue-50/30 focus-visible:px-2 focus-visible:ring-0",
                                          isNamed ? "text-slate-950" : "italic text-zinc-400"
                                        )}
                                      />
                                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                        <code className="truncate font-mono">{account.accountId}</code>
                                      </div>
                                      {account.originalAccountName !== "Conta não informada" ? (
                                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                          Atual: {account.originalAccountName}
                                        </div>
                                      ) : null}
                                    </div>

                                    <div className="shrink-0 text-right">
                                      <div className="text-xl font-bold leading-none tabular-nums text-slate-950">
                                        {formatNumber(account.orderCount)}
                                      </div>
                                      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                        Pedidos
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })
                  ) : (
                    <div className="rounded-lg border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">
                      Nenhuma conta detectada no período carregado.
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDraftAccountMappings({})}
                  disabled={isLoading || isSaving || Object.keys(normalizedDraftAccountMappings).length === 0}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Limpar nomes
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveAccountMappings}
                  disabled={isLoading || isSaving || !accountMappingsChanged || accountEntries.length === 0}
                >
                  <Save className="mr-2 h-4 w-4" />
                  Salvar mapeamento
                </Button>
              </div>
            </div>
          ) : null}

          {activeTab === "order-status" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border bg-white p-3">
                  <SettingsDetailLine label="Status encontrados" value={formatNumber(statusRows.length)} />
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <SettingsDetailLine label="Pedidos no escopo" value={formatNumber(orders.length)} />
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <SettingsDetailLine
                    label="Preview de impacto"
                    value={`${formatNumber(previewStatusAffectedCount)} pedido(s)`}
                  />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-gradient-to-b from-zinc-50/60 to-white">
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
                        const selectedStatus = draftStatusMappings[row.statusName] ?? automaticStatusSelectValue;
                        const proposedStatus = draftStatusMappings[row.statusName] ?? defaultStatus;
                        const affectedCount = orders.filter(
                          (order) =>
                            order.statusName === row.statusName &&
                            !order.manualSystemStatus &&
                            order.automaticSystemStatus !== proposedStatus
                        ).length;

                        return (
                          <TableRow key={row.statusName}>
                            <TableCell className="min-w-52 font-medium">{row.statusName}</TableCell>
                            <TableCell className="text-right">{formatNumber(row.orderCount)}</TableCell>
                            <TableCell className="text-right">{formatNumber(row.manualCount)}</TableCell>
                            <TableCell>
                              <SystemStatusBadge
                                status={defaultStatus}
                                systemStatusSettings={normalizedSystemStatusSettings}
                              />
                            </TableCell>
                            <TableCell className="min-w-56">
                              <Select
                                value={selectedStatus}
                                onValueChange={(value) =>
                                  handleStatusMappingChange(row.statusName, value as SystemStatusSelectValue)
                                }
                                disabled={isSaving}
                              >
                                <SelectTrigger className="h-9 bg-white">
                                  <SelectValue placeholder="Status de sistema" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={automaticStatusSelectValue}>
                                    {`Automático (${getConciliationSystemStatusDisplayName(
                                      normalizedSystemStatusSettings,
                                      defaultStatus
                                    )})`}
                                  </SelectItem>
                                  {conciliationSystemStatusOptions.map((statusOption) => {
                                    const statusDefinition = getConciliationSystemStatusDefinition(
                                      normalizedSystemStatusSettings,
                                      statusOption
                                    );

                                    return (
                                      <SelectItem key={statusOption} value={statusOption}>
                                        {statusDefinition.displayName}
                                        {!statusDefinition.active ? " (inativo)" : ""}
                                      </SelectItem>
                                    );
                                  })}
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
                          Nenhum status encontrado no período carregado.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="grid gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3">
                <SettingsDetailLine label="Regras salvas" value={formatNumber(statusMappingsCount)} />
                <SettingsDetailLine label="Atualizado em" value={formatDateTime(statusSettings.updatedAt)} />
                <SettingsDetailLine label="Atualizado por" value={formatActor(statusSettings.updatedBy)} />
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDraftStatusMappings({})}
                  disabled={isSaving || Object.keys(draftStatusMappings).length === 0}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Resetar regras
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveStatusMappings}
                  disabled={isLoading || isSaving || !statusMappingsChanged}
                >
                  <Save className="mr-2 h-4 w-4" />
                  Salvar mapeamento
                </Button>
              </div>
            </div>
          ) : null}

          {activeTab === "auto-reconciliation" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
                  <span className="text-[10px] uppercase tracking-wide opacity-75">Regras ativas</span>
                  1
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200">
                  <span className="text-[10px] uppercase tracking-wide opacity-75">Encontrados na tela</span>
                  {formatNumber(autoReconciliationMatchedOrders.length)}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  <span className="text-[10px] uppercase tracking-wide opacity-75">Pendentes na tela</span>
                  {formatNumber(autoReconciliationPendingOrders.length)}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                  <span className="text-[10px] uppercase tracking-wide opacity-75">Já conciliados</span>
                  {formatNumber(autoReconciliationAlreadyOrders.length)}
                </span>
              </div>

              <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-gradient-to-b from-zinc-50/60 to-white">
                <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                  <section className="rounded-md border bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-[240px] flex-1 items-start gap-3">
                        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700 ring-1 ring-blue-100">
                          1
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="min-w-[220px] max-w-md flex-1 rounded-md border bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-950">
                              Conciliar pedidos sugeridos
                            </div>
                            <SystemStatusBadge
                              status="Entregue"
                              systemStatusSettings={normalizedSystemStatusSettings}
                            />
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700">
                              Ativa
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-600 ring-1 ring-zinc-200">
                              Encontrados <strong className="text-[11px]">{formatNumber(autoReconciliationMatchedOrders.length)}</strong>
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600 ring-1 ring-slate-200">
                              Já conciliados <strong className="text-[11px]">{formatNumber(autoReconciliationAlreadyOrders.length)}</strong>
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 ring-1 ring-emerald-200">
                              Pendentes <strong className="text-[11px]">{formatNumber(autoReconciliationPendingOrders.length)}</strong>
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="secondary" className="gap-1">
                          <Zap className="h-3.5 w-3.5" />
                          Sistema
                        </Badge>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(220px,320px)_minmax(0,1fr)]">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Status Pedido</p>
                        <div className="relative mt-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800">
                          <span className="mr-2 inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                          Entregue
                        </div>
                      </div>

                      <div>
                        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Condições</p>
                          <Badge variant="outline" className="text-[10px]">
                            3 critérios
                          </Badge>
                        </div>
                        <div className="grid gap-2 md:grid-cols-3">
                          <div className="rounded-md border border-zinc-200 bg-zinc-50/80 px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Alerta</p>
                            <p className="mt-1 text-xs font-medium text-zinc-800">Sem alerta financeiro</p>
                          </div>
                          <div className="rounded-md border border-zinc-200 bg-zinc-50/80 px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Repasse</p>
                            <p className="mt-1 text-xs font-medium text-zinc-800">Repasse OK</p>
                          </div>
                          <div className="rounded-md border border-zinc-200 bg-zinc-50/80 px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Conciliação</p>
                            <p className="mt-1 text-xs font-medium text-zinc-800">Somente pendentes</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {autoReconciliationExamples.length > 0 ? (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                        <FileSearch className="h-3.5 w-3.5 text-blue-500" />
                        {autoReconciliationExamples.map((orderNumber) => (
                          <span
                            key={orderNumber}
                            className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600"
                          >
                            {orderNumber}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                        Nenhum pedido pendente atende todos os critérios no escopo carregado.
                      </div>
                    )}
                  </section>

                  <aside className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      <div className="rounded-lg border bg-white p-3">
                        <SettingsDetailLine label="Bloqueados para revisão" value={formatNumber(autoReconciliationBlockedCount)} />
                      </div>
                      <div className="rounded-lg border bg-white p-3">
                        <SettingsDetailLine label="Limite por aplicação" value="450 pedidos" />
                      </div>
                    </div>
                    <div className="rounded-md border bg-white p-2 shadow-sm">
                      <SettingsMenuItem
                        icon={Calculator}
                        title="Colunas calculadas"
                        description="Crie fórmulas e colunas financeiras para a grade."
                        badge={`${formatNumber(calculationColumnsCount)} colunas`}
                        disabled={isLoading}
                        onClick={() => openNestedSettings(onOpenCalculationSettings)}
                      />
                      <SettingsMenuItem
                        icon={AlertTriangle}
                        title="Alertas financeiros"
                        description="Configure tolerâncias e divergências por marketplace."
                        badge={`${formatNumber(divergenceRulesCount)} regras`}
                        disabled={isLoading}
                        onClick={() => openNestedSettings(onOpenDivergenceSettings)}
                      />
                      <SettingsMenuItem
                        icon={BarChart3}
                        title="Resumo da página"
                        description="Escolha quais cards aparecem no topo e em qual ordem."
                        badge={`${formatNumber(summaryCardsCount)} cards`}
                        disabled={isLoading}
                        onClick={() => openNestedSettings(onOpenSummarySettings)}
                      />
                      <SettingsMenuItem
                        icon={Upload}
                        title="Importar repasses"
                        description="Adicione arquivos de repasse do marketplace à conciliação."
                        badge={`${formatNumber(payoutRowsCount)} linhas`}
                        disabled={isLoading}
                        onClick={() => openNestedSettings(onOpenPayoutImport)}
                      />
                    </div>
                  </aside>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  A prévia considera os pedidos carregados na tela e respeita os filtros aplicados.
                </p>
                <Button
                  type="button"
                  onClick={onApplySuggestedConciliations}
                  disabled={
                    isLoading ||
                    isSaving ||
                    autoReconciliationPendingOrders.length === 0 ||
                    autoReconciliationPendingOrders.length > 450
                  }
                >
                  <CheckCheck className="mr-2 h-4 w-4" />
                  Conciliar sugeridos
                </Button>
              </div>
            </div>
          ) : null}

          {activeTab === "system-status" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <div className="grid gap-3 rounded-md border bg-white p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <div className="space-y-1.5">
                  <Label>Status do sistema</Label>
                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                      {formatNumber(systemStatusActiveCount)} ativos
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200">
                      {formatNumber(systemStatusInactiveCount)} inativos
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
                      {formatNumber(draftSystemStatusSettings.statuses.length)} configurados
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetSystemStatusSettings}
                  disabled={isLoading || isSaving || !systemStatusDefaultChanged}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Restaurar padrão
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-gradient-to-b from-zinc-50/60 to-white">
                <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2">
                  {draftSystemStatusSettings.statuses.map((statusDefinition) => {
                    const selectedColor = statusDefinition.color;

                    return (
                      <div
                        key={statusDefinition.id}
                        className={cn(
                          "group relative rounded-xl border bg-white p-4 transition-all",
                          statusDefinition.active ? "shadow-sm" : "opacity-60"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset"
                            style={{
                              backgroundColor: `${selectedColor}14`,
                              borderColor: `${selectedColor}33`,
                            }}
                          >
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: selectedColor }} />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Input
                                value={statusDefinition.displayName}
                                aria-label={`Nome exibido para ${statusDefinition.label}`}
                                disabled={isSaving}
                                onChange={(event) =>
                                  updateSystemStatusDefinition(statusDefinition.id, {
                                    displayName: event.target.value,
                                  })
                                }
                                className="h-7 border-transparent bg-transparent px-0 text-sm font-semibold text-slate-950 shadow-none focus-visible:border-blue-300 focus-visible:bg-blue-50/30 focus-visible:px-2 focus-visible:ring-0"
                              />
                              <Lock className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground">Status padrão do sistema</p>
                          </div>

                          <Switch
                            checked={statusDefinition.active}
                            disabled={isSaving}
                            onCheckedChange={(checked) =>
                              updateSystemStatusDefinition(statusDefinition.id, { active: checked })
                            }
                            aria-label={`Ativar ou desativar ${statusDefinition.label}`}
                          />
                        </div>

                        <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-3">
                          <span className="text-[11px] font-medium text-muted-foreground">Cor</span>
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {conciliationSystemStatusColorSwatches.map((color) => {
                              const selected = selectedColor === color;

                              return (
                                <button
                                  key={`${statusDefinition.id}-${color}`}
                                  type="button"
                                  aria-label={`Aplicar cor ${color} em ${statusDefinition.label}`}
                                  aria-pressed={selected}
                                  disabled={isSaving}
                                  onClick={() => updateSystemStatusDefinition(statusDefinition.id, { color })}
                                  className={cn(
                                    "h-5 w-5 rounded-full ring-2 ring-offset-1 transition-all",
                                    selected ? "ring-zinc-900" : "ring-transparent hover:ring-zinc-300",
                                    isSaving && "cursor-not-allowed opacity-50"
                                  )}
                                  style={{ backgroundColor: color }}
                                />
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end border-t pt-4">
                <Button
                  type="button"
                  onClick={handleSaveSystemStatusSettings}
                  disabled={isLoading || isSaving || !systemStatusSettingsChanged}
                >
                  <Save className="mr-2 h-4 w-4" />
                  Salvar Status Sistema
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const parseStoredDate = (value: unknown): Date | null => {
  if (typeof value !== "string") return null;

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const readStoredOption = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback;

const readStoredAppliedQuery = (): StoredAppliedQuery | null => {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(appliedQueryStorageKey);
    const parsed = stored ? JSON.parse(stored) : null;

    if (!parsed || typeof parsed !== "object" || !parsed.filters || typeof parsed.filters !== "object") {
      return null;
    }

    const rawFilters = parsed.filters as Record<string, unknown>;
    const rawDate = (rawFilters.date ?? null) as { from?: unknown; to?: unknown } | null;
    const from = parseStoredDate(rawDate?.from);
    const to = parseStoredDate(rawDate?.to);
    const systemStatusValue = rawFilters.systemStatus;
    const systemStatus: SystemStatusFilter =
      typeof systemStatusValue === "string" &&
      (conciliationSystemStatusOptions as readonly string[]).includes(systemStatusValue)
        ? (systemStatusValue as SystemStatusFilter)
        : "Todos";

    const filters: AppliedFilters = {
      date: from && to ? { from, to } : undefined,
      marketplace: typeof rawFilters.marketplace === "string" ? rawFilters.marketplace : "Todos",
      account: typeof rawFilters.account === "string" ? rawFilters.account : "Todos",
      orderStatus: typeof rawFilters.orderStatus === "string" ? rawFilters.orderStatus : "Todos",
      systemStatus,
      financialAlert: readStoredOption(rawFilters.financialAlert, financialAlertOptions, "Todos"),
      adjustmentStatus: readStoredOption(rawFilters.adjustmentStatus, adjustmentStatusOptions, "Todos"),
      payoutStatus: readStoredOption(rawFilters.payoutStatus, payoutStatusOptions, "Todos"),
      suggestion: readStoredOption(rawFilters.suggestion, suggestionOptions, "Todos"),
      reconciliationStatus: readStoredOption(rawFilters.reconciliationStatus, reconciliationStatusOptions, "Todos"),
      searchTerm: typeof rawFilters.searchTerm === "string" ? rawFilters.searchTerm : "",
    };

    return {
      filters,
      appliedAt: parseStoredDate(parsed.appliedAt),
    };
  } catch {
    return null;
  }
};

export default function ConciliacaoClient() {
  const { toast } = useToast();
  const router = useRouter();
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
  const [systemStatusSettings, setSystemStatusSettings] = React.useState<ConciliationSystemStatusSettings>(
    defaultConciliationSystemStatusSettings
  );
  const [accountSettings, setAccountSettings] = React.useState<ConciliationAccountSettings>({
    accountMappings: {},
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
  const [isSettingsHubOpen, setIsSettingsHubOpen] = React.useState(false);
  const queryPreparationTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const sortFeedbackTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const columnMoveFeedbackTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const storedAppliedQueryRef = React.useRef<StoredAppliedQuery | null | undefined>(undefined);

  if (storedAppliedQueryRef.current === undefined) {
    storedAppliedQueryRef.current = readStoredAppliedQuery();
  }

  const storedAppliedQuery = storedAppliedQueryRef.current;
  const [date, setDate] = React.useState<DateRange | undefined>(() => {
    if (storedAppliedQuery?.filters.date) return storedAppliedQuery.filters.date;

    const today = new Date();

    return {
      from: startOfMonth(today),
      to: today,
    };
  });
  const [marketplace, setMarketplace] = React.useState(storedAppliedQuery?.filters.marketplace ?? "Todos");
  const [account, setAccount] = React.useState(storedAppliedQuery?.filters.account ?? "Todos");
  const [orderStatus, setOrderStatus] = React.useState(storedAppliedQuery?.filters.orderStatus ?? "Todos");
  const [systemStatus, setSystemStatus] = React.useState<SystemStatusFilter>(
    storedAppliedQuery?.filters.systemStatus ?? "Todos"
  );
  const [financialAlert, setFinancialAlert] = React.useState<FinancialAlertFilter>(
    storedAppliedQuery?.filters.financialAlert ?? "Todos"
  );
  const [adjustmentStatus, setAdjustmentStatus] = React.useState<AdjustmentStatusFilter>(
    storedAppliedQuery?.filters.adjustmentStatus ?? "Todos"
  );
  const [payoutStatus, setPayoutStatus] = React.useState<PayoutStatusFilter>(
    storedAppliedQuery?.filters.payoutStatus ?? "Todos"
  );
  const [suggestion, setSuggestion] = React.useState<SuggestionFilter>(
    storedAppliedQuery?.filters.suggestion ?? "Todos"
  );
  const [reconciliationStatus, setReconciliationStatus] = React.useState<ReconciliationStatusFilter>(
    storedAppliedQuery?.filters.reconciliationStatus ?? "Todos"
  );
  const [searchTerm, setSearchTerm] = React.useState(storedAppliedQuery?.filters.searchTerm ?? "");
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = React.useState(false);
  const [hasAppliedFilters, setHasAppliedFilters] = React.useState(Boolean(storedAppliedQuery));
  const [lastAppliedAt, setLastAppliedAt] = React.useState<Date | null>(storedAppliedQuery?.appliedAt ?? null);
  const [appliedFilters, setAppliedFilters] = React.useState<AppliedFilters>(() => {
    if (storedAppliedQuery) return storedAppliedQuery.filters;

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
  const tableDensity = "comfortable" as TableDensity;
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
  const [sheetAssociations, setSheetAssociations] = React.useState<ConciliationSheetAssociation[]>([]);
  const sheetColumnOptions = React.useMemo(() => {
    const keys = new Set<string>();

    sheetAssociations.forEach((association) => {
      if (association.targetField === "sku") return;

      Object.keys(association.dataFields || {}).forEach((key) => keys.add(key));
    });

    return buildSheetColumnOptions(Array.from(keys).sort());
  }, [sheetAssociations]);
  const availableColumnOptions = React.useMemo<ConciliationColumnOption[]>(
    () => [...conciliationColumnOptions, ...calculationColumnOptions, ...sheetColumnOptions],
    [calculationColumnOptions, sheetColumnOptions]
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
  const normalizedSystemStatusSettings = React.useMemo(
    () => normalizeConciliationSystemStatusSettings(systemStatusSettings),
    [systemStatusSettings]
  );

  const isLoading = isOrdersLoading || isRecordsLoading;
  const isQueryLoading = hasAppliedFilters && (isLoading || isQueryApplying);
  const allOrders = React.useMemo(() => {
    const accountMappedOrders = applyAccountMappings(baseOrders, accountSettings.accountMappings);
    const statusMappedOrders = applyStatusMappings(accountMappedOrders, statusSettings.statusMappings);
    const recordMappedOrders = applyConciliationRecords(statusMappedOrders, conciliationRecords);
    const divergenceMappedOrders = applyFinancialDivergenceRules(recordMappedOrders, divergenceSettings);
    const payoutMappedOrders = applyMarketplacePayouts(divergenceMappedOrders, payoutRecords);
    const sheetMappedOrders = applySheetAssociationsToOrders(payoutMappedOrders, sheetAssociations);

    return applyCustomCalculationsToOrders(sheetMappedOrders, calculationSettings.calculations);
  }, [
    accountSettings.accountMappings,
    baseOrders,
    calculationSettings.calculations,
    conciliationRecords,
    divergenceSettings,
    payoutRecords,
    sheetAssociations,
    statusSettings.statusMappings,
  ]);

  // Carrega associações de planilhas para os meses da consulta aplicada.
  React.useEffect(() => {
    if (!hasAppliedFilters) return;

    const from = appliedFilters.date?.from;
    const to = appliedFilters.date?.to;

    if (!from || !to) return;

    const months: string[] = [];
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);

    while (cursor <= to && months.length < 24) {
      months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }

    let isMounted = true;

    fetchSheetAssociations(months)
      .then((associations) => {
        if (isMounted) setSheetAssociations(associations);
      })
      .catch((error) => {
        console.error("Erro ao carregar associações de planilhas:", error);
      });

    return () => {
      isMounted = false;
    };
  }, [appliedFilters.date, hasAppliedFilters]);


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
        setAccountSettings(state.accountSettings);
        setStatusSettings(state.statusSettings);
        setSystemStatusSettings(state.systemStatusSettings);
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

      const missingSheetColumnIds = sheetColumnOptions
        .map((column) => column.id)
        .filter((columnId) => !next.includes(columnId));

      if (missingSheetColumnIds.length > 0) {
        next.push(...missingSheetColumnIds);
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

    if (!hasAppliedFilters) {
      window.localStorage.removeItem(appliedQueryStorageKey);
      return;
    }

    const dateFrom = appliedFilters.date?.from;
    const dateTo = appliedFilters.date?.to;

    window.localStorage.setItem(
      appliedQueryStorageKey,
      JSON.stringify({
        filters: {
          ...appliedFilters,
          date:
            dateFrom && dateTo
              ? { from: dateFrom.toISOString(), to: dateTo.toISOString() }
              : undefined,
        },
        appliedAt: lastAppliedAt ? lastAppliedAt.toISOString() : null,
      })
    );
  }, [appliedFilters, hasAppliedFilters, lastAppliedAt]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(viewModeStorageKey, viewMode);
  }, [viewMode]);

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

  const activeAdvancedFilterCount = [
    orderStatus,
    systemStatus,
    financialAlert,
    adjustmentStatus,
    payoutStatus,
    suggestion,
    reconciliationStatus,
  ].filter((value) => value !== "Todos").length;
  const activePedidoFilterCount = [orderStatus, systemStatus, reconciliationStatus].filter((value) => value !== "Todos").length;
  const activeFinanceiroFilterCount = [financialAlert, adjustmentStatus, payoutStatus].filter((value) => value !== "Todos").length;
  const activeOperacaoFilterCount = suggestion !== "Todos" ? 1 : 0;
  const activeCompactFilterCount =
    activeAdvancedFilterCount + (account !== "Todos" ? 1 : 0) + (searchTerm.trim() ? 1 : 0);

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
  const orderStatusCounts = React.useMemo(() => {
    const counts = new Map<string, number>();

    filteredOrders.forEach((order) => {
      counts.set(order.statusName, (counts.get(order.statusName) || 0) + 1);
    });

    return counts;
  }, [filteredOrders]);
  const systemStatusCounts = React.useMemo(() => {
    const counts = new Map<string, number>();

    filteredOrders.forEach((order) => {
      counts.set(order.systemStatus, (counts.get(order.systemStatus) || 0) + 1);
    });

    return counts;
  }, [filteredOrders]);
  const financialAlertCounts = React.useMemo(() => {
    const counts: Record<FinancialAlertFilter, number> = {
      Todos: filteredOrders.length,
      "Com alerta": 0,
      Críticos: 0,
      Atenção: 0,
      "Sem alerta": 0,
    };

    filteredOrders.forEach((order) => {
      if (order.financialDivergence.severity === "critical") {
        counts["Com alerta"] += 1;
        counts["Críticos"] += 1;
      } else if (order.financialDivergence.severity === "attention") {
        counts["Com alerta"] += 1;
        counts.Atenção += 1;
      } else {
        counts["Sem alerta"] += 1;
      }
    });

    return counts;
  }, [filteredOrders]);
  const adjustmentStatusCounts = React.useMemo(() => {
    const counts: Record<AdjustmentStatusFilter, number> = {
      Todos: filteredOrders.length,
      "Com ajustes": 0,
      "Sem ajustes": 0,
    };

    filteredOrders.forEach((order) => {
      if (getActiveFinancialAdjustments(order).length > 0) {
        counts["Com ajustes"] += 1;
      } else {
        counts["Sem ajustes"] += 1;
      }
    });

    return counts;
  }, [filteredOrders]);
  const payoutStatusCounts = React.useMemo(() => {
    const counts: Record<PayoutStatusFilter, number> = {
      Todos: filteredOrders.length,
      "Sem repasse": 0,
      "Repasse OK": 0,
      Divergente: 0,
    };

    filteredOrders.forEach((order) => {
      if (order.payoutComparison.status === "missing") counts["Sem repasse"] += 1;
      if (order.payoutComparison.status === "matched") counts["Repasse OK"] += 1;
      if (order.payoutComparison.status === "divergent") counts.Divergente += 1;
    });

    return counts;
  }, [filteredOrders]);
  const suggestionCounts = React.useMemo(() => {
    const counts: Record<SuggestionFilter, number> = {
      Todos: filteredOrders.length,
      Sugeridos: 0,
      Revisar: 0,
    };

    filteredOrders.forEach((order) => {
      if (isConciliationSuggestionCandidate(order)) {
        counts.Sugeridos += 1;
      } else {
        counts.Revisar += 1;
      }
    });

    return counts;
  }, [filteredOrders]);
  const reconciliationStatusCounts = React.useMemo(() => {
    const counts: Record<ReconciliationStatusFilter, number> = {
      Todos: filteredOrders.length,
      Pendentes: 0,
      Conciliados: 0,
    };

    filteredOrders.forEach((order) => {
      if (order.isReconciled) {
        counts.Conciliados += 1;
      } else {
        counts.Pendentes += 1;
      }
    });

    return counts;
  }, [filteredOrders]);

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
  const tableColSpan = visibleDataColumnCount + 1;
  const tableStyle = React.useMemo<React.CSSProperties>(
    () => ({ minWidth: Math.max(1640, 220 + visibleDataColumnCount * 150) }),
    [visibleDataColumnCount]
  );
  const tableHeaderClassName = cn(
    "sticky top-0 z-20 bg-zinc-50/95 shadow-[0_1px_0_0_rgba(0,0,0,0.06)] backdrop-blur supports-[backdrop-filter]:bg-zinc-50/80 [&_th]:h-12 [&_th]:whitespace-nowrap [&_th]:font-medium [&_th]:text-slate-500 [&_tr]:border-slate-200"
  );
  const tableBodyClassName = cn(
    "[&_td]:py-4 [&_td]:text-sm [&_td]:text-slate-950 [&_tr]:border-slate-200"
  );
  const mainTableRowClassName = cn(
    "group h-[66px] cursor-pointer hover:bg-zinc-50/80"
  );
  const itemTableRowClassName = cn(
    "h-[52px] bg-zinc-50/70 hover:bg-zinc-50"
  );
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

  const handleCompactSearchChange = (value: string) => {
    setSearchTerm(value);

    if (!hasAppliedFilters) return;

    setAppliedFilters((previous) => ({ ...previous, searchTerm: value }));
    setCurrentPage(1);
    setSelectedOrderIds(new Set());
  };

  const clearAdvancedFilters = () => {
    setOrderStatus("Todos");
    setSystemStatus("Todos");
    setFinancialAlert("Todos");
    setAdjustmentStatus("Todos");
    setPayoutStatus("Todos");
    setSuggestion("Todos");
    setReconciliationStatus("Todos");

    if (!hasAppliedFilters) return;

    setAppliedFilters((previous) => ({
      ...previous,
      orderStatus: "Todos",
      systemStatus: "Todos",
      financialAlert: "Todos",
      adjustmentStatus: "Todos",
      payoutStatus: "Todos",
      suggestion: "Todos",
      reconciliationStatus: "Todos",
    }));
    setCurrentPage(1);
    setSelectedOrderIds(new Set());
  };

  const clearCompactFilters = () => {
    setSearchTerm("");
    setAccount("Todos");
    clearAdvancedFilters();

    if (!hasAppliedFilters) return;

    setAppliedFilters((previous) => ({
      ...previous,
      account: "Todos",
      searchTerm: "",
    }));
    setCurrentPage(1);
    setSelectedOrderIds(new Set());
  };

  const handleRefreshConciliationState = async () => {
    setIsRecordsLoading(true);

    try {
      const state = await fetchConciliationState();

      setConciliationRecords(state.records);
      setPayoutRecords(state.payouts);
      setAccountSettings(state.accountSettings);
      setStatusSettings(state.statusSettings);
      setSystemStatusSettings(state.systemStatusSettings);
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
        if (isColumnVisible("customer")) row["Cliente"] = order.customerName;
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
          row["Status Sistema"] = getConciliationSystemStatusDisplayName(
            normalizedSystemStatusSettings,
            order.systemStatus
          );
          row["Status Sistema Automático"] = getConciliationSystemStatusDisplayName(
            normalizedSystemStatusSettings,
            order.automaticSystemStatus
          );
          row["Status Sistema Manual"] = order.manualSystemStatus
            ? getConciliationSystemStatusDisplayName(normalizedSystemStatusSettings, order.manualSystemStatus)
            : "";
        }
        if (isColumnVisible("grossRevenue")) row["Faturamento Bruto"] = order.grossRevenue;
        if (isColumnVisible("netRevenue")) row["Líquido"] = order.netRevenue;
        if (isColumnVisible("taxes")) row["Imposto"] = order.taxes;
        if (isColumnVisible("productCost")) row["Custo Produto"] = order.productCost;
        if (isColumnVisible("margin")) row["Margem de Contribuição"] = order.contributionMargin;
        if (isColumnVisible("marginPercentage")) row["Margem %"] = order.contributionMarginPercentage;

        orderedVisibleColumnIds.forEach((columnId) => {
          const sheetKey = getSheetKeyFromColumnId(columnId);

          if (sheetKey === null) return;

          const label = availableColumnOptionById.get(columnId)?.label ?? `Planilha ${sheetKey}`;
          const value = order.sheetFields?.[sheetKey];

          row[label] = value === null || value === undefined ? "" : (value as string | number);
        });

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
        description: `Pedido #${order.number || order.orderId} atualizado para ${getConciliationSystemStatusDisplayName(
          normalizedSystemStatusSettings,
          updatedRecord.systemStatus
        )}.`,
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

  const handleSaveAccountMappings = async (accountMappings: ConciliationAccountMappings) => {
    setIsSaving(true);
    try {
      const updatedSettings = await saveConciliationAccountMappings(accountMappings);

      setAccountSettings(updatedSettings);

      toast({
        title: "Mapeamento de contas salvo",
        description: `${formatNumber(Object.keys(updatedSettings.accountMappings).length)} conta(s) com nome configurado.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar contas",
        description: error instanceof Error ? error.message : "Não foi possível salvar o mapeamento de contas.",
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

  const handleSaveSystemStatusSettings = async (settings: ConciliationSystemStatusSettings) => {
    setIsSaving(true);
    try {
      const updatedSettings = await saveConciliationSystemStatusSettings(settings);

      setSystemStatusSettings(updatedSettings);

      toast({
        title: "Status do sistema salvos",
        description: `${formatNumber(updatedSettings.statuses.length)} status configurado(s) no painel.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar status",
        description: error instanceof Error ? error.message : "Não foi possível salvar os status do sistema.",
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

    const sheetFieldKey = getSheetKeyFromColumnId(columnId);

    if (sheetFieldKey !== null) {
      const sheetValue = order.sheetFields?.[sheetFieldKey];

      return (
        <TableCell key={columnId} className="whitespace-nowrap text-right tabular-nums">
          {sheetValue === null || sheetValue === undefined ? (
            <span className="text-zinc-400">-</span>
          ) : typeof sheetValue === "number" ? (
            sheetValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          ) : (
            <span className="block max-w-44 truncate" title={String(sheetValue)}>
              {String(sheetValue)}
            </span>
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
      case "customer":
        return (
          <TableCell key={columnId} className="max-w-56">
            <span className="block truncate" title={order.customerName}>
              {order.customerName}
            </span>
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
              systemStatusSettings={normalizedSystemStatusSettings}
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

    if (isCalculationColumnId(columnId) || getSheetKeyFromColumnId(columnId) !== null) {
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
      case "customer":
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
  const periodSummaryMetrics = React.useMemo(() => {
    const metrics = summarySettings.metricIds.flatMap((metricId) => {
      const definition = summaryMetricDefinitionById.get(metricId);

      if (!definition) return [];

      return [
        {
          title: definition.title,
          value: definition.value(summary),
          tone: summaryToneByMetricId[metricId] ?? ("blue" as SummaryMetricTone),
        },
      ];
    });

    metrics.push({
      title: "Taxa de Afiliados",
      value: formatCurrency(postQueryCommissionAmount),
      tone: "cyan",
    });

    return metrics;
  }, [postQueryCommissionAmount, summary, summarySettings.metricIds]);

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-5 bg-slate-50 p-4 pt-6 text-slate-950 md:p-8" style={{ fontFamily: "Manrope, sans-serif" }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Conciliação de Vendas</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Analise suas vendas, adicione custos e encontre o lucro líquido de cada operação.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className={referenceOutlineButtonClassName}
            onClick={() => router.push("/financeiro/planilhas")}
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Planilhas
          </Button>
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
                onClick={() => setIsCalculationSettingsOpen(true)}
                disabled={!hasAppliedFilters || isLoading || isQueryApplying || isSaving}
              >
                <Calculator className="mr-2 h-4 w-4" />
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
              <Button
                type="button"
                variant="outline"
                className={cn(referenceOutlineButtonClassName, "h-10 w-10 px-0")}
                onClick={() => setIsSettingsHubOpen(true)}
                disabled={isLoading || isQueryApplying}
                aria-label="Configurações da conciliação"
                title="Configurações da conciliação"
              >
                <Settings2 className="h-4 w-4" />
              </Button>
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

            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
              <div className="relative min-w-[260px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <Input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => handleCompactSearchChange(event.target.value)}
                  className="h-10 rounded-lg border-zinc-200 bg-zinc-50/60 pl-10 pr-20"
                  placeholder="Buscar pedido, cliente, SKU..."
                  aria-label="Buscar pedido, cliente ou SKU"
                  disabled={isQueryLoading}
                />
                <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                  {isQueryLoading ? <Loader2 className="h-4 w-4 animate-spin text-zinc-400" /> : null}
                  {searchTerm.trim() ? (
                    <button
                      type="button"
                      onClick={() => handleCompactSearchChange("")}
                      className="rounded p-1 transition-colors hover:bg-zinc-100"
                      aria-label="Limpar busca"
                      title="Limpar busca"
                    >
                      <X className="h-4 w-4 text-zinc-500" />
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="hidden items-center whitespace-nowrap rounded-lg bg-zinc-50 px-3 py-2 text-sm text-slate-500 xl:flex">
                {isQueryLoading ? (
                  <Skeleton className="h-5 w-36" />
                ) : (
                  <>
                    {formatNumber(filteredOrders.length)} pedido(s) - {formatClock(lastAppliedAt)}
                  </>
                )}
              </div>

              <div className="w-full sm:w-52">
                <Select value={account} onValueChange={handlePostQueryAccountChange}>
                  <SelectTrigger className={cn(referenceControlClassName, "h-10 w-full rounded-lg")}>
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
              </div>

              <div className="mx-1 hidden h-8 w-px bg-zinc-200 md:block" />

              <div className="flex flex-wrap items-center gap-2">
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
                <Popover open={isAdvancedFiltersOpen} onOpenChange={setIsAdvancedFiltersOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "h-10 gap-2 rounded-lg px-3 text-sm font-medium",
                        activeAdvancedFilterCount > 0 &&
                          "border-primary/30 bg-primary/10 text-primary hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                      )}
                      disabled={isQueryLoading}
                    >
                      <Filter className="h-4 w-4" />
                      Filtros Adicionais
                      {activeAdvancedFilterCount > 0 ? (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                          {activeAdvancedFilterCount}
                        </span>
                      ) : null}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    sideOffset={8}
                    collisionPadding={12}
                    className="flex w-[680px] max-w-[95vw] flex-col overflow-hidden p-0"
                    style={{ maxHeight: "min(560px, calc(var(--radix-popover-content-available-height) - 8px))" }}
                  >
                    <div className="flex-shrink-0 border-b border-zinc-200 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h4 className="flex items-center gap-2 text-lg font-bold text-zinc-950">
                            <SlidersHorizontal className="h-5 w-5 text-primary" />
                            Filtros Adicionais
                          </h4>
                          <p className="mt-1 text-sm text-zinc-500">
                            Refine sua busca utilizando critérios específicos.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsAdvancedFiltersOpen(false)}
                          className="rounded-full p-2 transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                          aria-label="Fechar filtros"
                        >
                          <X className="h-4 w-4 text-zinc-500" />
                        </button>
                      </div>
                    </div>

                    <Tabs defaultValue="pedido" className="flex min-h-0 flex-1 flex-col">
                      <TabsList className="mx-4 mt-3 h-auto justify-start gap-1 rounded-none border-b border-zinc-200 bg-transparent p-0">
                        <TabsTrigger
                          value="pedido"
                          className="gap-1.5 rounded-md data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
                        >
                          Pedido
                          {activePedidoFilterCount > 0 ? (
                            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                              {activePedidoFilterCount}
                            </Badge>
                          ) : null}
                        </TabsTrigger>
                        <TabsTrigger
                          value="financeiro"
                          className="gap-1.5 rounded-md data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
                        >
                          Financeiro
                          {activeFinanceiroFilterCount > 0 ? (
                            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                              {activeFinanceiroFilterCount}
                            </Badge>
                          ) : null}
                        </TabsTrigger>
                        <TabsTrigger
                          value="operacao"
                          className="gap-1.5 rounded-md data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
                        >
                          Operação
                          {activeOperacaoFilterCount > 0 ? (
                            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                              {activeOperacaoFilterCount}
                            </Badge>
                          ) : null}
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="pedido" className="mt-0 flex-1 overflow-y-auto p-4">
                        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                          <CompactFilterGroup title="Status do Pedido" active={orderStatus !== "Todos" ? 1 : 0}>
                            {orderStatusOptions.map((option) => (
                              <CompactFilterOption
                                key={option}
                                checked={orderStatus === option}
                                count={option === "Todos" ? filteredOrders.length : orderStatusCounts.get(option)}
                                label={option === "Todos" ? "Todos os status" : option}
                                onClick={() => setOrderStatus(option)}
                              />
                            ))}
                          </CompactFilterGroup>

                          <CompactFilterGroup title="Status Sistema" active={systemStatus !== "Todos" ? 1 : 0}>
                            <CompactFilterOption
                              checked={systemStatus === "Todos"}
                              count={filteredOrders.length}
                              label="Todos os sistemas"
                              onClick={() => setSystemStatus("Todos")}
                            />
                            {normalizedSystemStatusSettings.statuses.map((definition) => (
                              <CompactFilterOption
                                key={definition.id}
                                checked={systemStatus === definition.id}
                                color={definition.active ? definition.color : "#a1a1aa"}
                                count={systemStatusCounts.get(definition.id)}
                                label={`${definition.displayName}${definition.active ? "" : " (inativo)"}`}
                                muted={!definition.active}
                                onClick={() => setSystemStatus(definition.id)}
                              />
                            ))}
                          </CompactFilterGroup>

                          <CompactFilterGroup title="Conciliação" active={reconciliationStatus !== "Todos" ? 1 : 0}>
                            {reconciliationStatusOptions.map((option) => (
                              <CompactFilterOption
                                key={option}
                                checked={reconciliationStatus === option}
                                count={reconciliationStatusCounts[option]}
                                label={option === "Todos" ? "Todos" : option}
                                onClick={() => setReconciliationStatus(option)}
                              />
                            ))}
                          </CompactFilterGroup>
                        </div>
                      </TabsContent>

                      <TabsContent value="financeiro" className="mt-0 flex-1 overflow-y-auto p-4">
                        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                          <CompactFilterGroup title="Alerta Financeiro" active={financialAlert !== "Todos" ? 1 : 0}>
                            {financialAlertOptions.map((option) => (
                              <CompactFilterOption
                                key={option}
                                checked={financialAlert === option}
                                count={financialAlertCounts[option]}
                                label={option === "Todos" ? "Todos os alertas" : option}
                                onClick={() => setFinancialAlert(option)}
                              />
                            ))}
                          </CompactFilterGroup>

                          <CompactFilterGroup title="Ajustes Financeiros" active={adjustmentStatus !== "Todos" ? 1 : 0}>
                            {adjustmentStatusOptions.map((option) => (
                              <CompactFilterOption
                                key={option}
                                checked={adjustmentStatus === option}
                                count={adjustmentStatusCounts[option]}
                                label={option === "Todos" ? "Todos os ajustes" : option}
                                onClick={() => setAdjustmentStatus(option)}
                              />
                            ))}
                          </CompactFilterGroup>

                          <CompactFilterGroup title="Repasse" active={payoutStatus !== "Todos" ? 1 : 0}>
                            {payoutStatusOptions.map((option) => (
                              <CompactFilterOption
                                key={option}
                                checked={payoutStatus === option}
                                count={payoutStatusCounts[option]}
                                label={option === "Todos" ? "Todos os repasses" : option}
                                onClick={() => setPayoutStatus(option)}
                              />
                            ))}
                          </CompactFilterGroup>
                        </div>
                      </TabsContent>

                      <TabsContent value="operacao" className="mt-0 flex-1 overflow-y-auto p-4">
                        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                          <CompactFilterGroup title="Sugestão Operacional" active={suggestion !== "Todos" ? 1 : 0}>
                            {suggestionOptions.map((option) => (
                              <CompactFilterOption
                                key={option}
                                checked={suggestion === option}
                                count={suggestionCounts[option]}
                                label={option === "Todos" ? "Todas as sugestões" : option}
                                onClick={() => setSuggestion(option)}
                              />
                            ))}
                          </CompactFilterGroup>
                        </div>
                      </TabsContent>
                    </Tabs>

                    <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-zinc-200 bg-white px-4 py-3">
                      <p className="text-xs text-zinc-500">
                        {activeAdvancedFilterCount > 0
                          ? `${activeAdvancedFilterCount} filtro(s) avançado(s) selecionado(s)`
                          : "Nenhum filtro avançado selecionado"}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => {
                            clearAdvancedFilters();
                            setIsAdvancedFiltersOpen(false);
                          }}
                          disabled={isQueryLoading || activeAdvancedFilterCount === 0}
                        >
                          <Trash2 className="h-4 w-4" />
                          Limpar filtros adicionais
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            handleApplyFilters();
                            setIsAdvancedFiltersOpen(false);
                          }}
                          disabled={isQueryApplying}
                        >
                          {isQueryApplying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          {isQueryApplying ? "Preparando..." : "Aplicar filtros"}
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                {activeCompactFilterCount > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-10 gap-2 rounded-lg px-3 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
                    onClick={clearCompactFilters}
                    disabled={isQueryLoading}
                  >
                    <Trash2 className="h-4 w-4" />
                    Limpar
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-100 px-1 text-[10px] font-bold text-zinc-500">
                      {activeCompactFilterCount}
                    </span>
                  </Button>
                ) : null}
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
                  <div className="flex flex-col gap-3">
                    {paginatedOrders.map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        selected={selectedOrderIds.has(order.id)}
                        isSaving={isSaving}
                        systemStatusSettings={normalizedSystemStatusSettings}
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

      <ConciliationSettingsHubDialog
        open={isSettingsHubOpen}
        onOpenChange={setIsSettingsHubOpen}
        orders={filteredOrders}
        isLoading={isLoading}
        isSaving={isSaving}
        accountSettings={accountSettings}
        statusSettings={statusSettings}
        systemStatusSettings={systemStatusSettings}
        summaryCardsCount={summarySettings.metricIds.length}
        calculationColumnsCount={calculationSettings.calculations.length}
        divergenceRulesCount={Object.keys(divergenceSettings.marketplaceRules || {}).length}
        statusMappingsCount={Object.keys(statusSettings.statusMappings || {}).length}
        payoutRowsCount={payoutRecords.length}
        onSaveAccountMappings={handleSaveAccountMappings}
        onSaveStatusMappings={handleSaveStatusMappings}
        onSaveSystemStatusSettings={handleSaveSystemStatusSettings}
        onApplySuggestedConciliations={handleSaveSuggestedConciliations}
        onOpenSummarySettings={() => setIsSummarySettingsOpen(true)}
        onOpenCalculationSettings={() => setIsCalculationSettingsOpen(true)}
        onOpenDivergenceSettings={() => setIsDivergenceSettingsOpen(true)}
        onOpenStatusSettings={() => setIsStatusSettingsOpen(true)}
        onOpenPayoutImport={() => setIsPayoutImportOpen(true)}
      />
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
        orders={filteredOrders}
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
        systemStatusSettings={normalizedSystemStatusSettings}
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
        systemStatusSettings={normalizedSystemStatusSettings}
        onSaveSystemStatus={handleSaveSystemStatus}
        onSaveFinancialAdjustments={handleSaveFinancialAdjustments}
      />
    </DashboardLayout>
  );
}
