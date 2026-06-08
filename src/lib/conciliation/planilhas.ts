// Lógica pura do fluxo de importação de planilhas: normalização de chaves,
// matching contra pedidos, aplicação de templates, janela temporal e
// validação de arquivo. Sem dependências de Firebase ou fetch.

import type { ConciliationOrder } from "@/types/conciliation";
import type {
  ConciliationImportCategory,
  ConciliationImportFileRecord,
  ConciliationImportTemplate,
  ConciliationImportUnmatchedRow,
  PlanilhaAssociationSettings,
  PlanilhaColumnMapping,
  PlanilhaDataType,
  PlanilhaMatchResult,
  PlanilhaMatchStrategy,
  PlanilhaMonthMatchSummary,
  PlanilhaTargetField,
} from "@/types/conciliation-planilhas";
import {
  PLANILHA_UPLOAD_EXTENSIONS,
  PLANILHA_UPLOAD_MAX_SIZE_BYTES,
  PLANILHA_UPLOAD_MAX_SIZE_LABEL,
} from "@/types/conciliation-planilhas";

type UnknownRecord = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

export const normalizePlanilhaLabel = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizePlanilhaKey = (value: unknown, strategy: PlanilhaMatchStrategy): string => {
  const raw = String(value ?? "").trim();

  if (!raw) return "";

  if (strategy === "exact") return raw;

  if (strategy === "alphanumeric") {
    return raw
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase();
  }

  // normalize (padrão)
  return raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
};

// ---------------------------------------------------------------------------
// Parsing de valores
// ---------------------------------------------------------------------------

export const parsePlanilhaNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const cleaned = value
    .replace(/[R$\s]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(cleaned);

  return Number.isFinite(parsed) ? parsed : null;
};

export const coercePlanilhaValue = (
  value: unknown,
  dataType: PlanilhaDataType
): string | number | null => {
  if (value === null || value === undefined || value === "") return null;

  if (dataType === "number" || dataType === "currency") {
    return parsePlanilhaNumber(value);
  }

  return String(value).trim() || null;
};

export const detectPlanilhaDataType = (sample: unknown): PlanilhaDataType => {
  if (typeof sample === "number") return "number";
  if (typeof sample !== "string") return "text";

  const trimmed = sample.trim();

  if (/^r\$\s?/i.test(trimmed)) return "currency";
  if (/^-?[\d.,]+$/.test(trimmed) && parsePlanilhaNumber(trimmed) !== null) return "number";
  if (/^\d{2}\/\d{2}\/\d{4}/.test(trimmed) || /^\d{4}-\d{2}-\d{2}/.test(trimmed)) return "date";

  return "text";
};

// ---------------------------------------------------------------------------
// Janela temporal
// ---------------------------------------------------------------------------

export const addPlanilhaMonths = (monthYear: string, delta: number): string => {
  const [year, month] = monthYear.split("-").map(Number);
  const base = new Date(year, (month || 1) - 1 + delta, 1);

  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
};

export const getPlanilhaMonthWindow = (referenceMonth: string, before = 2, after = 2): string[] => {
  const months: string[] = [];

  for (let delta = -before; delta <= after; delta += 1) {
    months.push(addPlanilhaMonths(referenceMonth, delta));
  }

  return months;
};

export const extractMonthFromIso = (value: string | null | undefined): string | null => {
  if (!value) return null;

  const match = /^(\d{4})-(\d{2})/.exec(value);

  return match ? `${match[1]}-${match[2]}` : null;
};

export const formatPlanilhaMonthLabel = (monthYear: string): string => {
  const [year, month] = monthYear.split("-").map(Number);
  const labels = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];

  return `${labels[(month || 1) - 1]} ${year}`;
};

// ---------------------------------------------------------------------------
// Estatísticas da página
// ---------------------------------------------------------------------------

export type PlanilhasStats = {
  total: number;
  completed: number;
  processing: number;
  errors: number;
  totalRows: number;
  avgMatch: number;
  categories: number;
};

export const computePlanilhasStats = (
  files: ConciliationImportFileRecord[],
  categories: ConciliationImportCategory[]
): PlanilhasStats => {
  const totalRows = files.reduce((sum, file) => sum + (file.totalRows || 0), 0);
  const matchedRows = files.reduce((sum, file) => sum + (file.matchedRows || 0), 0);

  return {
    total: files.length,
    completed: files.filter((file) => ["success", "partial", "no_match"].includes(file.status)).length,
    processing: files.filter((file) => file.status === "processing").length,
    errors: files.filter((file) => file.status === "error").length,
    totalRows,
    avgMatch: totalRows > 0 ? Math.round((matchedRows / totalRows) * 100) : 0,
    categories: categories.length,
  };
};

