import { fetchOperation, notifyOperationsChanged } from '@/lib/operation-client';
import type {
  BatchInput, BatchSummary, GenerationPreview, IappExport, ManualOrderInput, PreviewInput, ProducibleProduct, ProductionOrderRow,
  SalesOrderBatchInput, SalesOrderPreview,
} from '@/server/persistence/pcp-orders-contract';

const path = '/api/operations/production-orders';

async function post<T>(action: string, data?: unknown, id?: string, notify = true): Promise<T> {
  const response = await fetchOperation<T>(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data, id }),
  });
  if (notify) notifyOperationsChanged();
  return response.data;
}

export const previewOrders = (input: PreviewInput) => post<GenerationPreview>('preview', input, undefined, false);
export const createOrderBatch = (input: BatchInput) => post<{ batchId: string; orderCount: number; childCount: number }>('createBatch', input);
export const exportIapp = (batchId: string) => post<IappExport>('exportIapp', undefined, batchId);
export const createManualOrder = (input: ManualOrderInput) => post<{ batchId: string; number: number; childCount: number }>('createManual', input);
export const previewSalesOrder = (number: string) => post<SalesOrderPreview>('previewSalesOrder', { number }, undefined, false);
export const createFromSalesOrder = (input: SalesOrderBatchInput) =>
  post<{ batchId: string; orderCount: number; childCount: number; salesOrderNumber: string }>('createFromSalesOrder', input);
export async function getProducible(): Promise<ProducibleProduct[]> { return (await fetchOperation<ProducibleProduct[]>(`${path}?view=products`)).data; }
export async function getBatches(): Promise<BatchSummary[]> { return (await fetchOperation<BatchSummary[]>(`${path}?view=batches`)).data; }
export async function getOrders(batchId?: string | null): Promise<ProductionOrderRow[]> {
  return (await fetchOperation<ProductionOrderRow[]>(`${path}?view=orders${batchId ? `&batchId=${encodeURIComponent(batchId)}` : ''}`)).data;
}
