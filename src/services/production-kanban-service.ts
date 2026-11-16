import { fetchOperation, notifyOperationsChanged } from '@/lib/operation-client';
import type { Board, FinishInput } from '@/server/persistence/pcp-kanban-contract';

const path = '/api/operations/production-kanban';

async function post(action: string, data: unknown): Promise<void> {
  await fetchOperation(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) });
  notifyOperationsChanged();
}

export async function getBoard(): Promise<Board> { return (await fetchOperation<Board>(path)).data; }
export const moveCard = (orderId: string, target: string, badge: string | null = null) => post('move', { orderId, target, badge });
export const startStep = (orderId: string, stepId: string, workerId: string) => post('start', { orderId, stepId, workerId });
export const pauseStep = (orderId: string, stepId: string, pause: boolean) => post('pause', { orderId, stepId, pause });
export const closeOrder = (orderId: string) => post('close', { orderId });
export const setUrgent = (orderId: string, urgent: boolean) => post('priority', { orderId, urgent });
export const finishStep = (orderId: string, stepId: string, finish: FinishInput) => post('finish', { orderId, stepId, finish });