// ---------------------------------------------------------------------------
// Validação de arquivo
// ---------------------------------------------------------------------------

export const validatePlanilhaFile = (file: { name: string; size: number }): string | null => {
  const lowered = file.name.toLowerCase();

  if (!PLANILHA_UPLOAD_EXTENSIONS.some((extension) => lowered.endsWith(extension))) {
    return "Formato não suportado. Use .csv, .xlsx ou .xls.";
  }

  if (file.size === 0) {
    return "Arquivo vazio. Envie uma planilha com dados.";
  }

  if (file.size > PLANILHA_UPLOAD_MAX_SIZE_BYTES) {
    return `Arquivo muito grande (${Math.round(file.size / (1024 * 1024))} MB). Tamanho máximo: ${PLANILHA_UPLOAD_MAX_SIZE_LABEL}.`;
  }

  return null;
};

// ---------------------------------------------------------------------------
// Headers únicos
// ---------------------------------------------------------------------------

export const buildUniquePlanilhaHeaders = (headerRow: unknown[]): string[] => {
  const seen = new Map<string, number>();

  return headerRow.map((value, index) => {
    const base = String(value ?? "").trim() || `Coluna ${index + 1}`;
    const count = seen.get(base) ?? 0;

    seen.set(base, count + 1);

    return count === 0 ? base : `${base} (${count + 1})`;
  });
};

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const getPlanilhaDestinationKey = (mapping: PlanilhaColumnMapping): string =>
  mapping.destinationKey?.trim() || mapping.originalName;

export const getPlanilhaDestinationLabel = (mapping: PlanilhaColumnMapping): string =>
  mapping.friendlyName?.trim() || mapping.originalName;

export const defaultPlanilhaTemplates: ConciliationImportTemplate[] = [
  {
    id: "tpl_mercado_livre",
    name: "Padrão Mercado Livre",
    marketplace: "Mercado Livre",
    isDefault: true,
    defaultMappings: {
      "n de venda": { friendlyName: "Pedido", displayInConciliacao: false },
      "numero da venda": { friendlyName: "Pedido", displayInConciliacao: false },
      "tarifa de venda": { friendlyName: "Comissão ML", dataType: "currency", aggregateSum: true, destinationKey: "commission" },
      "tarifas de envio": { friendlyName: "Frete ML", dataType: "currency", aggregateSum: true, destinationKey: "shipping" },
      "valor da venda": { friendlyName: "Valor ML", dataType: "currency", aggregateSum: true },
      "repasse": { friendlyName: "Repasse ML", dataType: "currency", aggregateSum: true, destinationKey: "netValue" },
    },
    associationSettings: { keyColumn: "N de venda", targetField: "orderNumber", matchStrategy: "normalize" },
  },
  {
    id: "tpl_shopee",
    name: "Padrão Shopee",
    marketplace: "Shopee",
    isDefault: true,
    defaultMappings: {
      "id do pedido": { friendlyName: "Pedido", displayInConciliacao: false },
      "comissao": { friendlyName: "Comissão Shopee", dataType: "currency", aggregateSum: true, destinationKey: "commission" },
      "taxa de servico": { friendlyName: "Taxa de Serviço", dataType: "currency", aggregateSum: true, destinationKey: "fee" },
      "valor estimado do frete": { friendlyName: "Frete Shopee", dataType: "currency", aggregateSum: true, destinationKey: "shipping" },
      "valor total liberado": { friendlyName: "Repasse Shopee", dataType: "currency", aggregateSum: true, destinationKey: "netValue" },
    },
    associationSettings: { keyColumn: "ID do Pedido", targetField: "orderNumber", matchStrategy: "normalize" },
  },
  {
    id: "tpl_custos_produto",
    name: "Padrão Custos de Produto",
    marketplace: "Custos",
    isDefault: true,
    defaultMappings: {
      "sku": { friendlyName: "SKU", displayInConciliacao: false },
      "codigo": { friendlyName: "SKU", displayInConciliacao: false },
      "custo": { friendlyName: "Custo Unitário", dataType: "currency", destinationKey: "unitCost" },
      "custo unitario": { friendlyName: "Custo Unitário", dataType: "currency", destinationKey: "unitCost" },
    },
    associationSettings: { keyColumn: "SKU", targetField: "sku", matchStrategy: "alphanumeric" },
  },
  {
    id: "tpl_devolucoes",
    name: "Padrão Devoluções",
    marketplace: "Devoluções",
    isDefault: true,
    defaultMappings: {
      "pedido": { friendlyName: "Pedido", displayInConciliacao: false },
      "n de venda": { friendlyName: "Pedido", displayInConciliacao: false },
      "motivo": { friendlyName: "Motivo Devolução", dataType: "text", destinationKey: "returnReason" },
      "valor reembolsado": { friendlyName: "Valor Reembolsado", dataType: "currency", aggregateSum: true, destinationKey: "refundAmount" },
      "quantidade": { friendlyName: "Qtd Devolvida", dataType: "number", aggregateSum: true, destinationKey: "returnQuantity" },
    },
    associationSettings: { keyColumn: "Pedido", targetField: "orderNumber", matchStrategy: "normalize" },
  },
];

