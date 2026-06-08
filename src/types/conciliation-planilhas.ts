// Tipos do fluxo de importação de planilhas de conciliação.
// Portado do sistema de referência (faturamentto-clientes) e adaptado ao
// Firestore/br-steel: nomes camelCase, sem companyId (instância única).

export type PlanilhaDataType = "text" | "number" | "currency" | "date";

export type PlanilhaMatchStrategy = "exact" | "normalize" | "alphanumeric";

export type PlanilhaTargetField = "orderNumber" | "storeNumber" | "customerName" | "sku";

export type PlanilhaColumnMapping = {
  originalName: string;
  friendlyName: string;
  dataType: PlanilhaDataType;
  displayInConciliacao: boolean;
  /** Chave gravada em dataFields (fallback: originalName). */
  destinationKey?: string;
  /** Somar valores quando várias linhas casam com o mesmo pedido. */
  aggregateSum?: boolean;
  sampleValue?: string;
};

export type PlanilhaAssociationSettings = {
  /** Header da planilha usado como chave de associação. */
  keyColumn: string;
  targetField: PlanilhaTargetField;
  matchStrategy: PlanilhaMatchStrategy;
};

export type ConciliationImportCategory = {
  id: string;
  name: string;
  slug: string;
  color: string;
  icon?: string | null;
  sortOrder: number;
  usageCount: number;
  isDefault: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ConciliationImportTemplate = {
  id: string;
  name: string;
  marketplace: string;
  isDefault: boolean;
  /** Chave = header normalizado; valor = mapping padrão parcial. */
  defaultMappings: Record<string, Partial<PlanilhaColumnMapping>>;
  associationSettings: PlanilhaAssociationSettings;
  lastUsedAt?: string | null;
};

export type ConciliationImportFileStatus = "processing" | "success" | "partial" | "no_match" | "error";

export type ConciliationImportUnmatchedRow = {
  rowNumber: number;
  keyValue: string;
  reason: string;
};

export type ConciliationImportFileRecord = {
  id: string;
  fileName: string;
  customName?: string | null;
  marketplace: string;
  categoryId?: string | null;
  categoryName?: string | null;
  referenceMonth: string; // "YYYY-MM"
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  groupedSales: number;
  status: ConciliationImportFileStatus;
  columnMappings: PlanilhaColumnMapping[];
  associationSettings: PlanilhaAssociationSettings;
  unmatchedSamples?: ConciliationImportUnmatchedRow[];
  errorMessage?: string | null;
  reprocessCount?: number;
  lastReprocessedAt?: string | null;
  importedBy?: { id: string; name: string; email: string } | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ConciliationSheetAssociation = {
  id: string;
  fileId: string;
  fileName: string;
  marketplace: string;
  categoryId?: string | null;
  /** Id da venda associada (saleOrder). Null para associações por SKU. */
  saleId: string | null;
  /** Chave normalizada usada no match (nº pedido, SKU etc.). */
  orderKey: string;
  targetField: PlanilhaTargetField;
  saleMonth: string;
  referenceMonth: string;
  dataFields: Record<string, string | number | null>;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type PlanilhaDataConflict = {
  id: string;
  keyValue: string;
  saleId: string;
  orderCode: string;
  field: string;
  fieldLabel: string;
  existingValue: unknown;
  newValue: unknown;
  existingSource?: string;
  resolution?: PlanilhaConflictResolution;
};

export type PlanilhaConflictResolution = "replace" | "sum" | "discard";

export type PlanilhaConflictGroup = {
  field: string;
  fieldLabel: string;
  conflicts: PlanilhaDataConflict[];
};

export type PlanilhaMonthMatchSummary = {
  month: string;
  matches: number;
};

export type PlanilhaMatchedAssociationDraft = {
  saleId: string | null;
  orderKey: string;
  saleMonth: string;
  dataFields: Record<string, string | number | null>;
};

export type PlanilhaMatchResult = {
  matchedRows: number;
  unmatchedRows: number;
  groupedSales: number;
  duplicateKeys: number;
  associations: PlanilhaMatchedAssociationDraft[];
  unmatchedDetails: ConciliationImportUnmatchedRow[];
  crossMonthMatches: PlanilhaMonthMatchSummary[];
};

export const PLANILHA_UPLOAD_EXTENSIONS = [".csv", ".xlsx", ".xls"] as const;
export const PLANILHA_UPLOAD_MAX_SIZE_BYTES = 200 * 1024 * 1024;
export const PLANILHA_UPLOAD_MAX_SIZE_LABEL = "200 MB";
export const PLANILHA_MAX_ROWS = 10000;
