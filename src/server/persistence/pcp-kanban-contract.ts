import type { OperationResult } from '@/types/operations';
import type { StepStatus } from '@/lib/pcp/kanban-rules';
import type { OrderKind } from '@/lib/pcp/op-generator';
import type { WriteActor } from './write-audit';

export type BoardColumn = { key: string; name: string };
export type BoardStep = {
  id: string; operationName: string; phaseId: string; position: number; status: StepStatus;
  workerName: string | null; startedAt: string | null; finishedAt: string | null; notes: string | null;
  /** Minutos úteis (expediente, sem feriados) entre o fim da OS anterior e o início desta. */
  waitMinutes: number | null;
  /** Minutos úteis de execução; numa OS em andamento, até agora. */
  runMinutes: number | null;
};
export type BoardLoss = { quantity: number; reason: string; notes: string | null; createdAt: string };
export type BoardCard = {
  id: string; number: number; kind: OrderKind; sku: string; description: string | null; quantity: number; currentQuantity: number;
  column: string; createdAt: string; steps: BoardStep[]; losses: BoardLoss[];
  /** Soma dos tempos úteis de execução e de espera das OS. */
  totals: { runMinutes: number; waitMinutes: number };
  /** O que o usuário logado pode fazer neste card agora. */
  allowed: { moveTo: string | null; start: { stepId: string; workers: { id: string; name: string }[] } | null; finishStepId: string | null };
};
export type Board = {
  columns: BoardColumn[]; cards: BoardCard[]; lossReasons: { id: string; name: string }[];
  /** Funcionário vinculado ao usuário logado; sem ele, só administradores agem no quadro. */
  actorWorker: { id: string; name: string } | null;
};

/** Quem está agindo: o usuário da sessão; o funcionário é encontrado pelo vínculo `workers.user_id`. */
export type BoardActor = WriteActor & { isAdmin: boolean };
export type FinishInput = { lossQuantity: number; lossReasonId: string | null; notes: string | null };

export interface KanbanRepository {
  board(actor: BoardActor): Promise<OperationResult<Board>>;
  move(orderId: string, target: string, actor: BoardActor): Promise<OperationResult<null>>;
  start(orderId: string, stepId: string, workerId: string, actor: BoardActor): Promise<OperationResult<null>>;
  finish(orderId: string, stepId: string, input: FinishInput, actor: BoardActor): Promise<OperationResult<null>>;
}