export const applyTemplateToHeaders = (
  headers: string[],
  template: ConciliationImportTemplate | null,
  sampleRow?: unknown[]
): { columnMappings: PlanilhaColumnMapping[]; associationSettings: PlanilhaAssociationSettings } => {
  const mappingEntries = Object.entries(template?.defaultMappings ?? {});

  const columnMappings = headers.map((header, index) => {
    const normalizedHeader = normalizePlanilhaLabel(header);
    const sample = sampleRow?.[index];

    const matched = mappingEntries.find(([key]) => {
      const normalizedKey = normalizePlanilhaLabel(key);

      return (
        normalizedKey === normalizedHeader ||
        normalizedHeader.includes(normalizedKey) ||
        normalizedKey.includes(normalizedHeader)
      );
    });

    const base: PlanilhaColumnMapping = {
      originalName: header,
      friendlyName: header,
      dataType: detectPlanilhaDataType(sample),
      displayInConciliacao: true,
      sampleValue: sample === null || sample === undefined ? undefined : String(sample),
    };

    if (!matched) return base;

    return {
      ...base,
      ...matched[1],
      originalName: header,
      friendlyName: matched[1].friendlyName ?? header,
      dataType: matched[1].dataType ?? base.dataType,
      displayInConciliacao: matched[1].displayInConciliacao ?? true,
    };
  });

  const templateKeyColumn = template?.associationSettings.keyColumn;
  const keyColumn =
    (templateKeyColumn &&
      headers.find(
        (header) =>
          normalizePlanilhaLabel(header) === normalizePlanilhaLabel(templateKeyColumn) ||
          normalizePlanilhaLabel(header).includes(normalizePlanilhaLabel(templateKeyColumn))
      )) ||
    headers[0] ||
    "";

  return {
    columnMappings,
    associationSettings: {
      keyColumn,
      targetField: template?.associationSettings.targetField ?? "orderNumber",
      matchStrategy: template?.associationSettings.matchStrategy ?? "normalize",
    },
  };
};

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const getOrderTargetKeys = (
  order: ConciliationOrder,
  targetField: PlanilhaTargetField,
  strategy: PlanilhaMatchStrategy
): string[] => {
  const originalOrder = order.originalOrder as unknown as UnknownRecord;
  const notaFiscal = originalOrder?.notaFiscal as UnknownRecord | undefined;

  const rawValues: unknown[] = (() => {
    switch (targetField) {
      case "orderNumber":
        return [
          order.id,
          order.orderId,
          order.number,
          order.storeNumber,
          originalOrder?.numeroPedidoCompra,
          notaFiscal?.numeroPedidoLoja,
        ];
      case "storeNumber":
        return [order.storeNumber];
      case "customerName":
        return [order.customerName];
      case "sku":
        return order.items.map((item) => item.sku);
    }
  })();

  return Array.from(
    new Set(rawValues.map((value) => normalizePlanilhaKey(value, strategy)).filter(Boolean))
  );
};

