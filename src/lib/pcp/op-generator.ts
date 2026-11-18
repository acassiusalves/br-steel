/**
 * Regras do gerador de ordens de produção (OP), sem acesso a banco.
 *
 * Regra da fila da fábrica (chamado nº 1, de 16/11/2026), sobre os SKUs da linha oficial. A posição é o
 * saldo do depósito Estoque somado ao que já está em OP aberta:
 * 1. zerados (saldo ≤ 0, posição no mínimo ou abaixo), do mais vendido para o menos vendido;
 * 2. abaixo do mínimo (posição no mínimo ou abaixo), do mais vendido para o menos vendido;
 * 3. só quando não há nenhum zerado: acima do mínimo e abaixo do máximo, do mais vendido para o menos.
 * A quantidade da OP é a média de venda semanal (NF-e de saída do período, padrão 90 dias) vezes o fator
 * de margem do tipo de OP, arredondada para cima.
 */

export type OrderKind = 'semanal' | 'corte';

/** Um SKU da linha oficial com o que o gerador precisa saber. Saldo e limites vêm do Bling. */
export type PlanningRow = {
  sku: string; description?: string | null; totalQuantitySold: number; weeklyAverage: number;
  /** Saldo do depósito Estoque no Bling; null quando não foi lido. */
  stockLevel: number | null; stockMin: number | null; stockMax: number | null;
  /** Quantidade já em OP aberta deste SKU no BR Steel (evita OP duplicada). */
  openQuantity: number;
};

export type SheetOption = { id: string; code: string; sku: string; name: string; stepCount: number };

export type OrderSuggestion = {
  sku: string; description: string; stock: number; min: number; max: number; sold: number; weeklyAverage: number;
  openQuantity: number;
  /** Quantidade da política mín/máx antiga (máx − saldo − em OP), só como referência. */
  minMaxQuantity: number;
  /** Faixa da fila: zerado, abaixo do mínimo ou entre o mínimo e o máximo. */
  tier: QueueTier;
  sheet: SheetOption | null; quantity: number;
};

/**
 * Q da política mín/máx: se saldo + em OP ≤ mínimo, Q = máximo − saldo − em OP; senão 0. Null quando
 * faltam saldo ou limites: sem esses dados o SKU não é dimensionado, nunca recebe número inventado.
 */
export function minMaxQuantity(row: PlanningRow): number | null {
  if (row.stockLevel === null || row.stockMin === null || row.stockMax === null) return null;
  const position = row.stockLevel + row.openQuantity;
  if (position > row.stockMin) return 0;
  return Math.max(0, Math.ceil(row.stockMax - position - 1e-9));
}

export type QueueTier = 'zerado' | 'abaixo_minimo' | 'entre_min_max';
const TIER_ORDER: Record<QueueTier, number> = { zerado: 0, abaixo_minimo: 1, entre_min_max: 2 };

/** Faixa do SKU na fila, pela posição (saldo + em OP); null quando está no máximo ou acima, ou sem dados. */
export function queueTier(row: PlanningRow): QueueTier | null {
  if (row.stockLevel === null || row.stockMin === null || row.stockMax === null) return null;
  const position = row.stockLevel + row.openQuantity;
  if (position > row.stockMin) return position < row.stockMax ? 'entre_min_max' : null;
  return row.stockLevel <= 0 ? 'zerado' : 'abaixo_minimo';
}

/** Itens que entram na fila, na ordem de prioridade: faixa, depois do mais vendido para o menos vendido. */
export function productionQueue<T extends PlanningRow>(rows: readonly T[]): (T & { tier: QueueTier })[] {
  const tiered = rows.flatMap(row => { const tier = queueTier(row); return tier ? [{ ...row, tier }] : []; });
  // Os itens entre o mínimo e o máximo só entram quando não há nenhum zerado.
  const hasZero = tiered.some(row => row.tier === 'zerado');
  return tiered.filter(row => row.tier !== 'entre_min_max' || !hasZero)
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.totalQuantitySold - a.totalQuantitySold || a.sku.localeCompare(b.sku));
}

