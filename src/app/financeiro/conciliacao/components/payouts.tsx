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


import {
  DetailItem,
  EmptyDetailState,
  formatActor,
  formatCurrency,
  formatDateTime,
  formatNumber,
} from "./shared";

export const normalizeImportHeader = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();

export const findImportColumn = (headers: string[], aliases: string[]) => {
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

export const parseImportMoney = (value: unknown): number | null => {
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

export const parseImportDate = (value: unknown): string | null => {
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

export const payoutOrderKeyAliases = [
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
export const payoutPaidAtAliases = ["data repasse", "data pagamento", "data liquidacao", "paid at", "payment date", "data"];
export const payoutGrossAliases = ["valor bruto", "bruto", "gross amount", "gross", "valor venda", "total venda"];
export const payoutFeeAliases = ["taxa", "tarifa", "comissao", "fee", "fees", "marketplace fee"];
export const payoutShippingAliases = ["frete", "shipping", "envio", "custo frete", "shipping amount"];
export const payoutNetAliases = [
  "valor liquido",
  "liquido",
  "net amount",
  "net",
  "valor repasse",
  "repasse",
  "total recebido",
  "amount",
];

export type PayoutImportColumnKey = "orderKey" | "paidAt" | "grossAmount" | "feeAmount" | "shippingAmount" | "netAmount";
export type PayoutImportMapping = Record<PayoutImportColumnKey, string>;

export type PayoutImportRawRow = {
  sourceRow: number;
  values: Record<string, unknown>;
  hasAnyValue: boolean;
};

export const emptyPayoutImportMapping: PayoutImportMapping = {
  orderKey: "",
  paidAt: "",
  grossAmount: "",
  feeAmount: "",
  shippingAmount: "",
  netAmount: "",
};

export const payoutImportFieldDefinitions: Array<{
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

export const noPayoutColumnSelectValue = "__none__";

export const buildPayoutInputId = (fileName: string, marketplace: string, orderKey: string, sourceRow: number) => {
  const marketplacePart = normalizeConciliationPayoutOrderKey(marketplace) || "MARKETPLACE";
  const orderPart = normalizeConciliationPayoutOrderKey(orderKey) || "SEMCHAVE";
  const filePart = normalizeConciliationPayoutOrderKey(fileName).slice(0, 40) || "ARQUIVO";

  return `${marketplacePart}-${orderPart}-${filePart}-${sourceRow}`;
};

export const buildUniqueImportHeaders = (headerRow: unknown[]): string[] => {
  const counts = new Map<string, number>();

  return headerRow.map((value, index) => {
    const baseHeader = String(value || `Coluna ${index + 1}`).trim() || `Coluna ${index + 1}`;
    const count = counts.get(baseHeader) || 0;

    counts.set(baseHeader, count + 1);

    return count === 0 ? baseHeader : `${baseHeader} (${count + 1})`;
  });
};

export const readPayoutWorksheet = (
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

export const buildSuggestedPayoutMapping = (headers: string[]): PayoutImportMapping =>
  payoutImportFieldDefinitions.reduce<PayoutImportMapping>(
    (mapping, field) => ({
      ...mapping,
      [field.id]: findImportColumn(headers, field.aliases),
    }),
    emptyPayoutImportMapping
  );

export const parsePayoutRowsFromMapping = (
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

export const getOrderPayoutImportKeys = (order: ConciliationOrder): string[] => {
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

export type PayoutImportGroup = {
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

export const getPayoutImportGroupId = (payout: ConciliationMarketplacePayout) =>
  payout.importBatchId || `${payout.sourceFileName}::${payout.importedAt || "sem-data"}`;

export const buildPayoutImportGroups = (
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
export const PayoutImportDialog = ({
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

export const PayoutHistoryDialog = ({
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