export const runPlanilhaMatcher = ({
  rows,
  headers,
  columnMappings,
  associationSettings,
  orders,
  referenceMonth,
}: {
  rows: unknown[][];
  headers: string[];
  columnMappings: PlanilhaColumnMapping[];
  associationSettings: PlanilhaAssociationSettings;
  orders: ConciliationOrder[];
  referenceMonth: string;
}): PlanilhaMatchResult => {
  const { keyColumn, targetField, matchStrategy } = associationSettings;
  const keyIndex = headers.indexOf(keyColumn);
  const mappingByIndex = columnMappings.map((mapping) => ({
    mapping,
    index: headers.indexOf(mapping.originalName),
  }));

  // Índice de pedidos por chave normalizada. Para SKU, indexa todos os SKUs.
  const orderByKey = new Map<string, ConciliationOrder>();

  if (targetField !== "sku") {
    orders.forEach((order) => {
      getOrderTargetKeys(order, targetField, matchStrategy).forEach((key) => {
        if (!orderByKey.has(key)) orderByKey.set(key, order);
      });
    });
  }

  type Accumulated = {
    saleId: string | null;
    orderKey: string;
    saleMonth: string;
    dataFields: Record<string, string | number | null>;
  };

  const accumulatedByKey = new Map<string, Accumulated>();
  const seenKeys = new Set<string>();
  const unmatchedDetails: ConciliationImportUnmatchedRow[] = [];
  const crossMonthCounts = new Map<string, number>();
  let matchedRows = 0;
  let unmatchedRows = 0;
  let duplicateKeys = 0;

  rows.forEach((row, rowIndex) => {
    const rawKey = keyIndex >= 0 ? row[keyIndex] : undefined;
    const normalizedKey = normalizePlanilhaKey(rawKey, matchStrategy);
    const fallbackKey =
      !normalizedKey || (targetField !== "sku" && !orderByKey.has(normalizedKey))
        ? normalizePlanilhaKey(rawKey, "normalize")
        : normalizedKey;
    const effectiveKey = normalizedKey && (targetField === "sku" || orderByKey.has(normalizedKey))
      ? normalizedKey
      : fallbackKey;

    if (!effectiveKey) {
      unmatchedRows += 1;
      if (unmatchedDetails.length < 50) {
        unmatchedDetails.push({
          rowNumber: rowIndex + 2,
          keyValue: String(rawKey ?? ""),
          reason: "Chave vazia ou inválida",
        });
      }
      return;
    }

    const matchedOrder = targetField === "sku" ? null : orderByKey.get(effectiveKey) ?? null;

    if (targetField !== "sku" && !matchedOrder) {
      unmatchedRows += 1;
      if (unmatchedDetails.length < 50) {
        unmatchedDetails.push({
          rowNumber: rowIndex + 2,
          keyValue: String(rawKey ?? ""),
          reason: "Pedido não encontrado",
        });
      }
      return;
    }

    matchedRows += 1;

    if (seenKeys.has(effectiveKey)) {
      duplicateKeys += 1;
    }
    seenKeys.add(effectiveKey);

    const saleMonth =
      (matchedOrder ? extractMonthFromIso(matchedOrder.date) : null) ?? referenceMonth;

    if (matchedOrder && saleMonth !== referenceMonth) {
      crossMonthCounts.set(saleMonth, (crossMonthCounts.get(saleMonth) ?? 0) + 1);
    }

    const existing = accumulatedByKey.get(effectiveKey) ?? {
      saleId: matchedOrder?.id ?? null,
      orderKey: effectiveKey,
      saleMonth,
      dataFields: {},
    };

    mappingByIndex.forEach(({ mapping, index }) => {
      if (index < 0 || !mapping.displayInConciliacao) return;

      const destinationKey = getPlanilhaDestinationKey(mapping);
      const value = coercePlanilhaValue(row[index], mapping.dataType);

      if (value === null) return;

      if (mapping.aggregateSum && typeof value === "number") {
        const current = existing.dataFields[destinationKey];

        existing.dataFields[destinationKey] =
          typeof current === "number" ? current + value : value;
      } else {
        existing.dataFields[destinationKey] = value;
      }
    });

    accumulatedByKey.set(effectiveKey, existing);
  });

  const crossMonthMatches: PlanilhaMonthMatchSummary[] = Array.from(crossMonthCounts.entries())
    .map(([month, matches]) => ({ month, matches }))
    .sort((first, second) => second.month.localeCompare(first.month));

  return {
    matchedRows,
    unmatchedRows,
    groupedSales: accumulatedByKey.size,
    duplicateKeys,
    associations: Array.from(accumulatedByKey.values()),
    unmatchedDetails,
    crossMonthMatches,
  };
};

// ---------------------------------------------------------------------------
// Categorias padrão
// ---------------------------------------------------------------------------

export const defaultPlanilhaCategories = [
  { slug: "repasse", name: "Repasse", color: "green", icon: "banknote", sortOrder: 10 },
  { slug: "devolucao", name: "Devolução", color: "orange", icon: "undo-2", sortOrder: 20 },
  { slug: "custos", name: "Custos de Produto", color: "red", icon: "package", sortOrder: 30 },
  { slug: "ajuste", name: "Ajuste", color: "purple", icon: "wrench", sortOrder: 40 },
  { slug: "conciliacao", name: "Conciliação", color: "blue", icon: "check-circle-2", sortOrder: 50 },
  { slug: "outro", name: "Outro", color: "slate", icon: "box", sortOrder: 60 },
] as const;
