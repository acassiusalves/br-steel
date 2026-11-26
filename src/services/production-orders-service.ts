import { fetchOperation, notifyOperationsChanged } from '@/lib/operation-client';
import type { OperationResult } from '@/types/operations';
import type {
  BatchInput, BatchSummary, BlingQueueProgress, GenerationPreview, IappExport, ManualOrderInput, PreviewInput, ProducibleProduct, ProductionOrderRow,
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

export type PreviewProgress = BlingQueueProgress;
type PreviewMessage = { progress: PreviewProgress } | { result: OperationResult<GenerationPreview> } | { error: string };

export async function previewOrders(input: PreviewInput, onProgress?: (progress: PreviewProgress) => void): Promise<GenerationPreview> {
  if (input.policy !== 'bling' || !onProgress) return post<GenerationPreview>('preview', input, undefined, false);
  const response = await fetch(path, {
    credentials: 'same-origin', cache: 'no-store', method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'preview', data: input, stream: true }),
  });
  if (!response.ok || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Não foi possível carregar os dados.');
    return payload.data;
  }

  const reader = response.body?.getReader();
  const interrupted = 'A leitura da fila foi interrompida. Calcule a sugestão novamente.';
  if (!reader) throw new Error(interrupted);
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const lines = (pending + decoder.decode(value, { stream: !done })).split('\n');
      pending = done ? '' : (lines.pop() ?? '');
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line) as PreviewMessage;
        if ('error' in message) throw new Error(message.error);
        if ('result' in message) return message.result.data;
        if ('progress' in message) onProgress(message.progress);
      }
      if (done) throw new Error(interrupted);
    }
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) throw new Error(interrupted);
    throw error;
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
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
