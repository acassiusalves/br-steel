"use client";

// Camada client da página de planilhas: chamadas à API /api/financeiro/planilhas.

import type {
  ConciliationImportCategory,
  ConciliationImportFileRecord,
  ConciliationImportTemplate,
  ConciliationSheetAssociation,
} from "@/types/conciliation-planilhas";

const endpoint = "/api/financeiro/planilhas";

const requestJson = async <T>(init?: RequestInit, query = ""): Promise<T> => {
  const response = await fetch(`${endpoint}${query}`, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "Não foi possível completar a operação de planilhas.");
  }

  return data as T;
};

const patch = <T>(body: Record<string, unknown>): Promise<T> =>
  requestJson<T>({ method: "PATCH", body: JSON.stringify(body) });

export const fetchPlanilhasState = () =>
  requestJson<{
    files: ConciliationImportFileRecord[];
    categories: ConciliationImportCategory[];
    templates: ConciliationImportTemplate[];
  }>();

export const fetchSheetAssociations = (months: string[]) =>
  requestJson<{ associations: ConciliationSheetAssociation[] }>(
    undefined,
    `?months=${encodeURIComponent(months.join(","))}`
  ).then((data) => data.associations);

export const createImportFile = (record: Partial<ConciliationImportFileRecord>) =>
  patch<{ fileId: string; record: ConciliationImportFileRecord }>({ action: "createImportFile", record });

export const saveImportAssociations = async (
  fileId: string,
  associations: Omit<ConciliationSheetAssociation, "id">[],
  onProgress?: (saved: number, total: number) => void
) => {
  const chunkSize = 400;
  let saved = 0;

  for (let index = 0; index < associations.length; index += chunkSize) {
    const chunk = associations.slice(index, index + chunkSize);

    await patch({ action: "saveAssociations", fileId, associations: chunk });
    saved += chunk.length;
    onProgress?.(saved, associations.length);
  }

  return saved;
};

export const finalizeImport = (
  fileId: string,
  updates: Partial<ConciliationImportFileRecord>,
  templateId?: string | null
) =>
  patch<{ record: ConciliationImportFileRecord }>({
    action: "finalizeImport",
    fileId,
    updates,
    templateId: templateId ?? null,
  });

export const deleteImport = (fileId: string) =>
  patch<{ deletedAssociations: number }>({ action: "deleteImport", fileId });

export const fetchExistingAssociationsForMonths = (months: string[]) =>
  patch<{ associations: ConciliationSheetAssociation[] }>({ action: "checkConflicts", months }).then(
    (data) => data.associations
  );

export const savePlanilhaCategory = (category: Partial<ConciliationImportCategory>) =>
  patch<{ category: ConciliationImportCategory }>({ action: "saveCategory", category });

export const deletePlanilhaCategory = (categoryId: string) =>
  patch<Record<string, never>>({ action: "deleteCategory", categoryId });

export const savePlanilhaTemplate = (template: Partial<ConciliationImportTemplate>) =>
  patch<{ template: ConciliationImportTemplate }>({ action: "saveTemplate", template });

export const deletePlanilhaTemplate = (templateId: string) =>
  patch<Record<string, never>>({ action: "deleteTemplate", templateId });
