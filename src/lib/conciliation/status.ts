export const conciliationSystemStatusOptions = [
  "Pendente",
  "Em Separação",
  "Em Trânsito",
  "Entregue",
  "Cancelado",
  "Devolução",
  "Devolução / Reembolso Parcial",
  "Extravio",
] as const;

export type ConciliationSystemStatus = (typeof conciliationSystemStatusOptions)[number];

const normalizedStatusOptions = new Set<string>(conciliationSystemStatusOptions);

export const isConciliationSystemStatus = (value: unknown): value is ConciliationSystemStatus =>
  typeof value === "string" && normalizedStatusOptions.has(value);

const normalizeStatusText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export const resolveAutomaticSystemStatus = (statusName: string): ConciliationSystemStatus => {
  const normalized = normalizeStatusText(statusName);

  if (normalized.includes("cancel")) return "Cancelado";
  if (normalized.includes("reembolso") && normalized.includes("parcial")) return "Devolução / Reembolso Parcial";
  if (normalized.includes("devol") || normalized.includes("reembolso")) return "Devolução";
  if (normalized.includes("extrav") || normalized.includes("perdid")) return "Extravio";
  if (
    normalized.includes("entreg") ||
    normalized.includes("conclu") ||
    normalized.includes("atendid") ||
    normalized.includes("finaliz")
  ) {
    return "Entregue";
  }
  if (normalized.includes("envi") || normalized.includes("transit")) return "Em Trânsito";
  if (normalized.includes("separ") || normalized.includes("prepar")) return "Em Separação";

  return "Pendente";
};
