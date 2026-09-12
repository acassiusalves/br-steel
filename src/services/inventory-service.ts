"use client";
import { fetchOperation, fetchAllOperationPages, subscribeOperation, notifyOperationsChanged } from '@/lib/operation-client';
import type { InventoryItem, InventoryMovement } from '@/types/inventory';
import type { SupplyRead } from '@/types/supply';
export function inventoryItem(supply: SupplyRead): InventoryItem {
  const finite = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const estoqueAtual = finite(supply.estoqueAtual), estoqueMinimo = finite(supply.estoqueMinimo), precoCusto = finite(supply.precoCusto);
  return { supply, estoqueAtual, estoqueMinimo,
    valorEmEstoque: estoqueAtual === null || precoCusto === null ? null : Math.max(0, estoqueAtual) * precoCusto,
    status: estoqueAtual === null ? 'desconhecido' : estoqueAtual <= 0 ? 'esgotado'
      : estoqueMinimo === null ? 'desconhecido' : estoqueAtual < estoqueMinimo ? 'baixo' : 'em_estoque' };
}
export async function getInventory(callback: (data: InventoryItem[]) => void) {
  return subscribeOperation(() => fetchAllOperationPages<SupplyRead>('/api/operations/supplies'), response => callback(response.map(inventoryItem)), () => callback([]));
}
export async function addInventoryMovement(data: Omit<InventoryMovement, 'id' | 'createdAt'>) {
  const response = await fetchOperation<{ id: string; newStock: number }>('/api/operations/supplies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'movement', data }) });
  notifyOperationsChanged(); return response;
}
