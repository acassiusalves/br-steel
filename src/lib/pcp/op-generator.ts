/**
 * Regras do gerador de ordens de produção (OP), sem acesso a banco.
 *
 * Política mín/máx do script de OP da fábrica (padrão decidido em 25/09/2026): entra na fila o SKU da
 * linha oficial cujo saldo no depósito Estoque, somado ao que já está em OP aberta, está no mínimo ou
 * abaixo dele; a OP leva a posição até o máximo (Q = máx − saldo − em OP). Ordem da fila: primeiro os
 * zerados (por quantidade vendida), depois o maior déficit, depois os mais vendidos.
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
  /** Quantidade da política mín/máx, antes da margem do tipo de OP. */
  minMaxQuantity: number;
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

/** Itens que precisam de produção, na ordem de prioridade da fila. */
export function productionQueue<T extends PlanningRow>(rows: readonly T[]): T[] {
  return rows
    .filter(row => (minMaxQuantity(row) ?? 0) > 0)
    .sort((a, b) => {
      const aStock = a.stockLevel ?? 0, bStock = b.stockLevel ?? 0;
      const aZero = aStock <= 0, bZero = bStock <= 0;
      if (aZero && bZero) return b.totalQuantitySold - a.totalQuantitySold;
      if (aZero !== bZero) return aZero ? -1 : 1;
      const aDeficit = (a.stockMin ?? 0) - aStock, bDeficit = (b.stockMin ?? 0) - bStock;
      if (aDeficit !== bDeficit) return bDeficit - aDeficit;
      return b.totalQuantitySold - a.totalQuantitySold;
    });
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
 * Quantidade da OP: o Q do mín/máx vezes a margem do tipo, arredondado para cima. Na produção semanal a
 * margem é 1 (Q puro); no corte é o pulmão de peças cortadas que a fábrica mantém sobre a dobra.
 */
export function suggestedQuantity(row: PlanningRow, factor: number): number {
  const q = minMaxQuantity(row) ?? 0;
  return q > 0 ? Math.max(1, Math.ceil(q * factor - 1e-9)) : 0;
}

/**
 * Margem por tipo de OP. O corte corta mais do que a dobra executa (2,2 ÷ 1,5 nos fatores que a fábrica
 * usava, cerca de 47% a mais), para ter peças cortadas à mão quando surge venda fora da curva.
 */
export const DEFAULT_FACTORS: Record<OrderKind, number> = { semanal: 1, corte: 1.47 };

export function suggestOrders(rows: readonly PlanningRow[], sheetsBySku: ReadonlyMap<string, readonly SheetOption[]>,
  factor: number): OrderSuggestion[] {
  return productionQueue(rows).map(row => ({
    sku: row.sku, description: row.description ?? row.sku, stock: row.stockLevel ?? 0, min: row.stockMin ?? 0,
    max: row.stockMax ?? 0, sold: row.totalQuantitySold, weeklyAverage: row.weeklyAverage, openQuantity: row.openQuantity,
    minMaxQuantity: minMaxQuantity(row) ?? 0, sheet: pickSheet(sheetsBySku.get(row.sku) ?? []), quantity: suggestedQuantity(row, factor),
  }));
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
