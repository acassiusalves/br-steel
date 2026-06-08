"use client";

// Camada client da conciliação: listener Firestore (client SDK) e chamadas
// à API route /api/financeiro/conciliacao. A lógica pura de transformação
// vive em @/lib/conciliation/orders e é re-exportada aqui por conveniência.

import { collection, onSnapshot, orderBy, query } from "firebase/firestore";

import { db } from "@/lib/firebase";
import type { ConciliationSystemStatus } from "@/lib/conciliation/status";
import type { ConciliationFinancialDivergenceRules } from "@/lib/conciliation/divergences";
import { normalizeConciliationCustomCalculations } from "@/lib/conciliation/calculations";
import {
  buildConciliationSnapshot,
  emptyConciliationAccountSettings,
  emptyConciliationCalculationSettings,
  emptyConciliationDivergenceSettings,
  emptyConciliationStatusSettings,
  emptyConciliationSystemStatusSettings,
  emptyConciliationSummarySettings,
  normalizeSaleOrderForConciliation,
} from "@/lib/conciliation/orders";
import { normalizeConciliationSystemStatusSettings } from "@/lib/conciliation/system-status-settings";
import type {
  ConciliationAccountMappings,
  ConciliationAccountSettings,
  ConciliationCalculationSettings,
  ConciliationCustomCalculationInput,
  ConciliationDivergenceSettings,
  ConciliationFinancialAdjustmentInput,
  ConciliationMarketplacePayout,
  ConciliationMarketplacePayoutInput,
  ConciliationOrder,
  ConciliationRecord,
  ConciliationRecordInput,
  ConciliationSummarySettings,
  ConciliationStatusMappings,
  ConciliationStatusSettings,
  ConciliationSystemStatusSettings,
} from "@/types/conciliation";
import type { SaleOrder } from "@/types/sale-order";

// Re-export da lógica pura para manter compatibilidade com consumidores
// existentes (ConciliacaoClient importa tudo deste módulo).
export {
  applyAccountMappings,
  applyConciliationRecords,
  applyCustomCalculationsToOrders,
  applySheetAssociationsToOrders,
  applyFinancialDivergenceRules,
  applyMarketplacePayouts,
  applyStatusMappings,
  buildConciliationSnapshot,
  calculateConciliationSummary,
  getConciliationMarketplaceName,
  normalizeConciliationPayoutOrderKey,
  normalizeSaleOrderForConciliation,
} from "@/lib/conciliation/orders";

export const subscribeConciliationOrders = (
  onData: (orders: ConciliationOrder[]) => void,
  onError: (error: Error) => void
) => {
  const ordersCollection = collection(db, "salesOrders");
  const ordersQuery = query(ordersCollection, orderBy("data", "desc"));

  return onSnapshot(
    ordersQuery,
    (snapshot) => {
      const orders = snapshot.docs.map((documentSnapshot) =>
        normalizeSaleOrderForConciliation(documentSnapshot.data() as SaleOrder)
      );

      onData(orders);
    },
    (error) => onError(error)
  );
};

export const fetchConciliationRecords = async (): Promise<Map<string, ConciliationRecord>> => {
  const state = await fetchConciliationState();

  return state.records;
};

export const fetchConciliationState = async (): Promise<{
  records: Map<string, ConciliationRecord>;
  payouts: ConciliationMarketplacePayout[];
  accountSettings: ConciliationAccountSettings;
  statusSettings: ConciliationStatusSettings;
  systemStatusSettings: ConciliationSystemStatusSettings;
  summarySettings: ConciliationSummarySettings;
  divergenceSettings: ConciliationDivergenceSettings;
  calculationSettings: ConciliationCalculationSettings;
}> => {
  let response = await fetch("/api/financeiro/conciliacao", {
    cache: "no-store",
  });

  // A sessão (cookie HttpOnly) pode ainda não estar disponível logo após o
  // mount/login. Em caso de 401, aguarda brevemente e tenta mais uma vez
  // antes de propagar o erro.
  if (response.status === 401) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    response = await fetch("/api/financeiro/conciliacao", {
      cache: "no-store",
    });
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok) {
    if (response.status === 401) {
      throw new Error("Sessão expirada ou não autenticada. Faça login novamente para carregar as marcações.");
    }

    throw new Error(data?.error || "Não foi possível carregar o estado de conciliação.");
  }

  return {
    records: new Map(
      ((data.records || []) as ConciliationRecord[]).map((record) => [record.orderId, record])
    ),
    payouts: (data.payouts || []) as ConciliationMarketplacePayout[],
    accountSettings: (data.accountSettings || emptyConciliationAccountSettings) as ConciliationAccountSettings,
    statusSettings: (data.statusSettings || emptyConciliationStatusSettings) as ConciliationStatusSettings,
    systemStatusSettings: normalizeConciliationSystemStatusSettings(
      data.systemStatusSettings || emptyConciliationSystemStatusSettings
    ),
    summarySettings: (data.summarySettings || emptyConciliationSummarySettings) as ConciliationSummarySettings,
    divergenceSettings: (data.divergenceSettings || emptyConciliationDivergenceSettings) as ConciliationDivergenceSettings,
    calculationSettings: {
      ...emptyConciliationCalculationSettings,
      ...(data.calculationSettings || {}),
      calculations: normalizeConciliationCustomCalculations(data.calculationSettings?.calculations),
    },
  };
};

export const saveConciliationAccountMappings = async (
  accountMappings: ConciliationAccountMappings
): Promise<ConciliationAccountSettings> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "accountMappings",
      accountMappings,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok || !data?.accountSettings) {
    throw new Error(data?.error || "Não foi possível salvar o mapeamento de contas.");
  }

  return data.accountSettings as ConciliationAccountSettings;
};