/**
 * Um SKU pode ter mais de uma ficha no iApp (versões ou duplicatas). Vale a de roteiro mais completo;
 * no empate, o menor código, que é a ficha mais antiga.
 */
export function pickSheet(options: readonly SheetOption[]): SheetOption | null {
  const usable = options.filter(option => option.stepCount > 0);
  if (!usable.length) return null;
  return [...usable].sort((a, b) => b.stepCount - a.stepCount || a.code.localeCompare(b.code))[0];
}

/**
 * Quantidade da OP: a média de venda semanal vezes a margem do tipo, arredondada para cima. Na produção
 * semanal a margem é 1; no corte é o pulmão de peças cortadas que a fábrica mantém sobre a dobra. Sem
 * venda no período, a quantidade é 0 e o item não vira OP.
 */
export function suggestedQuantity(row: PlanningRow, factor: number): number {
  const q = row.weeklyAverage * factor;
  return q > 0 ? Math.max(1, Math.ceil(q - 1e-9)) : 0;
}

/**
 * Margem por tipo de OP. O corte corta mais do que a dobra executa (2,2 ÷ 1,5 nos fatores que a fábrica
 * usava, cerca de 47% a mais), para ter peças cortadas à mão quando surge venda fora da curva.
 */
export const DEFAULT_FACTORS: Record<OrderKind, number> = { semanal: 1, corte: 1.47 };

export function suggestOrders(rows: readonly PlanningRow[], sheetsBySku: ReadonlyMap<string, readonly SheetOption[]>,
  factor: number): OrderSuggestion[] {
  return productionQueue(rows).flatMap(row => {
    const quantity = suggestedQuantity(row, factor);
    return quantity > 0 ? [{
      sku: row.sku, description: row.description ?? row.sku, stock: row.stockLevel ?? 0, min: row.stockMin ?? 0,
      max: row.stockMax ?? 0, sold: row.totalQuantitySold, weeklyAverage: row.weeklyAverage, openQuantity: row.openQuantity,
      minMaxQuantity: minMaxQuantity(row) ?? 0, tier: row.tier, sheet: pickSheet(sheetsBySku.get(row.sku) ?? []), quantity,
    }] : [];
  });
}

export type SheetStepRef = { id: string; operationId: string; predecessorOperationId: string | null };

/**
 * Ordens de serviço de uma OP, na ordem do roteiro. Quando a ficha não define a predecessora (a
 * maioria no iApp), vale o passo anterior: o card não pode pular etapa.
 */
export function orderStepsFromRoute(route: readonly SheetStepRef[]): { operationId: string; position: number; predecessorOperationId: string | null }[] {
  const inRoute = new Set(route.map(step => step.operationId));
  return route.map((step, position) => ({
    operationId: step.operationId, position,
    predecessorOperationId: step.predecessorOperationId && inRoute.has(step.predecessorOperationId)
      ? step.predecessorOperationId : position > 0 ? route[position - 1].operationId : null,
  }));
}

/** Quantidade de uma parte para a OP mãe, considerando a quantidade base da ficha. */
export function componentQuantity(parentQuantity: number, componentPerBase: number, baseQuantity: number): number {
  return Math.round((parentQuantity * componentPerBase / (baseQuantity || 1)) * 100000) / 100000;
}

export const IAPP_HEADER = ['IDENTIFICAÇÃO DA FICHA', 'QUANTIDADE', 'LOTE ANTECIPADO', 'MULTI-NÍVEIS', 'EMPENHAR'] as const;

/**
 * Linhas da planilha de importação de OP do iApp (modelo baixado em /importador/download?planilha=op).
 * Corte vai com multinível "S", para o iApp gerar as OPs das partes; a produção semanal vai com "N",
 * salvo a OP de pedido que tem partes no corte (`multilevel`).
 */
export function iappImportRows(orders: readonly { sheetCode: string; quantity: number; kind: OrderKind; multilevel?: boolean }[]): (string | number)[][] {
  return orders.map(order => [order.sheetCode, order.quantity, '', order.kind === 'corte' || order.multilevel ? 'S' : 'N', 'N']);
}
