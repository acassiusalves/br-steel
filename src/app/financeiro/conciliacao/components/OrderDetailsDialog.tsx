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


import {
  AuditTimeline,
  CalculatedColumnsBadge,
  ConciliationSuggestionBadge,
  DetailCard,
  DetailItem,
  EmptyDetailState,
  FinancialAdjustmentDraft,
  FinancialAdjustmentsBadge,
  FinancialDivergenceBadge,
  FinancialDivergenceReasons,
  PayoutComparisonBadge,
  SystemStatusBadge,
  SystemStatusSelectValue,
  automaticStatusSelectValue,
  buildConciliationAuditEvents,
  financialAdjustmentFields,
  formatActor,
  formatCalculationValue,
  formatCurrency,
  formatCurrencyInput,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercentage,
  getFinancialAdjustmentSummary,
  getOrderCalculationValues,
  getStatusVariant,
  parseCurrencyInput,
} from "./shared";

export const OrderDetailsDialog = ({
  order,
  onClose,
  isSaving,
  systemStatusSettings,
  onSaveSystemStatus,
  onSaveFinancialAdjustments,
}: {
  order: ConciliationOrder | null;
  onClose: () => void;
  isSaving: boolean;
  systemStatusSettings: ConciliationSystemStatusSettings;
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
                  value={<SystemStatusBadge status={order.systemStatus} systemStatusSettings={systemStatusSettings} />}
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
                    value={<SystemStatusBadge status={order.systemStatus} systemStatusSettings={systemStatusSettings} />}
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
                        <DetailItem
                          label="Automático"
                          value={getConciliationSystemStatusDisplayName(systemStatusSettings, order.automaticSystemStatus)}
                        />
                        <DetailItem
                          label="Aplicado"
                          value={<SystemStatusBadge status={order.systemStatus} systemStatusSettings={systemStatusSettings} />}
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
                            {`Automático (${getConciliationSystemStatusDisplayName(
                              systemStatusSettings,
                              order.automaticSystemStatus
                            )})`}
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
