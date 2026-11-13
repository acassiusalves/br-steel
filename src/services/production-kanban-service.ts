import { fetchOperation, notifyOperationsChanged } from '@/lib/operation-client';
import type { Board, FinishInput } from '@/server/persistence/pcp-kanban-contract';

const path = '/api/operations/production-kanban';

async function post(action: string, data: unknown): Promise<void> {
  await fetchOperation(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) });
  notifyOperationsChanged();
}

export async function getBoard(): Promise<Board> { return (await fetchOperation<Board>(path)).data; }
export const moveCard = (orderId: string, target: string) => post('move', { orderId, target });
export const startStep = (orderId: string, stepId: string, workerId: string) => post('start', { orderId, stepId, workerId });
export const finishStep = (orderId: string, stepId: string, finish: FinishInput) => post('finish', { orderId, stepId, finish });
