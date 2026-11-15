import type { OperationResult } from '@/types/operations';
import type { StepStatus } from '@/lib/pcp/kanban-rules';
import type { OrderKind } from '@/lib/pcp/op-generator';
import type { WriteActor } from './write-audit';

/** `asksBadge`: ao passar o card para esta coluna, o líder bipa o crachá de quem executa e a OS já começa. */
export type BoardColumn = { key: string; name: string; asksBadge: boolean };
export type BoardStep = {
  id: string; operationName: string; phaseId: string; position: number; status: StepStatus;
  workerName: string | null; startedAt: string | null; finishedAt: string | null; notes: string | null;
  /** Minutos úteis (expediente, sem feriados) entre o fim da OS anterior e o início desta. */
  waitMinutes: number | null;
  /** Minutos úteis de execução, sem as pausas; numa OS em andamento, até agora. */
  runMinutes: number | null;
  /** Minutos úteis em pausa (contam como espera). */
  pausedMinutes: number;
  /** Início da pausa aberta, quando a OS está pausada. */
  pausedSince: string | null;
  /** OS trazida do iApp já iniciada: sem funcionário e sem horário de início. */
  imported: boolean;
};
export type BoardLoss = { quantity: number; reason: string; notes: string | null; createdAt: string };
export type BoardCard = {
  id: string; number: number; /** Número da OP no iApp, quando ela veio de lá. */ iappNumber: string | null; kind: OrderKind; sku: string; description: string | null; quantity: number; currentQuantity: number;
  column: string; createdAt: string; steps: BoardStep[]; losses: BoardLoss[];
  /** Soma dos tempos úteis de execução e de espera das OS (a espera inclui as pausas). */
  totals: { runMinutes: number; waitMinutes: number };
  /** O que o usuário logado pode fazer neste card agora. */
  allowed: {
    moveTo: string | null; start: { stepId: string; workers: { id: string; name: string }[] } | null; finishStepId: string | null;
    /** OS em execução que o usuário pode pausar ou retomar. */
    pauseStepId: string | null; resumeStepId: string | null;
    /** O administrador pode excluir (encerrar) a OP, que ainda está em "A produzir". */
    close: boolean;
  };
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
  /** Na coluna que pede crachá, `badge` é obrigatório: identifica quem executa e a OS já começa. */
  move(orderId: string, target: string, actor: BoardActor, badge?: string | null): Promise<OperationResult<null>>;
  start(orderId: string, stepId: string, workerId: string, actor: BoardActor): Promise<OperationResult<null>>;
  finish(orderId: string, stepId: string, input: FinishInput, actor: BoardActor): Promise<OperationResult<null>>;
  pause(orderId: string, stepId: string, actor: BoardActor): Promise<OperationResult<null>>;
  resume(orderId: string, stepId: string, actor: BoardActor): Promise<OperationResult<null>>;
  /** Exclui a OP de "A produzir": ela vira "encerrado" (com as OPs filhas) e sai do quadro e das contas. */
  close(orderId: string, actor: BoardActor): Promise<OperationResult<null>>;
}
