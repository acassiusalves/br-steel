"use client";
import { fetchOperation, notifyOperationsChanged } from '@/lib/operation-client';
import type { Supply } from '@/types/supply';
async function mutate(input: unknown) {
  const response = await fetchOperation<{id: string}>('/api/operations/supplies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  notifyOperationsChanged(); return response.data;
}
export async function addSupply(data: Omit<Supply, 'id' | 'estoqueAtual'>) { return mutate({ action: 'create', data }); }
export async function updateSupply(id: string, data: Partial<Omit<Supply, 'id' | 'createdAt' | 'estoqueAtual'>>) { return mutate({ action: 'update', id, data }); }
export async function deleteSupply(id: string) { return mutate({ action: 'delete', id }); }
export async function updateSupplyBySku(sku: string, data: { estoqueMinimo?: number; estoqueMaximo?: number }) { return mutate({ action: 'limits', data: { sku, ...data } }); }
