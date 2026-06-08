"use client";

import * as React from "react";
import {
  AlertTriangle,
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
  FileDown,
  FileSearch,
  FileText,
  Files,
  GitBranch,
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
  Zap,
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
  buildConciliationCalculationContext,
  buildConciliationCalculationEvaluationContext,
  conciliationCalculationConditionOperatorOptions,
  conciliationCalculationInlineConditionOperatorOptions,
  conciliationCalculationFieldOptions,
  evaluateConciliationCalculationExpression,
  isConciliationCalculationApplicableToOrder,
  resolveConciliationCalculationExpression,
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
  ConciliationCalculationConditionOperator,
  ConciliationCalculationConditionalFormula,
  ConciliationCalculationInlineConditional,
  ConciliationCalculationInlineConditionOperator,
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


import {
  DetailItem,
  DivergenceRuleField,
  EmptyDetailState,
  SummaryMetricDefinition,
  SystemStatusBadge,
  SystemStatusSelectValue,
  automaticStatusSelectValue,
  buildSheetColumnOptions,
  compareString,
  defaultDivergenceRuleScopeValue,
  emptySummary,
  formatActor,
  formatCalculationValue,
  formatCurrency,
  formatDateTime,
  formatNumber,
  serializeDivergenceRules,
  serializeStatusMappings,
  serializeSummaryMetricIds,
  summaryMetricDefinitionById,
} from "./shared";

export const SummarySettingsDialog = ({
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
      <DialogContent className="flex max-h-[90vh] w-[96vw] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-slate-200 px-5 py-4 text-left">
          <DialogTitle className="text-lg leading-tight sm:text-xl">Configurar Resumo</DialogTitle>
          <DialogDescription className="leading-relaxed">
            Escolha quais métricas aparecem no topo da conciliação e defina a ordem dos cards.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 bg-slate-50/70 p-3">
                <p className="text-sm font-medium text-slate-950">Métricas disponíveis</p>
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
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-slate-50"
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

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 bg-slate-50/70 p-3">
                <p className="text-sm font-medium text-slate-950">Ordem dos cards</p>
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

          <div className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-2">
            <DetailItem label="Atualizado em" value={formatDateTime(summarySettings.updatedAt)} />
            <DetailItem label="Atualizado por" value={formatActor(summarySettings.updatedBy)} />
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:justify-between">
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

export const emptyCalculationDraft: ConciliationCustomCalculationInput = {
  name: "",
  description: "",
  expression: "",
  conditionalFormulas: [],
  inlineConditionals: [],
  interaction: null,
  marketplace: "Todos",
  statusNames: [],
  isPercentage: false,
  enabled: true,
};

type ConditionalFormulaDraft = Omit<ConciliationCalculationConditionalFormula, "id"> & {
  id?: string;
};

type InlineConditionalDraft = Omit<ConciliationCalculationInlineConditional, "id"> & {
  id?: string;
};

const emptyConditionalFormulaDraft: ConditionalFormulaDraft = {
  name: "",
  fieldId: "netRevenue",
  operator: "greaterThan",
  value: "",
  expression: "",
};

const emptyInlineConditionalDraft: InlineConditionalDraft = {
  name: "",
  checkFieldId: "netRevenue",
  operator: "greaterThan",
  value: "",
  thenFieldId: "netRevenue",
  elseFieldId: "productCost",
};

const parseConditionalComparisonValue = (value: string): number => {
  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;

  const normalized = trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed;
  return Number(normalized);
};

const createConditionalFormulaId = (value: string) =>
  `${sanitizeConciliationCalculationId(value || "condicao").replace(/^calc_/, "cond_")}_${Date.now().toString(
    36
  )}_${Math.random().toString(36).slice(2, 8)}`;

const createInlineConditionalId = (value: string) =>
  `${sanitizeConciliationCalculationId(value || "inline").replace(/^calc_/, "inline_")}_${Date.now().toString(
    36
  )}_${Math.random().toString(36).slice(2, 8)}`;

type CalculationDialogFieldOption = {
  id: string;
  label: string;
  helper: string;
  sourceLabel: string;
};

const calculationDialogFieldSourceOrder = ["Sistema", "Marketplace", "Planilha", "Coluna calculada", "Outros"];

const marketplaceCalculationFieldIds = new Set<string>(["payoutPaidNetAmount", "payoutDifferenceAmount"]);

const getCalculationDialogFieldSourceLabel = (fieldId: string): string => {
  if (marketplaceCalculationFieldIds.has(fieldId)) return "Marketplace";
  return "Sistema";
};

const getCalculationDialogFieldSourceSortIndex = (sourceLabel: string) => {
  const index = calculationDialogFieldSourceOrder.indexOf(sourceLabel);
  return index === -1 ? calculationDialogFieldSourceOrder.length : index;
};

export const serializeCustomCalculations = (calculations: ConciliationCustomCalculationInput[]) =>
  JSON.stringify(
    calculations.map((calculation) => ({
      id: calculation.id || "",
      name: calculation.name.trim(),
      description: calculation.description.trim(),
      expression: calculation.expression.trim(),
      conditionalFormulas: (calculation.conditionalFormulas || []).map((formula) => ({
        id: formula.id || "",
        name: formula.name.trim(),
        fieldId: formula.fieldId.trim(),
        operator: formula.operator,
        value: formula.value.trim(),
        expression: formula.expression.trim(),
      })),
      inlineConditionals: (calculation.inlineConditionals || []).map((conditional) => ({
        id: conditional.id || "",
        name: conditional.name.trim(),
        checkFieldId: conditional.checkFieldId.trim(),
        operator: conditional.operator,
        value: conditional.value.trim(),
        thenFieldId: conditional.thenFieldId.trim(),
        elseFieldId: conditional.elseFieldId.trim(),
      })),
      interaction: calculation.interaction?.targetFieldId
        ? {
            targetFieldId: calculation.interaction.targetFieldId.trim(),
            operator: calculation.interaction.operator === "+" ? "+" : "-",
          }
        : null,
      marketplace: calculation.marketplace || "Todos",
      statusNames: [...(calculation.statusNames || [])].map((statusName) => statusName.trim()).filter(Boolean).sort(compareString),
      isPercentage: Boolean(calculation.isPercentage),
      enabled: calculation.enabled !== false,
    }))
  );

const calculationOperatorOptions = [
  { label: "+", token: "+", title: "Somar" },
  { label: "-", token: "-", title: "Subtrair" },
  { label: "x", token: "*", title: "Multiplicar" },
  { label: "/", token: "/", title: "Dividir" },
  { label: "(", token: "(", title: "Abrir grupo" },
  { label: ")", token: ")", title: "Fechar grupo" },
];

export const CalculationSettingsDialog = ({
  open,
  onOpenChange,
  orders = [],
  calculationSettings,
  isSaving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders?: ConciliationOrder[];
  calculationSettings: ConciliationCalculationSettings;
  isSaving: boolean;
  onSave: (calculations: ConciliationCustomCalculationInput[]) => void;
}) => {
  const [draftCalculations, setDraftCalculations] = React.useState<ConciliationCustomCalculationInput[]>([]);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<ConciliationCustomCalculationInput>(emptyCalculationDraft);
  const [fieldSearch, setFieldSearch] = React.useState("");
  const [numberToken, setNumberToken] = React.useState("");
  const [previewOrderId, setPreviewOrderId] = React.useState("");
  const [isStatusScopeOpen, setIsStatusScopeOpen] = React.useState(false);
  const [pendingDeleteCalculation, setPendingDeleteCalculation] =
    React.useState<ConciliationCustomCalculationInput | null>(null);
  const [conditionalDraft, setConditionalDraft] =
    React.useState<ConditionalFormulaDraft>(emptyConditionalFormulaDraft);
  const [editingConditionalId, setEditingConditionalId] = React.useState<string | null>(null);
  const [inlineConditionalDraft, setInlineConditionalDraft] =
    React.useState<InlineConditionalDraft>(emptyInlineConditionalDraft);
  const [editingInlineConditionalId, setEditingInlineConditionalId] = React.useState<string | null>(null);
  const [isInlineBuilderOpen, setIsInlineBuilderOpen] = React.useState(false);
  const [activeFormulaTab, setActiveFormulaTab] = React.useState("default");

  React.useEffect(() => {
    if (!open) return;

    setDraftCalculations(
      calculationSettings.calculations.map((calculation) => ({
        id: calculation.id,
        name: calculation.name,
        description: calculation.description,
        expression: calculation.expression,
        conditionalFormulas: calculation.conditionalFormulas || [],
        inlineConditionals: calculation.inlineConditionals || [],
        interaction: calculation.interaction || null,
        marketplace: calculation.marketplace || "Todos",
        statusNames: calculation.statusNames || [],
        isPercentage: calculation.isPercentage,
        enabled: calculation.enabled,
      }))
    );
    setEditingId(null);
    setDraft(emptyCalculationDraft);
    setFieldSearch("");
    setNumberToken("");
    setIsStatusScopeOpen(false);
    setPendingDeleteCalculation(null);
    setConditionalDraft(emptyConditionalFormulaDraft);
    setEditingConditionalId(null);
    setInlineConditionalDraft(emptyInlineConditionalDraft);
    setEditingInlineConditionalId(null);
    setIsInlineBuilderOpen(false);
    setActiveFormulaTab("default");
  }, [calculationSettings.calculations, open]);

  React.useEffect(() => {
    if (activeFormulaTab === "default") return;

    const conditionalId = activeFormulaTab.replace("conditional:", "");
    if (!(draft.conditionalFormulas || []).some((formula) => formula.id === conditionalId)) {
      setActiveFormulaTab("default");
    }
  }, [activeFormulaTab, draft.conditionalFormulas]);

  React.useEffect(() => {
    if (!open) return;

    setPreviewOrderId((current) => {
      if (current && orders.some((order) => order.id === current)) return current;
      return orders[0]?.id ?? "";
    });
  }, [open, orders]);

  const calculationIds = draftCalculations
    .filter((calculation) => calculation.enabled)
    .map((calculation) => calculation.id)
    .filter((id): id is string => Boolean(id));
  const baseCalculationFields = React.useMemo<CalculationDialogFieldOption[]>(
    () =>
      conciliationCalculationFieldOptions.map((field) => ({
        ...field,
        sourceLabel: getCalculationDialogFieldSourceLabel(field.id),
      })),
    []
  );
  const sheetCalculationFields = React.useMemo<CalculationDialogFieldOption[]>(() => {
    const sheetFieldKeys = new Set<string>();

    orders.forEach((order) => {
      Object.keys(order.sheetFields || {}).forEach((key) => sheetFieldKeys.add(key));
    });

    return buildSheetColumnOptions(Array.from(sheetFieldKeys).sort(compareString)).map((field) => ({
      id: field.id,
      label: field.label,
      helper: field.description || field.id,
      sourceLabel: "Planilha",
    }));
  }, [orders]);
  const customCalculationFields = draftCalculations
    .filter((calculation) => calculation.enabled && calculation.id && calculation.id !== editingId)
    .map<CalculationDialogFieldOption>((calculation) => ({
      id: calculation.id as string,
      label: calculation.name,
      helper: calculation.expression,
      sourceLabel: "Coluna calculada",
    }));
  const inlineConditionalFields = (draft.inlineConditionals || []).map((conditional) => ({
    id: conditional.id,
    label: conditional.name,
    helper: `${conditional.thenFieldId} / ${conditional.elseFieldId}`,
  }));
  const formulaFieldOptions = React.useMemo(
    () => [...baseCalculationFields, ...sheetCalculationFields, ...customCalculationFields],
    [baseCalculationFields, customCalculationFields, sheetCalculationFields]
  );
  const extraCalculationFieldIds = [
    ...calculationIds.filter((id) => id !== editingId),
    ...sheetCalculationFields.map((field) => field.id),
    ...inlineConditionalFields.map((field) => field.id),
  ];
  const conditionFieldOptions = formulaFieldOptions;
  const conditionOperatorLabelByValue = React.useMemo(
    () =>
      new Map<ConciliationCalculationConditionOperator, string>(
        conciliationCalculationConditionOperatorOptions.map((operator) => [operator.value, operator.label])
      ),
    []
  );
  const inlineConditionOperatorLabelByValue = React.useMemo(
    () =>
      new Map<ConciliationCalculationInlineConditionOperator, string>(
        conciliationCalculationInlineConditionOperatorOptions.map((operator) => [operator.value, operator.label])
      ),
    []
  );
  const inlineConditionOperatorNeedsValue = React.useMemo(
    () =>
      new Map<ConciliationCalculationInlineConditionOperator, boolean>(
        conciliationCalculationInlineConditionOperatorOptions.map((operator) => [operator.value, operator.needsValue])
      ),
    []
  );
  const conditionValueError = (value: string) => {
    if (!value.trim()) return "Informe o valor de comparação.";
    if (!Number.isFinite(parseConditionalComparisonValue(value))) return "Valor de comparação inválido.";
    return null;
  };
  const conditionalFormulaError = (formula: ConditionalFormulaDraft) => {
    if (!formula.fieldId.trim()) return "Informe o campo da condição.";
    const valueError = conditionValueError(formula.value);
    if (valueError) return valueError;
    if (!formula.expression.trim()) return "Informe a fórmula da condição.";
    return validateConciliationCalculationExpression(formula.expression, extraCalculationFieldIds);
  };
  const inlineConditionalError = (conditional: InlineConditionalDraft) => {
    if (!conditional.checkFieldId.trim()) return "Informe o campo da condição inline.";
    if (!conditional.thenFieldId.trim()) return "Informe a coluna usada quando a condição for verdadeira.";
    if (!conditional.elseFieldId.trim()) return "Informe a coluna usada quando a condição for falsa.";
    if (inlineConditionOperatorNeedsValue.get(conditional.operator)) {
      const valueError = conditionValueError(conditional.value);
      if (valueError) return valueError;
    }
    return null;
  };
  const expressionError = draft.expression.trim()
    ? validateConciliationCalculationExpression(draft.expression, extraCalculationFieldIds)
    : "Informe uma fórmula.";
  const conditionalDraftError = conditionalFormulaError(conditionalDraft);
  const inlineConditionalDraftError = inlineConditionalError(inlineConditionalDraft);
  const savedConditionalFormulaErrors = (draft.conditionalFormulas || []).map((formula) =>
    conditionalFormulaError(formula)
  );
  const savedInlineConditionalErrors = (draft.inlineConditionals || []).map((conditional) =>
    inlineConditionalError(conditional)
  );
  const hasConditionalFormulaErrors = savedConditionalFormulaErrors.some(Boolean);
  const hasInlineConditionalErrors = savedInlineConditionalErrors.some(Boolean);
  const hasDraftName = draft.name.trim().length > 0;
  const canAddOrUpdate = hasDraftName && !expressionError && !hasConditionalFormulaErrors && !hasInlineConditionalErrors;
  const canAddOrUpdateConditionalFormula = !conditionalDraftError;
  const canAddOrUpdateInlineConditional = !inlineConditionalDraftError;
  const activeConditionalFormula = activeFormulaTab.startsWith("conditional:")
    ? (draft.conditionalFormulas || []).find((formula) => formula.id === activeFormulaTab.replace("conditional:", "")) ?? null
    : null;
  const activeConditionalFormulaIndex = activeConditionalFormula
    ? (draft.conditionalFormulas || []).findIndex((formula) => formula.id === activeConditionalFormula.id)
    : -1;
  const activeFormulaExpression = activeConditionalFormula?.expression ?? draft.expression;
  const activeFormulaError = activeConditionalFormula
    ? conditionalFormulaError(activeConditionalFormula)
    : expressionError;
  const activeFormulaLabel = activeConditionalFormula
    ? `Fórmula da condição ${formatNumber(activeConditionalFormulaIndex + 1)}`
    : "Fórmula padrão";
  const hasChanges =
    serializeCustomCalculations(draftCalculations) !== serializeCustomCalculations(calculationSettings.calculations);
  const activeCalculationsCount = draftCalculations.filter((calculation) => calculation.enabled).length;
  const dialogTitle = editingId ? "Editar Coluna Calculada" : "Criar Coluna Calculada";
  const primaryActionLabel = editingId ? "Salvar Alterações" : "Criar Coluna";
  const marketplaceOptions = React.useMemo(() => {
    const values = new Set<string>();

    orders.forEach((order) => {
      if (order.marketplace) values.add(order.marketplace);
    });
    calculationSettings.calculations.forEach((calculation) => {
      if (calculation.marketplace && calculation.marketplace !== "Todos") values.add(calculation.marketplace);
    });

    return ["Todos", ...Array.from(values).sort(compareString)];
  }, [calculationSettings.calculations, orders]);
  const statusNameOptions = React.useMemo(() => {
    const values = new Set<string>();

    orders.forEach((order) => {
      if (order.statusName) values.add(order.statusName);
    });
    calculationSettings.calculations.forEach((calculation) => {
      (calculation.statusNames || []).forEach((statusName) => {
        if (statusName) values.add(statusName);
      });
    });

    return Array.from(values).sort(compareString);
  }, [calculationSettings.calculations, orders]);
  const selectedStatusNameSet = React.useMemo(() => new Set(draft.statusNames || []), [draft.statusNames]);

  const previewOrders = React.useMemo(() => orders.slice(0, 40), [orders]);
  const previewOrder = React.useMemo(
    () => previewOrders.find((order) => order.id === previewOrderId) ?? previewOrders[0] ?? null,
    [previewOrderId, previewOrders]
  );
  const previewContext = React.useMemo(() => {
    if (!previewOrder) return null;

    const previousValues: Record<string, number> = {};

    draftCalculations.forEach((calculation) => {
      if (
        !calculation.enabled ||
        !calculation.id ||
        calculation.id === editingId ||
        !calculation.expression.trim() ||
        !isConciliationCalculationApplicableToOrder(calculation, previewOrder)
      ) {
        return;
      }

      const baseContext = buildConciliationCalculationContext(previewOrder, previousValues);
      const context = buildConciliationCalculationEvaluationContext(calculation, baseContext);
      const resolvedExpression = resolveConciliationCalculationExpression(calculation, context);
      const result = evaluateConciliationCalculationExpression(resolvedExpression.expression, context);

      if (!result.error) {
        previousValues[calculation.id] = result.value;
        if (calculation.interaction?.targetFieldId) {
          const baseValue = context[calculation.interaction.targetFieldId];
          const nextValue =
            calculation.interaction.operator === "+"
              ? (Number.isFinite(baseValue) ? baseValue : 0) + result.value
              : (Number.isFinite(baseValue) ? baseValue : 0) - result.value;

          previousValues[calculation.interaction.targetFieldId] = Number.isFinite(nextValue) ? nextValue : 0;
        }
      }
    });

    return buildConciliationCalculationContext(previewOrder, previousValues);
  }, [draftCalculations, editingId, previewOrder]);
  const previewAppliesToOrder = previewOrder ? isConciliationCalculationApplicableToOrder(draft, previewOrder) : true;
  const previewEvaluationContext = React.useMemo(() => {
    if (!previewContext) return null;
    return buildConciliationCalculationEvaluationContext(draft, previewContext);
  }, [draft, previewContext]);
  const previewResolvedExpression = React.useMemo(() => {
    if (!previewEvaluationContext || !draft.expression.trim() || !previewAppliesToOrder) return null;
    return resolveConciliationCalculationExpression(draft, previewEvaluationContext);
  }, [draft, previewAppliesToOrder, previewEvaluationContext]);
  const previewResult = React.useMemo(() => {
    if (!previewEvaluationContext || !previewResolvedExpression) return null;
    return evaluateConciliationCalculationExpression(previewResolvedExpression.expression, previewEvaluationContext);
  }, [previewEvaluationContext, previewResolvedExpression]);

  const calculationFieldLabelById = React.useMemo(() => {
    const labels = new Map<string, string>();

    formulaFieldOptions.forEach((field) => labels.set(field.id, field.label));
    inlineConditionalFields.forEach((field) => labels.set(field.id, field.label));

    return labels;
  }, [formulaFieldOptions, inlineConditionalFields]);
  const normalizedFieldSearch = fieldSearch.trim().toLocaleLowerCase("pt-BR");
  const filteredFormulaFields = normalizedFieldSearch
    ? formulaFieldOptions.filter((field) =>
        `${field.label} ${field.helper} ${field.id} ${field.sourceLabel}`
          .toLocaleLowerCase("pt-BR")
          .includes(normalizedFieldSearch)
      )
    : formulaFieldOptions;
  const groupedFormulaFields = Array.from(
    filteredFormulaFields.reduce<Map<string, CalculationDialogFieldOption[]>>((groups, field) => {
      const sourceLabel = field.sourceLabel || "Outros";
      const current = groups.get(sourceLabel) || [];

      current.push(field);
      groups.set(sourceLabel, current);

      return groups;
    }, new Map())
  )
    .map(([sourceLabel, fields]) => ({
      sourceLabel,
      fields: fields.sort((first, second) => compareString(first.label, second.label)),
    }))
    .sort((first, second) => {
      const orderComparison =
        getCalculationDialogFieldSourceSortIndex(first.sourceLabel) -
        getCalculationDialogFieldSourceSortIndex(second.sourceLabel);

      return orderComparison || compareString(first.sourceLabel, second.sourceLabel);
    });
  const expressionTokens = activeFormulaExpression.trim() ? activeFormulaExpression.trim().split(/\s+/) : [];

  const updateDraft = <Field extends keyof ConciliationCustomCalculationInput>(
    field: Field,
    value: ConciliationCustomCalculationInput[Field]
  ) => {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateConditionalDraft = <Field extends keyof ConditionalFormulaDraft>(
    field: Field,
    value: ConditionalFormulaDraft[Field]
  ) => {
    setConditionalDraft((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateInlineConditionalDraft = <Field extends keyof InlineConditionalDraft>(
    field: Field,
    value: InlineConditionalDraft[Field]
  ) => {
    setInlineConditionalDraft((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateInteractionTarget = (targetFieldId: string) => {
    updateDraft(
      "interaction",
      targetFieldId === "none"
        ? null
        : {
            targetFieldId,
            operator: draft.interaction?.operator || "-",
          }
    );
  };

  const updateInteractionOperator = (operator: "+" | "-") => {
    if (!draft.interaction?.targetFieldId) return;

    updateDraft("interaction", {
      ...draft.interaction,
      operator,
    });
  };

  const toggleDraftStatusName = (statusName: string, checked: boolean) => {
    setDraft((current) => {
      const currentStatusNames = current.statusNames || [];
      const statusNames = checked
        ? currentStatusNames.includes(statusName)
          ? currentStatusNames
          : [...currentStatusNames, statusName]
        : currentStatusNames.filter((currentStatusName) => currentStatusName !== statusName);

      return {
        ...current,
        statusNames: statusNames.sort(compareString),
      };
    });
  };

  const clearDraftStatusNames = () => {
    updateDraft("statusNames", []);
  };

  const updateActiveFormulaExpression = (expression: string) => {
    if (activeConditionalFormula) {
      setDraft((current) => ({
        ...current,
        conditionalFormulas: (current.conditionalFormulas || []).map((formula) =>
          formula.id === activeConditionalFormula.id
            ? {
                ...formula,
                expression,
              }
            : formula
        ),
      }));
      return;
    }

    updateDraft("expression", expression);
  };

  const appendExpressionToken = (token: string) => {
    setDraft((current) => {
      if (activeConditionalFormula) {
        return {
          ...current,
          conditionalFormulas: (current.conditionalFormulas || []).map((formula) => {
            if (formula.id !== activeConditionalFormula.id) return formula;

            const expression = formula.expression.trim();

            return {
              ...formula,
              expression: expression ? `${expression} ${token}` : token,
            };
          }),
        };
      }

      const expression = current.expression.trim();

      return {
        ...current,
        expression: expression ? `${expression} ${token}` : token,
      };
    });
  };

  const appendFieldToExpression = (fieldId: ConciliationCalculationFieldId | string) => {
    appendExpressionToken(`{${fieldId}}`);
  };

  const useDefaultFormulaAsConditionalExpression = () => {
    const expression = draft.expression.trim();
    if (!expression) return;

    updateConditionalDraft("expression", expression);
  };

  const appendNumberToExpression = () => {
    const value = numberToken.trim();
    if (!value) return;

    appendExpressionToken(value);
    setNumberToken("");
  };

  const deleteLastExpressionToken = () => {
    setDraft((current) => {
      if (activeConditionalFormula) {
        return {
          ...current,
          conditionalFormulas: (current.conditionalFormulas || []).map((formula) =>
            formula.id === activeConditionalFormula.id
              ? {
                  ...formula,
                  expression: formula.expression.trim().replace(/\s*\S+$/, ""),
                }
              : formula
          ),
        };
      }

      return {
        ...current,
        expression: current.expression.trim().replace(/\s*\S+$/, ""),
      };
    });
  };

  const resetDraft = () => {
    setEditingId(null);
    setDraft(emptyCalculationDraft);
    setNumberToken("");
    setConditionalDraft(emptyConditionalFormulaDraft);
    setEditingConditionalId(null);
    setInlineConditionalDraft(emptyInlineConditionalDraft);
    setEditingInlineConditionalId(null);
    setActiveFormulaTab("default");
  };

  const resetConditionalDraft = () => {
    setConditionalDraft(emptyConditionalFormulaDraft);
    setEditingConditionalId(null);
  };

  const resetInlineConditionalDraft = () => {
    setInlineConditionalDraft(emptyInlineConditionalDraft);
    setEditingInlineConditionalId(null);
  };

  const removeInlineConditionalTokenFromExpression = (expression: string, inlineConditionalId: string) =>
    expression
      .replace(new RegExp(`\\{${inlineConditionalId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`, "g"), "")
      .replace(/\s+/g, " ")
      .trim();

  const upsertInlineConditional = () => {
    if (!canAddOrUpdateInlineConditional) return;

    const id =
      editingInlineConditionalId ||
      inlineConditionalDraft.id ||
      createInlineConditionalId(inlineConditionalDraft.name || inlineConditionalDraft.checkFieldId);
    const normalized: ConciliationCalculationInlineConditional = {
      id,
      name: inlineConditionalDraft.name.trim() || `Inline ${(draft.inlineConditionals || []).length + 1}`,
      checkFieldId: inlineConditionalDraft.checkFieldId.trim(),
      operator: inlineConditionalDraft.operator,
      value: inlineConditionOperatorNeedsValue.get(inlineConditionalDraft.operator)
        ? inlineConditionalDraft.value.trim()
        : "",
      thenFieldId: inlineConditionalDraft.thenFieldId.trim(),
      elseFieldId: inlineConditionalDraft.elseFieldId.trim(),
    };

    setDraft((current) => {
      const inlineConditionals = current.inlineConditionals || [];
      const nextInlineConditionals = editingInlineConditionalId
        ? inlineConditionals.map((conditional) => (conditional.id === editingInlineConditionalId ? normalized : conditional))
        : [...inlineConditionals, normalized];
      const expression = editingInlineConditionalId
        ? current.expression
        : current.expression.trim()
          ? `${current.expression.trim()} {${id}}`
          : `{${id}}`;

      return {
        ...current,
        expression,
        inlineConditionals: nextInlineConditionals,
      };
    });
    resetInlineConditionalDraft();
    setIsInlineBuilderOpen(false);
  };

  const editInlineConditional = (conditional: ConciliationCalculationInlineConditional) => {
    setEditingInlineConditionalId(conditional.id);
    setInlineConditionalDraft({
      id: conditional.id,
      name: conditional.name,
      checkFieldId: conditional.checkFieldId,
      operator: conditional.operator,
      value: conditional.value,
      thenFieldId: conditional.thenFieldId,
      elseFieldId: conditional.elseFieldId,
    });
    setIsInlineBuilderOpen(true);
  };

  const removeInlineConditional = (inlineConditionalId: string) => {
    setDraft((current) => ({
      ...current,
      expression: removeInlineConditionalTokenFromExpression(current.expression, inlineConditionalId),
      conditionalFormulas: (current.conditionalFormulas || []).map((formula) => ({
        ...formula,
        expression: removeInlineConditionalTokenFromExpression(formula.expression, inlineConditionalId),
      })),
      inlineConditionals: (current.inlineConditionals || []).filter(
        (conditional) => conditional.id !== inlineConditionalId
      ),
    }));
    if (editingInlineConditionalId === inlineConditionalId) resetInlineConditionalDraft();
  };

  const upsertConditionalFormula = () => {
    if (!canAddOrUpdateConditionalFormula) return;

    const id = editingConditionalId || conditionalDraft.id || createConditionalFormulaId(conditionalDraft.name || conditionalDraft.fieldId);
    const normalized: ConciliationCalculationConditionalFormula = {
      id,
      name: conditionalDraft.name.trim() || `Condição ${(draft.conditionalFormulas || []).length + 1}`,
      fieldId: conditionalDraft.fieldId.trim(),
      operator: conditionalDraft.operator,
      value: conditionalDraft.value.trim(),
      expression: conditionalDraft.expression.trim(),
    };

    setDraft((current) => {
      const conditionalFormulas = current.conditionalFormulas || [];

      return {
        ...current,
        conditionalFormulas: editingConditionalId
          ? conditionalFormulas.map((formula) => (formula.id === editingConditionalId ? normalized : formula))
          : [...conditionalFormulas, normalized],
      };
    });
    resetConditionalDraft();
    setActiveFormulaTab(`conditional:${id}`);
  };

  const editConditionalFormula = (formula: ConciliationCalculationConditionalFormula) => {
    setEditingConditionalId(formula.id);
    setConditionalDraft({
      id: formula.id,
      name: formula.name,
      fieldId: formula.fieldId,
      operator: formula.operator,
      value: formula.value,
      expression: formula.expression,
    });
    setActiveFormulaTab(`conditional:${formula.id}`);
  };

  const removeConditionalFormula = (formulaId: string) => {
    setDraft((current) => ({
      ...current,
      conditionalFormulas: (current.conditionalFormulas || []).filter((formula) => formula.id !== formulaId),
    }));
    if (editingConditionalId === formulaId) resetConditionalDraft();
    if (activeFormulaTab === `conditional:${formulaId}`) setActiveFormulaTab("default");
  };

  const moveConditionalFormula = (formulaId: string, direction: -1 | 1) => {
    setDraft((current) => {
      const conditionalFormulas = current.conditionalFormulas || [];
      const currentIndex = conditionalFormulas.findIndex((formula) => formula.id === formulaId);
      const nextIndex = currentIndex + direction;

      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= conditionalFormulas.length) return current;

      const next = [...conditionalFormulas];
      const [movedFormula] = next.splice(currentIndex, 1);

      if (!movedFormula) return current;

      next.splice(nextIndex, 0, movedFormula);

      return {
        ...current,
        conditionalFormulas: next,
      };
    });
    setActiveFormulaTab(`conditional:${formulaId}`);
  };

  const upsertDraftCalculation = () => {
    if (!canAddOrUpdate) return;

    const id = editingId || draft.id || sanitizeConciliationCalculationId(draft.name);
    const normalized: ConciliationCustomCalculationInput = {
      id,
      name: draft.name.trim(),
      description: draft.description.trim(),
      expression: draft.expression.trim(),
      conditionalFormulas: [...(draft.conditionalFormulas || [])],
      inlineConditionals: [...(draft.inlineConditionals || [])],
      interaction: draft.interaction?.targetFieldId ? draft.interaction : null,
      marketplace: draft.marketplace || "Todos",
      statusNames: [...(draft.statusNames || [])].map((statusName) => statusName.trim()).filter(Boolean).sort(compareString),
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
      conditionalFormulas: calculation.conditionalFormulas || [],
      inlineConditionals: calculation.inlineConditionals || [],
      interaction: calculation.interaction || null,
      marketplace: calculation.marketplace || "Todos",
      statusNames: calculation.statusNames || [],
      isPercentage: calculation.isPercentage,
      enabled: calculation.enabled,
    });
    setConditionalDraft(emptyConditionalFormulaDraft);
    setEditingConditionalId(null);
    setInlineConditionalDraft(emptyInlineConditionalDraft);
    setEditingInlineConditionalId(null);
    setIsInlineBuilderOpen(false);
    setActiveFormulaTab("default");
  };

  const removeCalculation = (calculationId: string | undefined) => {
    if (!calculationId) return;

    setDraftCalculations((current) => current.filter((calculation) => calculation.id !== calculationId));
    if (editingId === calculationId) resetDraft();
  };

  const requestRemoveCalculation = (calculation: ConciliationCustomCalculationInput) => {
    if (!calculation.id) return;
    setPendingDeleteCalculation(calculation);
  };

  const confirmRemoveCalculation = () => {
    removeCalculation(pendingDeleteCalculation?.id);
    setPendingDeleteCalculation(null);
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

  const getTokenLabel = (token: string) => {
    const fieldId = token.match(/^\{(.+)\}$/)?.[1];
    return fieldId ? calculationFieldLabelById.get(fieldId) ?? fieldId : token;
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[96vw] max-w-7xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-slate-200 px-5 py-4 text-left">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <DialogTitle className="text-lg leading-tight sm:text-xl">{dialogTitle}</DialogTitle>
              <DialogDescription className="leading-relaxed">
                Monte a coluna calculada com campos financeiros, operadores, valores fixos e preview do resultado.
              </DialogDescription>
            </div>
            <Badge variant="outline" className="w-fit">
              {formatNumber(draftCalculations.length)} colunas
            </Badge>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-4">
              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
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
                  <label className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
                    <span className="text-sm text-slate-700">Ativo</span>
                    <Switch
                      checked={draft.enabled}
                      onCheckedChange={(checked) => updateDraft("enabled", checked)}
                      disabled={isSaving}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
                    <span className="text-sm text-slate-700">Resultado em porcentagem</span>
                    <Switch
                      checked={draft.isPercentage}
                      onCheckedChange={(checked) => updateDraft("isPercentage", checked)}
                      disabled={isSaving}
                    />
                  </label>
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Marketplace
                    </span>
                    <Select
                      value={draft.marketplace || "Todos"}
                      onValueChange={(value) => updateDraft("marketplace", value)}
                      disabled={isSaving}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Todos marketplaces" />
                      </SelectTrigger>
                      <SelectContent>
                        {marketplaceOptions.map((marketplace) => (
                          <SelectItem key={marketplace} value={marketplace}>
                            {marketplace === "Todos" ? "Todos marketplaces" : marketplace}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <div className="grid gap-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Status do pedido
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      className="justify-between"
                      onClick={() => setIsStatusScopeOpen((current) => !current)}
                      disabled={isSaving}
                    >
                      <span className="truncate">
                        {(draft.statusNames || []).length > 0
                          ? `${formatNumber(draft.statusNames.length)} status selecionado(s)`
                          : "Todos os status"}
                      </span>
                      <ChevronDown
                        className={cn(
                          "ml-2 h-4 w-4 text-muted-foreground transition-transform",
                          isStatusScopeOpen && "rotate-180"
                        )}
                      />
                    </Button>
                  </div>
                </div>
                {isStatusScopeOpen ? (
                  <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
                    <div className="border-b border-slate-200 bg-slate-50/70 p-3">
                      <p className="text-sm font-medium text-slate-950">Status aplicáveis</p>
                      <p className="text-xs text-muted-foreground">
                        Sem seleção, a coluna vale para todos os status.
                      </p>
                    </div>
                    <div className="grid max-h-56 gap-1 overflow-y-auto p-2 sm:grid-cols-2">
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-slate-50"
                        onClick={clearDraftStatusNames}
                        disabled={isSaving || (draft.statusNames || []).length === 0}
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                            (draft.statusNames || []).length === 0
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-slate-300 bg-white"
                          )}
                          aria-hidden="true"
                        >
                          {(draft.statusNames || []).length === 0 ? <Check className="h-3 w-3" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">Todos os status</span>
                      </button>
                      {statusNameOptions.map((statusName) => {
                        const checked = selectedStatusNameSet.has(statusName);

                        return (
                          <button
                            key={statusName}
                            type="button"
                            className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-slate-50"
                            onClick={() => toggleDraftStatusName(statusName, !checked)}
                            disabled={isSaving}
                          >
                            <span
                              className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                                checked
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-slate-300 bg-white"
                              )}
                              aria-hidden="true"
                            >
                              {checked ? <Check className="h-3 w-3" /> : null}
                            </span>
                            <span className="min-w-0 flex-1 truncate" title={statusName}>
                              {statusName}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {draft.marketplace && draft.marketplace !== "Todos" ? draft.marketplace : "Todos marketplaces"}
                  </Badge>
                  <Badge variant="secondary">
                    {(draft.statusNames || []).length > 0
                      ? `${formatNumber(draft.statusNames.length)} status`
                      : "Todos os status"}
                  </Badge>
                </div>
              </section>

              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-3">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-950">Monte a fórmula</p>
                      <p className="text-xs text-muted-foreground">
                        Crie colunas matemáticas usando campos financeiros, condições e valores fixos.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          document.getElementById("conciliation-conditional-formulas")?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          })
                        }
                        disabled={isSaving}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Adicionar Condição
                      </Button>
                      <Button
                        type="button"
                        variant={isInlineBuilderOpen ? "default" : "outline"}
                        size="sm"
                        onClick={() => setIsInlineBuilderOpen((current) => !current)}
                        disabled={isSaving}
                      >
                        <GitBranch className="mr-2 h-4 w-4" />
                        Condicional Inline
                      </Button>
                      <Badge variant={activeFormulaError ? "destructive" : "outline"}>
                        {activeFormulaError ? "Revisar" : "Pronta"}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="space-y-4 p-4">
                  <Alert className="border-slate-200 bg-slate-50">
                    <CircleAlert className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Condições são fórmulas alternativas. Condicional inline escolhe entre duas colunas dentro da
                      própria fórmula.
                    </AlertDescription>
                  </Alert>

                  <Tabs value={activeFormulaTab} onValueChange={setActiveFormulaTab}>
                    <TabsList className="h-auto max-w-full flex-wrap justify-start">
                      <TabsTrigger value="default">Padrão</TabsTrigger>
                      {(draft.conditionalFormulas || []).map((formula, index) => (
                        <TabsTrigger key={formula.id} value={`conditional:${formula.id}`} className="gap-2">
                          Condição {formatNumber(index + 1)}
                          <Badge variant="secondary" className="h-5 px-1.5 py-0 text-[10px]">
                            {formula.name || `#${formatNumber(index + 1)}`}
                          </Badge>
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>

                  {activeConditionalFormula ? (
                    <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 text-xs text-muted-foreground">
                        <span className="font-medium text-slate-700">
                          Prioridade {formatNumber(activeConditionalFormulaIndex + 1)}
                        </span>
                        {" · "}
                        Se {calculationFieldLabelById.get(activeConditionalFormula.fieldId) || activeConditionalFormula.fieldId}{" "}
                        {conditionOperatorLabelByValue.get(activeConditionalFormula.operator) ||
                          activeConditionalFormula.operator}{" "}
                        {activeConditionalFormula.value}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => moveConditionalFormula(activeConditionalFormula.id, -1)}
                          disabled={isSaving || activeConditionalFormulaIndex === 0}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => moveConditionalFormula(activeConditionalFormula.id, 1)}
                          disabled={
                            isSaving ||
                            activeConditionalFormulaIndex === (draft.conditionalFormulas || []).length - 1
                          }
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7"
                          onClick={() => editConditionalFormula(activeConditionalFormula)}
                          disabled={isSaving}
                        >
                          Editar condição
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-red-600 hover:text-red-700"
                          onClick={() => removeConditionalFormula(activeConditionalFormula.id)}
                          disabled={isSaving}
                        >
                          Remover
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div className="min-h-16 rounded-md border border-slate-200 bg-slate-50 p-2">
                    {expressionTokens.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {expressionTokens.map((token, index) => (
                          <Badge
                            key={`${token}-${index}`}
                            variant={token.startsWith("{") ? "secondary" : "outline"}
                            className="max-w-full rounded-md px-2 py-1 font-mono text-[11px]"
                          >
                            <span className="truncate">{getTokenLabel(token)}</span>
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="px-1 py-3 text-sm text-muted-foreground">Nenhum item na fórmula.</p>
                    )}
                  </div>

                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {activeFormulaLabel}
                    </span>
                    <Input
                      value={activeFormulaExpression}
                      onChange={(event) => updateActiveFormulaExpression(event.target.value)}
                      placeholder="{netRevenue} - {productCost} - {shippingCost}"
                      disabled={isSaving}
                      className={cn(
                        activeFormulaError &&
                          activeFormulaExpression.trim() &&
                          "border-red-300 focus-visible:ring-red-300"
                      )}
                    />
                    <span className={cn("text-xs", activeFormulaError ? "text-red-600" : "text-muted-foreground")}>
                      {activeFormulaError || "Expressão válida."}
                    </span>
                  </label>

                  {isInlineBuilderOpen || (draft.inlineConditionals || []).length > 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="flex items-center gap-2 text-sm font-medium text-slate-950">
                          <GitBranch className="h-4 w-4 text-muted-foreground" />
                          Condicional inline
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Insere um token que escolhe entre duas colunas dentro da fórmula.
                        </p>
                      </div>
                      <Badge variant={(draft.inlineConditionals || []).length > 0 ? "default" : "outline"}>
                        {formatNumber((draft.inlineConditionals || []).length)} inline
                      </Badge>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_160px]">
                      <label className="grid gap-1.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Nome
                        </span>
                        <Input
                          value={inlineConditionalDraft.name}
                          onChange={(event) => updateInlineConditionalDraft("name", event.target.value)}
                          placeholder="Ex.: Líquido ou custo"
                          disabled={isSaving}
                        />
                      </label>
                      <label className="grid gap-1.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Se o campo
                        </span>
                        <Select
                          value={inlineConditionalDraft.checkFieldId}
                          onValueChange={(value) => updateInlineConditionalDraft("checkFieldId", value)}
                          disabled={isSaving}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecionar campo" />
                          </SelectTrigger>
                          <SelectContent>
                            {conditionFieldOptions.map((field) => (
                              <SelectItem key={field.id} value={field.id}>
                                {field.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                      <label className="grid gap-1.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Operador
                        </span>
                        <Select
                          value={inlineConditionalDraft.operator}
                          onValueChange={(value) =>
                            updateInlineConditionalDraft("operator", value as ConciliationCalculationInlineConditionOperator)
                          }
                          disabled={isSaving}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {conciliationCalculationInlineConditionOperatorOptions.map((operator) => (
                              <SelectItem key={operator.value} value={operator.value}>
                                {operator.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                      <label className="grid gap-1.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Valor
                        </span>
                        <Input
                          value={inlineConditionalDraft.value}
                          onChange={(event) => updateInlineConditionalDraft("value", event.target.value)}
                          inputMode="decimal"
                          placeholder="0,00"
                          disabled={isSaving || !inlineConditionOperatorNeedsValue.get(inlineConditionalDraft.operator)}
                        />
                      </label>
                      <label className="grid gap-1.5 lg:col-span-2">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Use quando verdadeiro
                        </span>
                        <Select
                          value={inlineConditionalDraft.thenFieldId}
                          onValueChange={(value) => updateInlineConditionalDraft("thenFieldId", value)}
                          disabled={isSaving}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecionar coluna" />
                          </SelectTrigger>
                          <SelectContent>
                            {conditionFieldOptions.map((field) => (
                              <SelectItem key={field.id} value={field.id}>
                                {field.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                      <label className="grid gap-1.5 lg:col-span-2">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Senão use
                        </span>
                        <Select
                          value={inlineConditionalDraft.elseFieldId}
                          onValueChange={(value) => updateInlineConditionalDraft("elseFieldId", value)}
                          disabled={isSaving}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecionar coluna" />
                          </SelectTrigger>
                          <SelectContent>
                            {conditionFieldOptions.map((field) => (
                              <SelectItem key={field.id} value={field.id}>
                                {field.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <p className={cn("text-xs", inlineConditionalDraftError ? "text-red-600" : "text-muted-foreground")}>
                        {inlineConditionalDraftError || "Inline pronto para inserir na fórmula."}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={resetInlineConditionalDraft} disabled={isSaving}>
                          Limpar inline
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={upsertInlineConditional}
                          disabled={isSaving || !canAddOrUpdateInlineConditional}
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          {editingInlineConditionalId ? "Atualizar inline" : "Adicionar inline"}
                        </Button>
                      </div>
                    </div>

                    {(draft.inlineConditionals || []).length > 0 ? (
                      <div className="mt-3 grid gap-2">
                        {(draft.inlineConditionals || []).map((conditional, index) => {
                          const inlineError = savedInlineConditionalErrors[index];

                          return (
                            <div
                              key={conditional.id}
                              className={cn(
                                "rounded-md border bg-white p-3",
                                editingInlineConditionalId === conditional.id ? "border-primary bg-primary/5" : "border-slate-200",
                                inlineError && "border-red-200 bg-red-50"
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-slate-950">{conditional.name}</p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Se {calculationFieldLabelById.get(conditional.checkFieldId) || conditional.checkFieldId}{" "}
                                    {inlineConditionOperatorLabelByValue.get(conditional.operator) || conditional.operator}
                                    {inlineConditionOperatorNeedsValue.get(conditional.operator)
                                      ? ` ${conditional.value}`
                                      : ""}{" "}
                                    use {calculationFieldLabelById.get(conditional.thenFieldId) || conditional.thenFieldId};
                                    senão {calculationFieldLabelById.get(conditional.elseFieldId) || conditional.elseFieldId}
                                  </p>
                                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">{`{${conditional.id}}`}</p>
                                  {inlineError ? <p className="mt-1 text-xs text-red-700">{inlineError}</p> : null}
                                </div>
                                <Badge variant="outline">Inline</Badge>
                              </div>
                              <div className="mt-3 flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => editInlineConditional(conditional)}
                                  disabled={isSaving}
                                >
                                  Editar
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeInlineConditional(conditional.id)}
                                  disabled={isSaving}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Remover
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                  ) : null}

                  <div className="grid gap-3 xl:grid-cols-[1fr_240px]">
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Operadores
                      </p>
                      <div className="grid grid-cols-6 gap-2">
                        {calculationOperatorOptions.map((operator) => (
                          <Button
                            key={operator.token}
                            type="button"
                            variant="outline"
                            className="h-9 px-0 font-mono"
                            onClick={() => appendExpressionToken(operator.token)}
                            disabled={isSaving}
                            title={operator.title}
                          >
                            {operator.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Valor fixo
                      </p>
                      <div className="flex gap-2">
                        <Input
                          value={numberToken}
                          onChange={(event) => setNumberToken(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              appendNumberToExpression();
                            }
                          }}
                          inputMode="decimal"
                          placeholder="0,00"
                          disabled={isSaving}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0"
                          onClick={appendNumberToExpression}
                          disabled={isSaving || !numberToken.trim()}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section id="conciliation-conditional-formulas" className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-medium text-slate-950">
                        <GitBranch className="h-4 w-4 text-muted-foreground" />
                        Fórmulas condicionais
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Use fórmulas alternativas quando um campo atender a uma condição.
                      </p>
                    </div>
                    <Badge variant={(draft.conditionalFormulas || []).length > 0 ? "default" : "outline"}>
                      {formatNumber((draft.conditionalFormulas || []).length)} condição(ões)
                    </Badge>
                  </div>
                </div>
                <div className="space-y-4 p-4">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_160px]">
                    <label className="grid gap-1.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Nome da condição
                      </span>
                      <Input
                        value={conditionalDraft.name}
                        onChange={(event) => updateConditionalDraft("name", event.target.value)}
                        placeholder="Ex.: Margem acima da meta"
                        disabled={isSaving}
                      />
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Se o campo
                      </span>
                      <Select
                        value={conditionalDraft.fieldId}
                        onValueChange={(value) => updateConditionalDraft("fieldId", value)}
                        disabled={isSaving}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecionar campo" />
                        </SelectTrigger>
                        <SelectContent>
                          {conditionFieldOptions.map((field) => (
                            <SelectItem key={field.id} value={field.id}>
                              {field.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Operador
                      </span>
                      <Select
                        value={conditionalDraft.operator}
                        onValueChange={(value) =>
                          updateConditionalDraft("operator", value as ConciliationCalculationConditionOperator)
                        }
                        disabled={isSaving}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {conciliationCalculationConditionOperatorOptions.map((operator) => (
                            <SelectItem key={operator.value} value={operator.value}>
                              {operator.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Valor
                      </span>
                      <Input
                        value={conditionalDraft.value}
                        onChange={(event) => updateConditionalDraft("value", event.target.value)}
                        inputMode="decimal"
                        placeholder="0,00"
                        disabled={isSaving}
                      />
                    </label>
                    <label className="grid gap-1.5 lg:col-span-4">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Fórmula desta condição
                      </span>
                      <Input
                        value={conditionalDraft.expression}
                        onChange={(event) => updateConditionalDraft("expression", event.target.value)}
                        placeholder="{netRevenue} - {productCost}"
                        disabled={isSaving}
                        className={cn(
                          conditionalDraftError &&
                            conditionalDraft.expression.trim() &&
                            "border-red-300 focus-visible:ring-red-300"
                        )}
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className={cn("text-xs", conditionalDraftError ? "text-red-600" : "text-muted-foreground")}>
                      {conditionalDraftError || "Condição pronta para adicionar."}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={useDefaultFormulaAsConditionalExpression}
                        disabled={isSaving || !draft.expression.trim()}
                      >
                        Usar fórmula padrão
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={resetConditionalDraft} disabled={isSaving}>
                        Limpar condição
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={upsertConditionalFormula}
                        disabled={isSaving || !canAddOrUpdateConditionalFormula}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        {editingConditionalId ? "Atualizar condição" : "Adicionar condição"}
                      </Button>
                    </div>
                  </div>

                  {(draft.conditionalFormulas || []).length > 0 ? (
                    <div className="space-y-2">
                      {(draft.conditionalFormulas || []).map((formula, index) => {
                        const formulaError = savedConditionalFormulaErrors[index];

                        return (
                          <div
                            key={formula.id}
                            className={cn(
                              "rounded-md border p-3",
                              editingConditionalId === formula.id ? "border-primary bg-primary/5" : "border-slate-200",
                              formulaError && "border-red-200 bg-red-50"
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-950">
                                  Prioridade {formatNumber(index + 1)} - {formula.name}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Se {calculationFieldLabelById.get(formula.fieldId) || formula.fieldId}{" "}
                                  {conditionOperatorLabelByValue.get(formula.operator) || formula.operator}{" "}
                                  {formula.value}
                                </p>
                                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                                  {formula.expression}
                                </p>
                                {formulaError ? (
                                  <p className="mt-1 text-xs text-red-700">{formulaError}</p>
                                ) : null}
                              </div>
                              <Badge variant="outline">Condição {formatNumber(index + 1)}</Badge>
                            </div>
                            <div className="mt-3 flex flex-wrap justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => moveConditionalFormula(formula.id, -1)}
                                disabled={isSaving || index === 0}
                                aria-label={`Mover condição ${formula.name} para cima`}
                              >
                                <ArrowUp className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => moveConditionalFormula(formula.id, 1)}
                                disabled={isSaving || index === (draft.conditionalFormulas || []).length - 1}
                                aria-label={`Mover condição ${formula.name} para baixo`}
                              >
                                <ArrowDown className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => editConditionalFormula(formula)}
                                disabled={isSaving}
                              >
                                Editar
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeConditionalFormula(formula.id)}
                                disabled={isSaving}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Remover
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyDetailState>Sem condições. A fórmula padrão será usada para todos os pedidos aplicáveis.</EmptyDetailState>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium text-slate-950">
                      <Zap className="h-4 w-4 text-amber-500" />
                      Interação opcional
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Aplique o resultado desta coluna sobre outro campo financeiro.
                    </p>
                  </div>
                  <Badge variant={draft.interaction?.targetFieldId ? "default" : "outline"}>
                    {draft.interaction?.targetFieldId ? "Ativa" : "Nenhuma"}
                  </Badge>
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_minmax(0,180px)]">
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Coluna alvo
                    </span>
                    <Select
                      value={draft.interaction?.targetFieldId || "none"}
                      onValueChange={updateInteractionTarget}
                      disabled={isSaving}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Nenhuma interação" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhuma interação</SelectItem>
                        {conditionFieldOptions.map((field) => (
                          <SelectItem key={field.id} value={field.id}>
                            {field.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Operação
                    </span>
                    <Select
                      value={draft.interaction?.operator || "-"}
                      onValueChange={(value) => updateInteractionOperator(value === "+" ? "+" : "-")}
                      disabled={isSaving || !draft.interaction?.targetFieldId}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="-">Subtrair</SelectItem>
                        <SelectItem value="+">Adicionar</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <div className="grid gap-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Coluna calculada
                    </span>
                    <div className="flex min-h-10 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800">
                      <span className="truncate">{draft.name.trim() || "Nova coluna"}</span>
                    </div>
                  </div>
                </div>
                {draft.interaction?.targetFieldId ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {draft.interaction.operator === "+" ? "Adicionar" : "Subtrair"}{" "}
                    {draft.name.trim() || "esta coluna"} em{" "}
                    {calculationFieldLabelById.get(draft.interaction.targetFieldId) || draft.interaction.targetFieldId}.
                  </p>
                ) : null}
              </section>

              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-950">Colunas disponíveis</p>
                    <p className="text-xs text-muted-foreground">
                      {formatNumber(filteredFormulaFields.length)} coluna(s) por origem. Clique para inserir na fórmula.
                    </p>
                  </div>
                  <div className="relative w-full sm:w-72">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={fieldSearch}
                      onChange={(event) => setFieldSearch(event.target.value)}
                      placeholder="Buscar coluna"
                      className="h-9 pl-8"
                      disabled={isSaving}
                    />
                  </div>
                </div>
                <div className="max-h-80 space-y-4 overflow-y-auto p-3">
                  {groupedFormulaFields.length > 0 ? (
                    groupedFormulaFields.map((group) => (
                      <div key={group.sourceLabel} className="space-y-2">
                        <div className="flex items-center justify-between gap-3 px-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            {group.sourceLabel}
                          </p>
                          <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
                            {formatNumber(group.fields.length)}
                          </Badge>
                        </div>
                        <div className="grid gap-1.5 xl:grid-cols-2">
                          {group.fields.map((field) => (
                            <Button
                              key={field.id}
                              type="button"
                              variant="ghost"
                              className="h-auto justify-start gap-3 rounded-md border border-transparent px-2 py-2 text-left hover:border-slate-200 hover:bg-slate-50"
                              onClick={() => appendFieldToExpression(field.id)}
                              disabled={isSaving}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{field.label}</span>
                                <span className="block truncate font-mono text-xs text-muted-foreground">
                                  {field.helper}
                                </span>
                              </span>
                              <Badge variant="secondary" className="shrink-0 text-[10px]">
                                {field.sourceLabel}
                              </Badge>
                            </Button>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyDetailState>Nenhuma coluna encontrada.</EmptyDetailState>
                  )}
                </div>
              </section>
            </div>

            <aside className="min-w-0 space-y-4">
              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-3">
                  <p className="text-sm font-medium text-slate-950">Preview</p>
                  <p className="text-xs text-muted-foreground">Amostra com um pedido da consulta atual.</p>
                </div>
                <div className="space-y-3 p-4">
                  {previewOrders.length > 0 ? (
                    <>
                      <Select value={previewOrder?.id ?? ""} onValueChange={setPreviewOrderId} disabled={isSaving}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecionar pedido" />
                        </SelectTrigger>
                        <SelectContent>
                          {previewOrders.map((order) => (
                            <SelectItem key={order.id} value={order.id}>
                              Pedido {order.number ?? order.storeNumber}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {previewOrder ? (
                        <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                          <div>
                            <p className="truncate text-sm font-medium text-slate-950">
                              Pedido {previewOrder.number ?? previewOrder.storeNumber}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{previewOrder.customerName}</p>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <DetailItem label="Marketplace" value={previewOrder.marketplace || "-"} />
                            <DetailItem label="Status" value={previewOrder.statusName || "-"} />
                            <DetailItem label="Bruto" value={formatCurrency(previewOrder.grossRevenue)} />
                            <DetailItem label="Líquido" value={formatCurrency(previewOrder.netRevenue)} />
                          </div>
                        </div>
                      ) : null}
                      <div
                        className={cn(
                          "rounded-md border p-3",
                          previewResult?.error ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"
                        )}
                      >
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Resultado</p>
                        {previewResolvedExpression ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {previewResolvedExpression.conditionalFormula
                              ? `Fórmula condicional: ${previewResolvedExpression.conditionalFormula.name}`
                              : "Fórmula padrão"}
                          </p>
                        ) : null}
                        <p
                          className={cn(
                            "mt-1 text-2xl font-semibold",
                            !previewAppliesToOrder || previewResult?.error ? "text-red-700" : "text-emerald-700"
                          )}
                        >
                          {!previewAppliesToOrder
                            ? "Não se aplica"
                            : previewResult
                              ? previewResult.error
                                ? "-"
                                : formatCalculationValue(previewResult.value, draft.isPercentage)
                            : "-"}
                        </p>
                        {!previewAppliesToOrder ? (
                          <p className="mt-1 text-xs text-red-700">
                            O pedido selecionado não pertence ao marketplace/status configurado.
                          </p>
                        ) : previewResult?.error ? (
                          <p className="mt-1 text-xs text-red-700">{previewResult.error}</p>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <EmptyDetailState>Execute uma consulta para visualizar o resultado.</EmptyDetailState>
                  )}
                </div>
              </section>

              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-950">Colunas criadas</p>
                    <p className="text-xs text-muted-foreground">{formatNumber(activeCalculationsCount)} ativa(s)</p>
                  </div>
                  <Badge variant="outline">{formatNumber(draftCalculations.length)}</Badge>
                </div>
                {pendingDeleteCalculation ? (
                  <div className="border-b border-red-100 bg-red-50 p-3">
                    <p className="text-sm font-medium text-red-900">Excluir coluna calculada?</p>
                    <p className="mt-1 text-xs leading-relaxed text-red-700">
                      A coluna "{pendingDeleteCalculation.name}" será removida da configuração local. A remoção só será
                      gravada após clicar em Salvar cálculos.
                    </p>
                    <div className="mt-3 flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setPendingDeleteCalculation(null)}
                        disabled={isSaving}
                      >
                        Cancelar
                      </Button>
                      <Button type="button" variant="destructive" size="sm" onClick={confirmRemoveCalculation} disabled={isSaving}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Excluir coluna
                      </Button>
                    </div>
                  </div>
                ) : null}
                <div className="max-h-80 overflow-y-auto p-2">
                  {draftCalculations.length > 0 ? (
                    <div className="space-y-2">
                      {draftCalculations.map((calculation, index) => (
                        <div
                          key={calculation.id}
                          className={cn(
                            "rounded-md border p-3 transition-colors",
                            editingId === calculation.id ? "border-primary bg-primary/5" : "border-slate-200"
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{calculation.name}</p>
                              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                                {calculation.expression}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-1">
                                <Badge variant="secondary" className="max-w-36 truncate">
                                  {calculation.marketplace && calculation.marketplace !== "Todos"
                                    ? calculation.marketplace
                                    : "Todos marketplaces"}
                                </Badge>
                                <Badge variant="secondary">
                                  {(calculation.statusNames || []).length > 0
                                    ? `${formatNumber(calculation.statusNames.length)} status`
                                    : "Todos os status"}
                                </Badge>
                                {(calculation.conditionalFormulas || []).length > 0 ? (
                                  <Badge variant="outline">
                                    {formatNumber((calculation.conditionalFormulas || []).length)} condição(ões)
                                  </Badge>
                                ) : null}
                                {(calculation.inlineConditionals || []).length > 0 ? (
                                  <Badge variant="outline">
                                    {formatNumber((calculation.inlineConditionals || []).length)} inline
                                  </Badge>
                                ) : null}
                                {calculation.interaction?.targetFieldId ? (
                                  <Badge variant="outline">
                                    {calculation.interaction.operator === "+" ? "Interação +" : "Interação -"}
                                  </Badge>
                                ) : null}
                              </div>
                            </div>
                            <Badge variant={calculation.enabled ? "default" : "outline"}>
                              {calculation.enabled ? "Ativo" : "Inativo"}
                            </Badge>
                          </div>
                          <div className="mt-3 flex flex-wrap justify-end gap-2">
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
                              onClick={() => requestRemoveCalculation(calculation)}
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
              </section>

              <section className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <DetailItem label="Atualizado em" value={formatDateTime(calculationSettings.updatedAt)} />
                <DetailItem label="Atualizado por" value={formatActor(calculationSettings.updatedBy)} />
              </section>
            </aside>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={deleteLastExpressionToken}
              disabled={isSaving || !activeFormulaExpression.trim()}
            >
              <Undo2 className="mr-2 h-4 w-4" />
              Apagar último
            </Button>
            <Button type="button" variant="outline" onClick={resetDraft} disabled={isSaving}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {editingId ? "Novo" : "Limpar"}
            </Button>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {editingId ? (
              <Button type="button" variant="destructive" onClick={() => requestRemoveCalculation(draft)} disabled={isSaving}>
                <Trash2 className="mr-2 h-4 w-4" />
                Excluir coluna
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancelar
            </Button>
            <Button type="button" variant="outline" onClick={upsertDraftCalculation} disabled={!canAddOrUpdate || isSaving}>
              <Plus className="mr-2 h-4 w-4" />
              {primaryActionLabel}
            </Button>
            <Button type="button" onClick={() => onSave(draftCalculations)} disabled={!hasChanges || isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar cálculos
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};

export const DivergenceRuleNumberField = ({
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

export const DivergenceRuleCheckboxField = ({
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

export const DivergenceRuleEditor = ({
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

export const FinancialDivergenceSettingsDialog = ({
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

export const StatusMappingsDialog = ({
  open,
  onOpenChange,
  orders,
  statusMappings,
  statusSettings,
  systemStatusSettings,
  isSaving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: ConciliationOrder[];
  statusMappings: ConciliationStatusMappings;
  statusSettings: ConciliationStatusSettings;
  systemStatusSettings: ConciliationSystemStatusSettings;
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
                        <SystemStatusBadge status={defaultStatus} systemStatusSettings={systemStatusSettings} />
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
                              {`Automático (${getConciliationSystemStatusDisplayName(
                                systemStatusSettings,
                                defaultStatus
                              )})`}
                            </SelectItem>
                            {conciliationSystemStatusOptions.map((statusOption) => {
                              const definition = getConciliationSystemStatusDefinition(
                                systemStatusSettings,
                                statusOption
                              );

                              return (
                                <SelectItem key={statusOption} value={statusOption}>
                                  {definition.displayName}
                                  {!definition.active ? " (inativo)" : ""}
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
