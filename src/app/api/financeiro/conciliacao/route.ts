import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase-admin";
import {
  normalizeConciliationFinancialDivergenceRules,
  type ConciliationFinancialDivergenceRules,
} from "@/lib/conciliation/divergences";
import { normalizeConciliationCustomCalculations } from "@/lib/conciliation/calculations";
import {
  normalizeConciliationSummaryMetricIds,
  type ConciliationSummaryMetricId,
} from "@/lib/conciliation/summary";
import {
  isConciliationSystemStatus,
  resolveAutomaticSystemStatus,
  type ConciliationSystemStatus,
} from "@/lib/conciliation/status";
import { requirePagePermission } from "@/lib/server-auth";
import type {
  ConciliationActor,
  ConciliationAuditEvent,
  ConciliationAuditEventType,
  ConciliationCalculationSettings,
  ConciliationCustomCalculationInput,
  ConciliationDivergenceSettings,
  ConciliationFinancialAdjustment,
  ConciliationFinancialAdjustmentFieldId,
  ConciliationFinancialAdjustmentInput,
  ConciliationFinancialAdjustments,
  ConciliationFinancialSnapshot,
  ConciliationMarketplacePayout,
  ConciliationMarketplacePayoutInput,
  ConciliationRecord,
  ConciliationRecordInput,
  ConciliationSummarySettings,
  ConciliationStatusMappings,
  ConciliationStatusSettings,
} from "@/types/conciliation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const collectionName = "conciliationSales";
const payoutCollectionName = "conciliationMarketplacePayouts";
const settingsCollectionName = "conciliationSettings";
const statusSettingsDocumentId = "statusMappings";
const summarySettingsDocumentId = "summary";
const divergenceSettingsDocumentId = "divergenceRules";
const calculationSettingsDocumentId = "calculations";
const maxPayoutImportRows = 1000;
const maxBatchWrites = 450;
const financialAdjustmentLabels: Record<ConciliationFinancialAdjustmentFieldId, string> = {
  grossRevenue: "Faturamento bruto",
  productRevenue: "Produtos",
  customerShippingRevenue: "Frete cliente",
  discountAmount: "Desconto",
  otherExpenses: "Outras despesas",
  productCost: "Custo produto",
  shippingCost: "Frete custo",
  commissionFee: "Comissão",
  taxes: "Impostos",
};
const financialAdjustmentFieldIds = new Set<ConciliationFinancialAdjustmentFieldId>(
  Object.keys(financialAdjustmentLabels) as ConciliationFinancialAdjustmentFieldId[]
);

const asIsoString = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  return null;
};

const normalizeActor = (value: unknown): ConciliationActor | null => {
  if (!value || typeof value !== "object") return null;
  const actor = value as Partial<ConciliationActor>;

  return {
    id: String(actor.id || ""),
    name: String(actor.name || actor.email || "Usuário"),
    email: String(actor.email || ""),
  };
};

const toFiniteNumber = (value: unknown): number => {
  const numberValue = typeof value === "number" ? value : Number(value);

  return Number.isFinite(numberValue) ? numberValue : 0;
};

