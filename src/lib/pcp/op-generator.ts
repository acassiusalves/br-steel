/**
 * Regras do gerador de ordens de produção (OP), sem acesso a banco.
 *
 * A fila segue a "Fila de Produção" da tela /producao: entra quem está abaixo do mínimo e não está
 * acima do máximo; primeiro os zerados (por quantidade vendida), depois o maior déficit, depois os
 * mais vendidos. É a mesma regra do script de OPs apresentado na reunião de 10/11/2026.
 */

export type OrderKind = 'semanal' | 'corte';

export type DemandRow = {
  sku: string; description?: string | null; totalQuantitySold: number; weeklyAverage: number;
  stockLevel?: number | null; stockMin?: number; stockMax?: number;
};

export type SheetOption = { id: string; code: string; sku: string; name: string; stepCount: number };

export type OrderSuggestion = {
  sku: string; description: string; stock: number; min: number; max: number; sold: number; weeklyAverage: number;
  sheet: SheetOption | null; quantity: number;
};

/** Itens que precisam de produção, na ordem de prioridade da fila. */
export function productionQueue<T extends DemandRow>(demand: readonly T[]): T[] {
  return demand
    .filter(item => item.stockLevel != null && item.stockMin !== undefined && item.stockMax !== undefined
      && item.stockLevel < item.stockMin && item.stockLevel <= item.stockMax)
    .sort((a, b) => {
      const aStock = a.stockLevel ?? 0, bStock = b.stockLevel ?? 0;
      const aZero = aStock === 0, bZero = bStock === 0;
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
 * Quantidade sugerida: a média semanal vezes o fator do tipo de produção, sem ficar abaixo do que
 * falta para chegar ao estoque mínimo. Sempre ao menos 1, porque o item já está na fila.
 */
export function suggestedQuantity(row: DemandRow, factor: number): number {
  const byAverage = Math.floor(row.weeklyAverage * factor);
  const deficit = Math.ceil((row.stockMin ?? 0) - (row.stockLevel ?? 0));
  return Math.max(1, byAverage, deficit);
}

export const DEFAULT_FACTORS: Record<OrderKind, number> = { semanal: 1.5, corte: 2 };

export function suggestOrders(demand: readonly DemandRow[], sheetsBySku: ReadonlyMap<string, readonly SheetOption[]>,
  factor: number): OrderSuggestion[] {
  return productionQueue(demand).map(row => ({
    sku: row.sku, description: row.description ?? row.sku, stock: row.stockLevel ?? 0, min: row.stockMin ?? 0,
    max: row.stockMax ?? 0, sold: row.totalQuantitySold, weeklyAverage: row.weeklyAverage,
    sheet: pickSheet(sheetsBySku.get(row.sku) ?? []), quantity: suggestedQuantity(row, factor),
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
 * Corte vai com multinível "S", para o iApp gerar as OPs das partes; a produção semanal vai com "N".
 */
export function iappImportRows(orders: readonly { sheetCode: string; quantity: number; kind: OrderKind }[]): (string | number)[][] {
  return orders.map(order => [order.sheetCode, order.quantity, '', order.kind === 'corte' ? 'S' : 'N', 'N']);
}
