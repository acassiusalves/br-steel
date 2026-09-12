import type { ProductionOrder, ProductionRecord, ProductionView } from './production-contract';

/** Shared by the Firestore projection and the SQL projection builder. */
export const productionFields = {
  columns: ['name', 'order', 'color', 'createdAt', 'updatedAt'],
  lots: ['lotNumber', 'title', 'description', 'columnId', 'columnOrder', 'assignedTo', 'priority', 'linkedOrderIds', 'totalItems', 'totalSkus', 'dueDate', 'createdAt', 'updatedAt', 'createdBy'],
  items: ['lotId', 'sku', 'productName', 'quantity', 'unit', 'sourceOrderId', 'sourceOrderNumber', 'createdAt'],
  comments: ['lotId', 'content', 'author', 'createdAt', 'updatedAt'],
} as const;
export const productionIdentityFields = {
  assignedTo: ['userId', 'userName', 'assignedAt'],
  createdBy: ['userId', 'userName'],
  author: ['userId', 'userName'],
} as const;
export const productionOrderItemFields = ['codigo', 'descricao', 'quantidade'] as const;

function pick(data: Record<string, unknown>, fields: readonly string[]) {
  return Object.fromEntries(fields.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
}

export function projectProductionRecord(id: string, data: Record<string, unknown>, view: ProductionView): ProductionRecord {
  if (view === 'orders') return projectProductionOrder(id, data);
  const projected: ProductionRecord = { id, ...pick(data, productionFields[view]) };
  if (view === 'items') projected.customerName = '';
  for (const key of Object.keys(productionIdentityFields) as (keyof typeof productionIdentityFields)[]) {
    if (projected[key]) projected[key] = pick(projected[key] as Record<string, unknown>, productionIdentityFields[key]);
  }
  return projected;
}

export function projectProductionOrder(id: string, data: Record<string, unknown>): ProductionOrder {
  return {
    id, ...pick(data, ['numero']),
    itens: (Array.isArray(data.itens) ? data.itens : []).map((item: Record<string, unknown>, index: number) => ({
      id: item.id ?? index, ...pick(item, productionOrderItemFields), unidade: item.unidade || 'UN',
    })),
  };
}