const sanitizeDocumentId = (value: string): string =>
  value
    .trim()
    .replace(/\//g, "_")
    .replace(/\s+/g, "-")
    .slice(0, 220);

const normalizePayoutRecord = (
  id: string,
  data: FirebaseFirestore.DocumentData
): ConciliationMarketplacePayout => ({
  id: String(data.id || id),
  marketplace: String(data.marketplace || "Sem marketplace"),
  orderKey: String(data.orderKey || ""),
  paidAt: asIsoString(data.paidAt) || (data.paidAt ? String(data.paidAt) : null),
  grossAmount: toFiniteNumber(data.grossAmount),
  feeAmount: toFiniteNumber(data.feeAmount),
  shippingAmount: toFiniteNumber(data.shippingAmount),
  netAmount: toFiniteNumber(data.netAmount),
  sourceFileName: String(data.sourceFileName || "Arquivo importado"),
  sourceRow: toFiniteNumber(data.sourceRow),
  importBatchId: data.importBatchId ? String(data.importBatchId) : null,
  importedAt: asIsoString(data.importedAt),
  importedBy: normalizeActor(data.importedBy),
});

const createAuditEvent = ({
  type,
  title,
  description,
  at,
  actor,
  details = {},
}: {
  type: ConciliationAuditEventType;
  title: string;
  description: string;
  at: string;
  actor: ConciliationActor;
  details?: ConciliationAuditEvent["details"];
}): ConciliationAuditEvent => ({
  id: `${type}-${at}-${Math.random().toString(36).slice(2, 10)}`,
  type,
  title,
  description,
  at,
  actor,
  details,
});

const normalizeAuditEvent = (value: unknown): ConciliationAuditEvent | null => {
  if (!value || typeof value !== "object") return null;
  const event = value as Partial<ConciliationAuditEvent>;
  const type = event.type;

  if (
    type !== "reconciled" &&
    type !== "unreconciled" &&
    type !== "system-status-updated" &&
    type !== "financial-adjustment-updated"
  ) {
    return null;
  }

  return {
    id: String(event.id || `${type}-${event.at || ""}`),
    type,
    title: String(event.title || "Evento de conciliação"),
    description: String(event.description || ""),
    at: asIsoString(event.at) || String(event.at || ""),
    actor: normalizeActor(event.actor),
    details:
      event.details && typeof event.details === "object"
        ? (event.details as ConciliationAuditEvent["details"])
        : {},
  };
};

const normalizeAuditHistory = (value: unknown): ConciliationAuditEvent[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map(normalizeAuditEvent)
    .filter((event): event is ConciliationAuditEvent => Boolean(event?.at))
    .sort((first, second) => new Date(second.at).getTime() - new Date(first.at).getTime());
};

const isFinancialAdjustmentFieldId = (value: unknown): value is ConciliationFinancialAdjustmentFieldId =>
  typeof value === "string" && financialAdjustmentFieldIds.has(value as ConciliationFinancialAdjustmentFieldId);

const normalizeFinancialAdjustment = (value: unknown): ConciliationFinancialAdjustment | null => {
  if (!value || typeof value !== "object") return null;
  const adjustment = value as Partial<ConciliationFinancialAdjustment>;
  const fieldId = adjustment.fieldId;

  if (!isFinancialAdjustmentFieldId(fieldId)) return null;

  const originalValue = toFiniteNumber(adjustment.originalValue);
  const adjustedValue =
    adjustment.adjustedValue === null || adjustment.adjustedValue === undefined
      ? null
      : toFiniteNumber(adjustment.adjustedValue);
  const active = Boolean(adjustment.active) && adjustedValue !== null;

  return {
    fieldId,
    label: String(adjustment.label || financialAdjustmentLabels[fieldId]),
    originalValue,
    adjustedValue: active ? adjustedValue : null,
    reason: String(adjustment.reason || ""),
    active,
    updatedAt: asIsoString(adjustment.updatedAt),
    updatedBy: normalizeActor(adjustment.updatedBy),
  };
};

const normalizeFinancialAdjustments = (value: unknown): ConciliationFinancialAdjustments => {
  if (!value || typeof value !== "object") return {};
  const entries = Object.entries(value as Record<string, unknown>);

  return entries.reduce<ConciliationFinancialAdjustments>((adjustments, [, adjustmentValue]) => {
    const adjustment = normalizeFinancialAdjustment(adjustmentValue);

    if (adjustment) {
      adjustments[adjustment.fieldId] = adjustment;
    }

    return adjustments;
  }, {});
};

const normalizeFinancialAdjustmentInput = (
  value: unknown,
  now: string,
  actor: ConciliationActor
): ConciliationFinancialAdjustment | null => {
  if (!value || typeof value !== "object") return null;
  const adjustment = value as Partial<ConciliationFinancialAdjustmentInput>;
  const fieldId = adjustment.fieldId;

  if (!isFinancialAdjustmentFieldId(fieldId)) return null;

  const originalValue = toFiniteNumber(adjustment.originalValue);
  const adjustedValue =
    adjustment.adjustedValue === null || adjustment.adjustedValue === undefined
      ? null
      : toFiniteNumber(adjustment.adjustedValue);
  const active = Boolean(adjustment.active) && adjustedValue !== null;
  const reason = String(adjustment.reason || "").trim();

  return {
    fieldId,
    label: String(adjustment.label || financialAdjustmentLabels[fieldId]),
    originalValue,
    adjustedValue: active ? adjustedValue : null,
    reason: active ? reason : "",
    active,
    updatedAt: now,
    updatedBy: actor,
  };
};

const resolveRecordStatuses = (data: FirebaseFirestore.DocumentData) => {
  const statusName = String(data.statusName || "Desconhecido");
  const automaticSystemStatus = isConciliationSystemStatus(data.automaticSystemStatus)
    ? data.automaticSystemStatus
    : resolveAutomaticSystemStatus(statusName);
  const manualSystemStatus = isConciliationSystemStatus(data.manualSystemStatus)
    ? data.manualSystemStatus
    : null;
  const systemStatus =
    manualSystemStatus || (isConciliationSystemStatus(data.systemStatus) ? data.systemStatus : automaticSystemStatus);

  return {
    automaticSystemStatus,
    manualSystemStatus,
    systemStatus,
  };
};

const normalizeRecord = (id: string, data: FirebaseFirestore.DocumentData): ConciliationRecord => {
  const { automaticSystemStatus, manualSystemStatus, systemStatus } = resolveRecordStatuses(data);

  return {
    orderId: String(data.orderId || id),
    saleOrderId: Number(data.saleOrderId || 0),
    number: typeof data.number === "number" ? data.number : data.number ? Number(data.number) : null,
    storeNumber: String(data.storeNumber || "N/A"),
    date: String(data.date || ""),
    marketplace: String(data.marketplace || "Sem marketplace"),
    statusName: String(data.statusName || "Desconhecido"),
    automaticSystemStatus,
    manualSystemStatus,
    systemStatus,
    reconciled: Boolean(data.reconciled),
    reconciledAt: asIsoString(data.reconciledAt),
    reconciledBy: normalizeActor(data.reconciledBy),
    unreconciledAt: asIsoString(data.unreconciledAt),
    unreconciledBy: normalizeActor(data.unreconciledBy),
    systemStatusUpdatedAt: asIsoString(data.systemStatusUpdatedAt),
    systemStatusUpdatedBy: normalizeActor(data.systemStatusUpdatedBy),
    updatedAt: asIsoString(data.updatedAt),
    updatedBy: normalizeActor(data.updatedBy),
    history: normalizeAuditHistory(data.history),
    snapshot: (data.snapshot || null) as ConciliationFinancialSnapshot | null,
    financialAdjustments: normalizeFinancialAdjustments(data.financialAdjustments),
  };
};

const isValidRecordInput = (value: unknown): value is ConciliationRecordInput => {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ConciliationRecordInput>;

  return Boolean(record.orderId && record.saleOrderId && record.snapshot);
};

const isValidPayoutInput = (value: unknown): value is ConciliationMarketplacePayoutInput => {
  if (!value || typeof value !== "object") return false;
  const payout = value as Partial<ConciliationMarketplacePayoutInput>;

  return Boolean(
    payout.id &&
      payout.marketplace &&
      payout.orderKey &&
      payout.sourceFileName &&
      Number.isFinite(Number(payout.netAmount))
  );
};

const normalizeManualSystemStatusInput = (value: unknown): ConciliationSystemStatus | null | undefined => {
  if (value === null || value === undefined || value === "") return null;

  return isConciliationSystemStatus(value) ? value : undefined;
};

const normalizeStatusMappings = (value: unknown): ConciliationStatusMappings => {
  if (!value || typeof value !== "object") return {};

  return Object.entries(value as Record<string, unknown>).reduce<ConciliationStatusMappings>((mappings, [key, status]) => {
    const statusName = key.trim();

    if (statusName && isConciliationSystemStatus(status)) {
      mappings[statusName] = status;
    }

    return mappings;
  }, {});
};

const normalizeStatusSettings = (data: FirebaseFirestore.DocumentData | undefined): ConciliationStatusSettings => ({
  statusMappings: normalizeStatusMappings(data?.statusMappings),
  updatedAt: asIsoString(data?.updatedAt),
  updatedBy: normalizeActor(data?.updatedBy),
});

const normalizeSummarySettings = (data: FirebaseFirestore.DocumentData | undefined): ConciliationSummarySettings => ({
  metricIds: normalizeConciliationSummaryMetricIds(data?.metricIds),
  updatedAt: asIsoString(data?.updatedAt),
  updatedBy: normalizeActor(data?.updatedBy),
});

const normalizeDivergenceSettings = (
  data: FirebaseFirestore.DocumentData | undefined
): ConciliationDivergenceSettings => ({
  ...normalizeConciliationFinancialDivergenceRules(data),
  updatedAt: asIsoString(data?.updatedAt),
  updatedBy: normalizeActor(data?.updatedBy),
});

const normalizeCalculationSettings = (
  data: FirebaseFirestore.DocumentData | undefined
): ConciliationCalculationSettings => ({
  calculations: normalizeConciliationCustomCalculations(data?.calculations),
  updatedAt: asIsoString(data?.updatedAt),
  updatedBy: normalizeActor(data?.updatedBy),
});

export async function GET(request: Request) {
  const permission = await requirePagePermission(request, "/financeiro/conciliacao");
  if (!permission.ok) return permission.response;

  try {
    const [
      snapshot,
      payoutSnapshot,
      statusSettingsSnapshot,
      summarySettingsSnapshot,
      divergenceSettingsSnapshot,
      calculationSettingsSnapshot,
    ] = await Promise.all([
      adminDb.collection(collectionName).get(),
      adminDb.collection(payoutCollectionName).get(),
      adminDb.collection(settingsCollectionName).doc(statusSettingsDocumentId).get(),
      adminDb.collection(settingsCollectionName).doc(summarySettingsDocumentId).get(),
      adminDb.collection(settingsCollectionName).doc(divergenceSettingsDocumentId).get(),
      adminDb.collection(settingsCollectionName).doc(calculationSettingsDocumentId).get(),
    ]);
    const records = snapshot.docs.map((documentSnapshot) =>
      normalizeRecord(documentSnapshot.id, documentSnapshot.data())
    );
    const payouts = payoutSnapshot.docs.map((documentSnapshot) =>
      normalizePayoutRecord(documentSnapshot.id, documentSnapshot.data())
    );
    const statusSettings = normalizeStatusSettings(statusSettingsSnapshot.data());
    const summarySettings = normalizeSummarySettings(summarySettingsSnapshot.data());
    const divergenceSettings = normalizeDivergenceSettings(divergenceSettingsSnapshot.data());
    const calculationSettings = normalizeCalculationSettings(calculationSettingsSnapshot.data());

    return NextResponse.json({
      ok: true,
      records,
      payouts,
      statusSettings,
      summarySettings,
      divergenceSettings,
      calculationSettings,
    });
  } catch (error) {
    console.error("Erro ao carregar sidecar de conciliação:", error);
    return NextResponse.json(
      { ok: false, error: "Não foi possível carregar o estado de conciliação." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const permission = await requirePagePermission(request, "/financeiro/conciliacao");
  if (!permission.ok) return permission.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido." }, { status: 400 });
  }

  const payload = body as {
    action?: unknown;
    reconciled?: unknown;
    record?: unknown;
    records?: unknown;
    payouts?: unknown;
    financialAdjustments?: unknown;
    importBatchId?: unknown;
    sourceFileName?: unknown;
    importedAt?: unknown;
    statusMappings?: unknown;
    metricIds?: unknown;
    divergenceRules?: unknown;
    calculations?: unknown;
  };
  const action =
    payload.action === "status"
      ? "status"
      : payload.action === "statusMappings"
        ? "statusMappings"
        : payload.action === "summarySettings"
          ? "summarySettings"
          : payload.action === "divergenceRules"
            ? "divergenceRules"
            : payload.action === "calculationSettings"
              ? "calculationSettings"
              : payload.action === "payoutImport"
                ? "payoutImport"
                : payload.action === "payoutImportDelete"
                  ? "payoutImportDelete"
                  : payload.action === "financialAdjustments"
                    ? "financialAdjustments"
                    : "reconciliation";

  if (action === "payoutImportDelete") {
    const importBatchId = typeof payload.importBatchId === "string" ? payload.importBatchId.trim() : "";
    const sourceFileName = typeof payload.sourceFileName === "string" ? payload.sourceFileName.trim() : "";
    const importedAt = typeof payload.importedAt === "string" ? payload.importedAt.trim() : "";

    if (!importBatchId && (!sourceFileName || !importedAt)) {
      return NextResponse.json(
        { ok: false, error: "Informe o lote ou arquivo/data da importação para desfazer." },
        { status: 400 }
      );
    }

    try {
      const collectionRef = adminDb.collection(payoutCollectionName);
      const payoutSnapshot = importBatchId
        ? await collectionRef.where("importBatchId", "==", importBatchId).get()
        : await collectionRef.where("sourceFileName", "==", sourceFileName).get();

      if (payoutSnapshot.empty) {
        return NextResponse.json({ ok: true, deletedIds: [], deletedCount: 0 });
      }

      const documentSnapshots = importBatchId
        ? payoutSnapshot.docs
        : payoutSnapshot.docs.filter((documentSnapshot) => documentSnapshot.data().importedAt === importedAt);

      for (let index = 0; index < documentSnapshots.length; index += maxBatchWrites) {
        const batch = adminDb.batch();
        const chunk = documentSnapshots.slice(index, index + maxBatchWrites);

        chunk.forEach((documentSnapshot) => {
          batch.delete(documentSnapshot.ref);
        });

        await batch.commit();
      }

      return NextResponse.json({
        ok: true,
        deletedIds: documentSnapshots.map((documentSnapshot) => documentSnapshot.id),
        deletedCount: documentSnapshots.length,
      });
    } catch (error) {
      console.error("Erro ao desfazer importação de repasses:", error);
      return NextResponse.json(
        { ok: false, error: "Não foi possível desfazer a importação de repasses." },
        { status: 500 }
      );
    }
  }

  if (action === "payoutImport") {
    const payouts = Array.isArray(payload.payouts) ? payload.payouts.filter(isValidPayoutInput) : [];

    if (payouts.length === 0) {
      return NextResponse.json({ ok: false, error: "Nenhum repasse válido informado para importação." }, { status: 400 });
    }

    if (payouts.length > maxPayoutImportRows) {
      return NextResponse.json(
        { ok: false, error: `Importe até ${maxPayoutImportRows} linhas de repasse por operação.` },
        { status: 400 }
      );
    }

    try {
      const now = new Date().toISOString();
      const actor: ConciliationActor = {
        id: permission.user.id,
        name: permission.user.name || permission.user.email,
        email: permission.user.email,
      };
      const collectionRef = adminDb.collection(payoutCollectionName);
      const importBatchId = sanitizeDocumentId(`repasse-${now}-${Math.random().toString(36).slice(2, 10)}`);
      const normalizedPayouts = payouts.map((payout, index) => ({
        id: sanitizeDocumentId(payout.id) || `repasse-${now}-${index}`,
        marketplace: String(payout.marketplace || "Sem marketplace"),
        orderKey: String(payout.orderKey || ""),
        paidAt: payout.paidAt || null,
        grossAmount: toFiniteNumber(payout.grossAmount),
        feeAmount: toFiniteNumber(payout.feeAmount),
        shippingAmount: toFiniteNumber(payout.shippingAmount),
        netAmount: toFiniteNumber(payout.netAmount),
        sourceFileName: String(payout.sourceFileName || "Arquivo importado"),
        sourceRow: toFiniteNumber(payout.sourceRow),
        importBatchId,
        importedAt: now,
        importedBy: actor,
      }));

      for (let index = 0; index < normalizedPayouts.length; index += maxBatchWrites) {
        const chunk = normalizedPayouts.slice(index, index + maxBatchWrites);
        const batch = adminDb.batch();

        chunk.forEach((payout) => {
          batch.set(collectionRef.doc(payout.id), payout, { merge: true });
        });

        await batch.commit();
      }

      return NextResponse.json({ ok: true, payouts: normalizedPayouts });
    } catch (error) {
      console.error("Erro ao importar repasses de marketplace:", error);
      return NextResponse.json(
        { ok: false, error: "Não foi possível importar os repasses de marketplace." },
        { status: 500 }
      );
    }
  }

  if (action === "divergenceRules") {
    try {
      const now = new Date().toISOString();
      const actor: ConciliationActor = {
        id: permission.user.id,
        name: permission.user.name || permission.user.email,
        email: permission.user.email,
      };
      const divergenceRules: ConciliationFinancialDivergenceRules =
        normalizeConciliationFinancialDivergenceRules(payload.divergenceRules);
      const documentRef = adminDb.collection(settingsCollectionName).doc(divergenceSettingsDocumentId);

      await documentRef.set(
        {
          ...divergenceRules,
          updatedAt: now,
          updatedBy: actor,
        },
        { merge: true }
      );

      const updatedSnapshot = await documentRef.get();
      const divergenceSettings = normalizeDivergenceSettings(updatedSnapshot.data());

      return NextResponse.json({ ok: true, divergenceSettings });
    } catch (error) {
      console.error("Erro ao salvar regras de divergência financeira:", error);
      return NextResponse.json(
        { ok: false, error: "Não foi possível salvar as regras de alerta financeiro." },
        { status: 500 }
      );
    }
  }

  if (action === "calculationSettings") {
    try {
      const now = new Date().toISOString();
      const actor: ConciliationActor = {
        id: permission.user.id,
        name: permission.user.name || permission.user.email,
        email: permission.user.email,
      };
      const calculationInputs = Array.isArray(payload.calculations)
        ? (payload.calculations as ConciliationCustomCalculationInput[])
        : [];
      const calculations = normalizeConciliationCustomCalculations(calculationInputs, now, actor);
      const documentRef = adminDb.collection(settingsCollectionName).doc(calculationSettingsDocumentId);

      await documentRef.set(
        {
          calculations,
          updatedAt: now,
          updatedBy: actor,
        },
        { merge: true }
      );

      const updatedSnapshot = await documentRef.get();
      const calculationSettings = normalizeCalculationSettings(updatedSnapshot.data());

      return NextResponse.json({ ok: true, calculationSettings });
    } catch (error) {
      console.error("Erro ao salvar colunas calculadas:", error);
      return NextResponse.json(
        { ok: false, error: "Não foi possível salvar as colunas calculadas." },
        { status: 500 }
      );
    }
  }

  if (action === "summarySettings") {
    try {
      const now = new Date().toISOString();
      const actor: ConciliationActor = {
        id: permission.user.id,
        name: permission.user.name || permission.user.email,
        email: permission.user.email,
      };
      const metricIds: ConciliationSummaryMetricId[] = normalizeConciliationSummaryMetricIds(payload.metricIds);
      const documentRef = adminDb.collection(settingsCollectionName).doc(summarySettingsDocumentId);

      await documentRef.set(
        {
          metricIds,
          updatedAt: now,
          updatedBy: actor,
        },
        { merge: true }
      );

      const updatedSnapshot = await documentRef.get();
      const summarySettings = normalizeSummarySettings(updatedSnapshot.data());

      return NextResponse.json({ ok: true, summarySettings });
    } catch (error) {
      console.error("Erro ao salvar configuração do resumo:", error);
      return NextResponse.json(
        { ok: false, error: "Não foi possível salvar a configuração do resumo." },
        { status: 500 }
      );
    }
  }

  if (action === "statusMappings") {
    try {
      const now = new Date().toISOString();
      const actor: ConciliationActor = {
        id: permission.user.id,
        name: permission.user.name || permission.user.email,
        email: permission.user.email,
      };
      const statusMappings = normalizeStatusMappings(payload.statusMappings);
      const documentRef = adminDb.collection(settingsCollectionName).doc(statusSettingsDocumentId);

      await documentRef.set(
        {
          statusMappings,
          updatedAt: now,
          updatedBy: actor,
        },
        { merge: true }
      );

      const updatedSnapshot = await documentRef.get();
      const statusSettings = normalizeStatusSettings(updatedSnapshot.data());

      return NextResponse.json({ ok: true, statusSettings });
    } catch (error) {
      console.error("Erro ao salvar mapeamento de status:", error);
      return NextResponse.json(
        { ok: false, error: "Não foi possível salvar o mapeamento de status." },
        { status: 500 }
      );
    }
  }

  if (action === "status") {
    if (!isValidRecordInput(payload.record)) {
      return NextResponse.json({ ok: false, error: "Pedido inválido para atualização de status." }, { status: 400 });
    }

    const record = payload.record;
    const manualSystemStatus = normalizeManualSystemStatusInput(record.manualSystemStatus);

    if (manualSystemStatus === undefined) {
      return NextResponse.json({ ok: false, error: "Status de sistema inválido." }, { status: 400 });
    }

    try {
      const now = new Date().toISOString();
      const actor: ConciliationActor = {
        id: permission.user.id,
        name: permission.user.name || permission.user.email,
        email: permission.user.email,
      };
      const automaticSystemStatus = isConciliationSystemStatus(record.automaticSystemStatus)
        ? record.automaticSystemStatus
        : resolveAutomaticSystemStatus(record.statusName);
      const systemStatus = manualSystemStatus ?? automaticSystemStatus;
      const collectionRef = adminDb.collection(collectionName);
      const documentRef = collectionRef.doc(record.orderId);
      const previousSnapshot = await documentRef.get();
      const previousData = previousSnapshot.data();
      const previousSystemStatus = previousData
        ? resolveRecordStatuses(previousData).systemStatus
        : automaticSystemStatus;
      const auditEvent = createAuditEvent({
        type: "system-status-updated",
        title: "Status de sistema alterado",
        description: `Status alterado de ${previousSystemStatus} para ${systemStatus}.`,
        at: now,
        actor,
        details: {
          previousSystemStatus,
          systemStatus,
          manualSystemStatus,
          automaticSystemStatus,
        },
      });

      await documentRef.set(
        {
          orderId: record.orderId,
          saleOrderId: record.saleOrderId,
          number: record.number,
          storeNumber: record.storeNumber,
          date: record.date,
          marketplace: record.marketplace,
          statusName: record.statusName,
          automaticSystemStatus,
          manualSystemStatus,
          systemStatus,
          systemStatusUpdatedAt: now,
          systemStatusUpdatedBy: actor,
          updatedAt: now,
          updatedBy: actor,
          history: FieldValue.arrayUnion(auditEvent),
          snapshot: {
            ...record.snapshot,
            automaticSystemStatus,
            manualSystemStatus,
            systemStatus,
          },
        },
        { merge: true }
      );

      const updatedSnapshot = await documentRef.get();
      const updatedRecord = normalizeRecord(updatedSnapshot.id, updatedSnapshot.data() || {});

      return NextResponse.json({ ok: true, record: updatedRecord });
    } catch (error) {
      console.error("Erro ao salvar status de conciliação:", error);
      return NextResponse.json(
        { ok: false, error: "Não foi possível salvar o status do sistema." },
        { status: 500 }
      );
    }
  }

  if (action === "financialAdjustments") {
    if (!isValidRecordInput(payload.record)) {
      return NextResponse.json({ ok: false, error: "Pedido inválido para ajuste financeiro." }, { status: 400 });
    }

    const adjustmentInputs = Array.isArray(payload.financialAdjustments) ? payload.financialAdjustments : [];

    try {
      const now = new Date().toISOString();
      const actor: ConciliationActor = {
        id: permission.user.id,
        name: permission.user.name || permission.user.email,
        email: permission.user.email,
      };
      const record = payload.record;
      const automaticSystemStatus = isConciliationSystemStatus(record.automaticSystemStatus)
        ? record.automaticSystemStatus
        : resolveAutomaticSystemStatus(record.statusName);
      const manualSystemStatus = isConciliationSystemStatus(record.manualSystemStatus)
        ? record.manualSystemStatus
        : null;
      const systemStatus = manualSystemStatus ?? automaticSystemStatus;
      const financialAdjustments = adjustmentInputs.reduce<ConciliationFinancialAdjustments>((adjustments, input) => {
        const adjustment = normalizeFinancialAdjustmentInput(input, now, actor);

        if (adjustment) {
          adjustments[adjustment.fieldId] = adjustment;
        }

        return adjustments;
      }, {});
      const activeAdjustments = Object.values(financialAdjustments).filter((adjustment) => adjustment?.active);
      const auditEvent = createAuditEvent({
        type: "financial-adjustment-updated",
        title: "Ajustes financeiros atualizados",
        description:
          activeAdjustments.length > 0
            ? `${activeAdjustments.length} campo(s) financeiro(s) com correção manual.`
            : "Correções financeiras manuais removidas.",
        at: now,
        actor,
        details: {
          activeAdjustments: activeAdjustments.length,
          fields: activeAdjustments.map((adjustment) => adjustment?.label).filter(Boolean).join(", "),
          orderNumber: record.number,
        },
      });
      const collectionRef = adminDb.collection(collectionName);
      const documentRef = collectionRef.doc(record.orderId);

      await documentRef.set(
        {
          orderId: record.orderId,
          saleOrderId: record.saleOrderId,
          number: record.number,
          storeNumber: record.storeNumber,
          date: record.date,
          marketplace: record.marketplace,
          statusName: record.statusName,
          automaticSystemStatus,
          manualSystemStatus,
          systemStatus,
          financialAdjustments,
          updatedAt: now,
          updatedBy: actor,
          history: FieldValue.arrayUnion(auditEvent),
          snapshot: {
            ...record.snapshot,
            automaticSystemStatus,
            manualSystemStatus,
            systemStatus,
          },
        },
        { merge: true }
      );

      const updatedSnapshot = await documentRef.get();
      const updatedRecord = normalizeRecord(updatedSnapshot.id, updatedSnapshot.data() || {});

      return NextResponse.json({ ok: true, record: updatedRecord });
    } catch (error) {
      console.error("Erro ao salvar ajustes financeiros:", error);
      return NextResponse.json(
        { ok: false, error: "Não foi possível salvar os ajustes financeiros." },
        { status: 500 }
      );
    }
  }

  const reconciled = payload.reconciled === true;
  const records = Array.isArray(payload.records) ? payload.records.filter(isValidRecordInput) : [];

  if (records.length === 0) {
    return NextResponse.json({ ok: false, error: "Nenhum pedido informado para conciliação." }, { status: 400 });
  }

  if (records.length > 450) {
    return NextResponse.json(
      { ok: false, error: "Selecione até 450 pedidos por operação." },
      { status: 400 }
    );
  }

  try {
    const now = new Date().toISOString();
    const actor: ConciliationActor = {
      id: permission.user.id,
      name: permission.user.name || permission.user.email,
      email: permission.user.email,
    };
    const batch = adminDb.batch();
    const collectionRef = adminDb.collection(collectionName);

    records.forEach((record) => {
      const documentRef = collectionRef.doc(record.orderId);
      const automaticSystemStatus = isConciliationSystemStatus(record.automaticSystemStatus)
        ? record.automaticSystemStatus
        : resolveAutomaticSystemStatus(record.statusName);
      const manualSystemStatus = isConciliationSystemStatus(record.manualSystemStatus)
        ? record.manualSystemStatus
        : null;
      const systemStatus = manualSystemStatus ?? automaticSystemStatus;
      const auditEvent = createAuditEvent({
        type: reconciled ? "reconciled" : "unreconciled",
        title: reconciled ? "Pedido conciliado" : "Conciliação desfeita",
        description: reconciled
          ? "Pedido marcado como conciliado com snapshot financeiro."
          : "Pedido retornou para pendente de conciliação.",
        at: now,
        actor,
        details: {
          reconciled,
          systemStatus,
          orderNumber: record.number,
        },
      });
      const data = {
        orderId: record.orderId,
        saleOrderId: record.saleOrderId,
        number: record.number,
        storeNumber: record.storeNumber,
        date: record.date,
        marketplace: record.marketplace,
        statusName: record.statusName,
        automaticSystemStatus,
        manualSystemStatus,
        systemStatus,
        reconciled,
        reconciledAt: reconciled ? now : null,
        reconciledBy: reconciled ? actor : null,
        unreconciledAt: reconciled ? null : now,
        unreconciledBy: reconciled ? null : actor,
        updatedAt: now,
        updatedBy: actor,
        history: FieldValue.arrayUnion(auditEvent),
        snapshot: {
          ...record.snapshot,
          automaticSystemStatus,
          manualSystemStatus,
          systemStatus,
        },
      };

      batch.set(documentRef, data, { merge: true });
    });

    await batch.commit();

    const updatedSnapshots = await Promise.all(
      records.map((record) => collectionRef.doc(record.orderId).get())
    );
    const updatedRecords = updatedSnapshots
      .filter((documentSnapshot) => documentSnapshot.exists)
      .map((documentSnapshot) => normalizeRecord(documentSnapshot.id, documentSnapshot.data() || {}));

    return NextResponse.json({ ok: true, records: updatedRecords });
  } catch (error) {
    console.error("Erro ao salvar sidecar de conciliação:", error);
    return NextResponse.json(
      { ok: false, error: "Não foi possível salvar a conciliação." },
      { status: 500 }
    );
  }
}
