import {
  conciliationSystemStatusOptions,
  isConciliationSystemStatus,
  type ConciliationSystemStatus,
} from "@/lib/conciliation/status";
import type {
  ConciliationActor,
  ConciliationSystemStatusDefinition,
  ConciliationSystemStatusSettings,
} from "@/types/conciliation";

export const conciliationSystemStatusColorSwatches = [
  "#64748b",
  "#2563eb",
  "#7c3aed",
  "#059669",
  "#dc2626",
  "#ea580c",
  "#d97706",
  "#0891b2",
  "#0f766e",
  "#9333ea",
  "#be123c",
  "#475569",
] as const;

const defaultColorByStatus: Record<ConciliationSystemStatus, string> = {
  Pendente: "#64748b",
  "Em Separação": "#7c3aed",
  "Em Trânsito": "#2563eb",
  Entregue: "#059669",
  Cancelado: "#dc2626",
  Devolução: "#ea580c",
  "Devolução / Reembolso Parcial": "#d97706",
  Extravio: "#0891b2",
};

const colorPattern = /^#[0-9a-f]{6}$/i;

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

const normalizeDisplayName = (value: unknown, fallback: ConciliationSystemStatus) => {
  const displayName = typeof value === "string" ? value.trim().slice(0, 80) : "";

  return displayName || fallback;
};

export const normalizeConciliationSystemStatusColor = (
  value: unknown,
  fallback: ConciliationSystemStatus
) => {
  const color = typeof value === "string" ? value.trim() : "";

  return colorPattern.test(color) ? color.toLowerCase() : defaultColorByStatus[fallback];
};

const createDefaultStatusDefinition = (
  status: ConciliationSystemStatus,
  index: number
): ConciliationSystemStatusDefinition => ({
  id: status,
  label: status,
  displayName: status,
  active: true,
  color: defaultColorByStatus[status],
  locked: true,
  order: index,
  updatedAt: null,
});

export const defaultConciliationSystemStatusSettings: ConciliationSystemStatusSettings = {
  statuses: conciliationSystemStatusOptions.map(createDefaultStatusDefinition),
  updatedAt: null,
  updatedBy: null,
};

const getDefinitionStatus = (value: unknown): ConciliationSystemStatus | null => {
  if (!value || typeof value !== "object") return null;
  const definition = value as Partial<ConciliationSystemStatusDefinition>;

  if (isConciliationSystemStatus(definition.id)) return definition.id;
  if (isConciliationSystemStatus(definition.label)) return definition.label;

  return null;
};

const normalizeDefinition = (
  source: unknown,
  status: ConciliationSystemStatus,
  index: number
): ConciliationSystemStatusDefinition => {
  if (!source || typeof source !== "object") return createDefaultStatusDefinition(status, index);
  const definition = source as Partial<ConciliationSystemStatusDefinition>;

  return {
    id: status,
    label: status,
    displayName: normalizeDisplayName(definition.displayName ?? definition.label, status),
    active: typeof definition.active === "boolean" ? definition.active : true,
    color: normalizeConciliationSystemStatusColor(definition.color, status),
    locked: true,
    order: index,
    updatedAt: asIsoString(definition.updatedAt),
  };
};

export const normalizeConciliationSystemStatusSettings = (
  value: unknown
): ConciliationSystemStatusSettings => {
  const source = value && typeof value === "object" ? (value as Partial<ConciliationSystemStatusSettings>) : {};
  const rawStatuses = Array.isArray(source.statuses) ? source.statuses : [];
  const statusSources = new Map<ConciliationSystemStatus, unknown>();

  rawStatuses.forEach((rawStatus) => {
    const status = getDefinitionStatus(rawStatus);

    if (status && !statusSources.has(status)) {
      statusSources.set(status, rawStatus);
    }
  });

  return {
    statuses: conciliationSystemStatusOptions.map((status, index) =>
      normalizeDefinition(statusSources.get(status), status, index)
    ),
    updatedAt: asIsoString(source.updatedAt),
    updatedBy: normalizeActor(source.updatedBy),
  };
};

export const serializeConciliationSystemStatusSettings = (
  settings: ConciliationSystemStatusSettings
) =>
  JSON.stringify(
    normalizeConciliationSystemStatusSettings(settings).statuses.map((definition) => ({
      id: definition.id,
      displayName: definition.displayName,
      active: definition.active,
      color: definition.color,
    }))
  );

export const getConciliationSystemStatusDefinition = (
  settings: ConciliationSystemStatusSettings | null | undefined,
  status: ConciliationSystemStatus
): ConciliationSystemStatusDefinition =>
  normalizeConciliationSystemStatusSettings(settings).statuses.find((definition) => definition.id === status) ??
  createDefaultStatusDefinition(status, conciliationSystemStatusOptions.indexOf(status));

export const getConciliationSystemStatusDisplayName = (
  settings: ConciliationSystemStatusSettings | null | undefined,
  status: ConciliationSystemStatus
) => getConciliationSystemStatusDefinition(settings, status).displayName;

export const getConciliationSystemStatusPresentation = (
  settings: ConciliationSystemStatusSettings | null | undefined,
  status: ConciliationSystemStatus
) => {
  const definition = getConciliationSystemStatusDefinition(settings, status);
  const color = definition.color;

  return {
    ...definition,
    style: {
      borderColor: `${color}33`,
      backgroundColor: definition.active ? `${color}14` : "#f4f4f5",
      color: definition.active ? color : "#71717a",
    },
  };
};