export const saveConciliationMarketplacePayouts = async (
  payouts: ConciliationMarketplacePayoutInput[]
): Promise<ConciliationMarketplacePayout[]> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "payoutImport",
      payouts,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok || !Array.isArray(data?.payouts)) {
    throw new Error(data?.error || "Não foi possível importar os repasses.");
  }

  return data.payouts as ConciliationMarketplacePayout[];
};

export const deleteConciliationMarketplacePayoutImport = async ({
  importBatchId,
  sourceFileName,
  importedAt,
}: {
  importBatchId: string | null;
  sourceFileName: string;
  importedAt: string | null;
}): Promise<string[]> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "payoutImportDelete",
      importBatchId,
      sourceFileName,
      importedAt,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok || !Array.isArray(data?.deletedIds)) {
    throw new Error(data?.error || "Não foi possível desfazer a importação de repasses.");
  }

  return data.deletedIds as string[];
};

export const saveConciliationRecords = async (
  orders: ConciliationOrder[],
  reconciled: boolean
): Promise<Map<string, ConciliationRecord>> => {
  const records: ConciliationRecordInput[] = orders.map((order) => ({
    orderId: order.id,
    saleOrderId: order.orderId,
    number: order.number,
    storeNumber: order.storeNumber,
    date: order.date,
    marketplace: order.marketplace,
    statusName: order.statusName,
    automaticSystemStatus: order.automaticSystemStatus,
    manualSystemStatus: order.manualSystemStatus,
    systemStatus: order.systemStatus,
    snapshot: buildConciliationSnapshot(order),
  }));

  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reconciled, records }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "Não foi possível salvar a conciliação.");
  }

  return new Map(
    ((data.records || []) as ConciliationRecord[]).map((record) => [record.orderId, record])
  );
};

export const saveConciliationSystemStatus = async (
  order: ConciliationOrder,
  manualSystemStatus: ConciliationSystemStatus | null
): Promise<ConciliationRecord> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "status",
      record: {
        orderId: order.id,
        saleOrderId: order.orderId,
        number: order.number,
        storeNumber: order.storeNumber,
        date: order.date,
        marketplace: order.marketplace,
        statusName: order.statusName,
        automaticSystemStatus: order.automaticSystemStatus,
        manualSystemStatus,
        systemStatus: manualSystemStatus ?? order.automaticSystemStatus,
        snapshot: buildConciliationSnapshot({
          ...order,
          manualSystemStatus,
          systemStatus: manualSystemStatus ?? order.automaticSystemStatus,
        }),
      },
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok || !data?.record) {
    throw new Error(data?.error || "Não foi possível salvar o status do sistema.");
  }

  return data.record as ConciliationRecord;
};

export const saveConciliationFinancialAdjustments = async (
  order: ConciliationOrder,
  financialAdjustments: ConciliationFinancialAdjustmentInput[]
): Promise<ConciliationRecord> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "financialAdjustments",
      record: {
        orderId: order.id,
        saleOrderId: order.orderId,
        number: order.number,
        storeNumber: order.storeNumber,
        date: order.date,
        marketplace: order.marketplace,
        statusName: order.statusName,
        automaticSystemStatus: order.automaticSystemStatus,
        manualSystemStatus: order.manualSystemStatus,
        systemStatus: order.systemStatus,
        snapshot: buildConciliationSnapshot(order),
      },
      financialAdjustments,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok || !data?.record) {
    throw new Error(data?.error || "Não foi possível salvar os ajustes financeiros.");
  }

  return data.record as ConciliationRecord;
};

export const saveConciliationStatusMappings = async (
  statusMappings: ConciliationStatusMappings
): Promise<ConciliationStatusSettings> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "statusMappings",
      statusMappings,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok || !data?.statusSettings) {
    throw new Error(data?.error || "Não foi possível salvar o mapeamento de status.");
  }

  return data.statusSettings as ConciliationStatusSettings;
};

export const saveConciliationSystemStatusSettings = async (
  systemStatusSettings: ConciliationSystemStatusSettings
): Promise<ConciliationSystemStatusSettings> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "systemStatusSettings",
      systemStatusSettings,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok || !data?.systemStatusSettings) {
    throw new Error(data?.error || "Não foi possível salvar os status do sistema.");
  }

  return normalizeConciliationSystemStatusSettings(data.systemStatusSettings);
};

export const saveConciliationSummarySettings = async (
  metricIds: ConciliationSummarySettings["metricIds"]
): Promise<ConciliationSummarySettings> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "summarySettings",
      metricIds,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok || !data?.summarySettings) {
    throw new Error(data?.error || "Não foi possível salvar a configuração do resumo.");
  }

  return data.summarySettings as ConciliationSummarySettings;
};

export const saveConciliationDivergenceSettings = async (
  divergenceRules: ConciliationFinancialDivergenceRules
): Promise<ConciliationDivergenceSettings> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "divergenceRules",
      divergenceRules,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok || !data?.divergenceSettings) {
    throw new Error(data?.error || "Não foi possível salvar as regras de alerta financeiro.");
  }

  return data.divergenceSettings as ConciliationDivergenceSettings;
};

export const saveConciliationCalculationSettings = async (
  calculations: ConciliationCustomCalculationInput[]
): Promise<ConciliationCalculationSettings> => {
  const response = await fetch("/api/financeiro/conciliacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "calculationSettings",
      calculations,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok || !data?.calculationSettings) {
    throw new Error(data?.error || "Não foi possível salvar as colunas calculadas.");
  }

  return {
    ...(data.calculationSettings as ConciliationCalculationSettings),
    calculations: normalizeConciliationCustomCalculations(data.calculationSettings.calculations),
  };
};
