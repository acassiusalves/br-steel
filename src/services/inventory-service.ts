"use client";
import { fetchOperation, fetchAllOperationPages, subscribeOperation, notifyOperationsChanged } from '@/lib/operation-client';
import type { InventoryItem, InventoryMovement } from '@/types/inventory';
import type { Supply } from '@/types/supply';
export function inventoryItem(supply: Supply): InventoryItem {
  const estoqueAtual = supply.estoqueAtual ?? 0;
  return { supply, estoqueAtual, estoqueMinimo: supply.estoqueMinimo,
    valorEmEstoque: Math.max(0, estoqueAtual) * supply.precoCusto,
    status: estoqueAtual <= 0 ? 'esgotado' : estoqueAtual < supply.estoqueMinimo ? 'baixo' : 'em_estoque' };
}
export async function getInventory(callback: (data: InventoryItem[]) => void) {
  return subscribeOperation(() => fetchAllOperationPages<Supply>('/api/operations/supplies'), response => callback(response.map(inventoryItem)), () => callback([]));
}
export async function addInventoryMovement(data: Omit<InventoryMovement, 'id' | 'createdAt'>) {
  const response = await fetchOperation<{ id: string; newStock: number }>('/api/operations/supplies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'movement', data }) });
  notifyOperationsChanged(); return response;
}
