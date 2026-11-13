/**
 * Regras do Kanban de OPs, sem acesso a banco. Seguem o que foi mostrado no iApp na reunião de
 * 10/11/2026: o card só avança quando a OS da fase terminou; só o líder da fase passa o card adiante
 * (é a conferência de quantidade e qualidade); só quem iniciou a OS a finaliza.
 */

export type StepStatus = 'aberto' | 'em_execucao' | 'executada';
export type KanbanStep = {
  id: string; operationId: string; phaseId: string; position: number; status: StepStatus;
  workerId: string | null; predecessorId: string | null;
};
export type KanbanOrder = {
  status: 'a_produzir' | 'produzindo' | 'concluido' | 'suspenso' | 'encerrado';
  phaseId: string | null; quantity: number; lossTotal: number; steps: KanbanStep[];
};
export type KanbanTeam = { leaderId: string | null; memberIds: string[]; operationIds: string[] };
/** O usuário logado: administrador age como gestão; os demais agem pelo funcionário vinculado. */
export type KanbanActor = { isAdmin: boolean; workerId: string | null };

export const DONE = 'concluido';
export const TODO = 'a_produzir';

const byPosition = (steps: readonly KanbanStep[]) => [...steps].sort((a, b) => a.position - b.position);

/** Coluna onde o card está: "a_produzir", o id da fase ou "concluido". */
export function columnOf(order: KanbanOrder): string {
  if (order.status === 'concluido') return DONE;
  return order.phaseId ?? TODO;
}

/** A OS da fase em que o card está (a primeira ainda não executada nessa fase). */
export function currentStep(order: KanbanOrder): KanbanStep | null {
  if (!order.phaseId) return null;
  const inPhase = byPosition(order.steps).filter(s => s.phaseId === order.phaseId);
  return inPhase.find(s => s.status !== 'executada') ?? inPhase.at(-1) ?? null;
}

/** Próxima OS ainda não executada, na ordem do roteiro. */
export function nextPendingStep(order: KanbanOrder): KanbanStep | null {
  return byPosition(order.steps).find(s => s.status !== 'executada') ?? null;
}

/**
 * Para onde o card pode ir: a fase da próxima OS pendente, ou "concluido" quando todas terminaram.
 * Null quando a OS da fase atual ainda não terminou.
 */
export function nextColumn(order: KanbanOrder): string | null {
  if (order.status === 'concluido' || order.status === 'encerrado' || order.status === 'suspenso') return null;
  const current = currentStep(order);
  if (current && current.status !== 'executada') return null;
  const next = nextPendingStep(order);
  if (!next) return DONE;
  return next.phaseId === order.phaseId ? null : next.phaseId;
}

export const currentQuantity = (order: KanbanOrder) => Math.max(0, order.quantity - order.lossTotal);

const leadsOperation = (actor: KanbanActor, teams: readonly KanbanTeam[], operationId: string) =>
  actor.workerId !== null && teams.some(t => t.leaderId === actor.workerId && t.operationIds.includes(operationId));

/** O líder responde pelos membros das equipes que lidera, nas operações dessas equipes. */
const leadsWorker = (actor: KanbanActor, teams: readonly KanbanTeam[], operationId: string, workerId: string) =>
  actor.workerId !== null && teams.some(t => t.leaderId === actor.workerId && t.operationIds.includes(operationId) && t.memberIds.includes(workerId));

export function moveError(order: KanbanOrder, target: string, actor: KanbanActor, teams: readonly KanbanTeam[]): string | null {
  const next = nextColumn(order);
  if (next === null) {
    const current = currentStep(order);
    return current && current.status !== 'executada' ? 'Finalize a OS desta fase antes de mover o card.' : 'Este card não pode ser movido.';
  }
  if (target !== next) return 'O card só pode ir para a próxima fase do roteiro.';
  if (actor.isAdmin) return null;
  // Saindo de uma fase, quem passa adiante é o líder dela; saindo de "A produzir", o líder da fase de destino.
  const reference = currentStep(order) ?? nextPendingStep(order);
  if (!reference || !leadsOperation(actor, teams, reference.operationId)) {
    return 'Só o líder da equipe desta fase pode passar o card adiante.';
  }
  return null;
}

export function startError(order: KanbanOrder, stepId: string, workerId: string, workerOperationIds: readonly string[],
  workerActive: boolean, actor: KanbanActor, teams: readonly KanbanTeam[]): string | null {
  const step = order.steps.find(s => s.id === stepId);
  if (!step) return 'OS não encontrada nesta OP.';
  if (order.phaseId !== step.phaseId) return 'Mova o card para a fase desta OS antes de iniciá-la.';
  if (step.status !== 'aberto') return 'Esta OS já foi iniciada.';
  const predecessor = step.predecessorId ? order.steps.find(s => s.id === step.predecessorId) : null;
  if (predecessor && predecessor.status !== 'executada') return 'A OS anterior ainda não foi executada.';
  if (!workerActive) return 'O funcionário está inativo.';
  if (!workerOperationIds.includes(step.operationId)) return 'Este funcionário não pode executar esta operação.';
  if (actor.isAdmin || actor.workerId === workerId || leadsWorker(actor, teams, step.operationId, workerId)) return null;
  return 'Você só pode iniciar OS em seu nome ou de membros da equipe que lidera.';
}

export function finishError(order: KanbanOrder, stepId: string, actor: KanbanActor, teams: readonly KanbanTeam[],
  lossQuantity: number): string | null {
  const step = order.steps.find(s => s.id === stepId);
  if (!step) return 'OS não encontrada nesta OP.';
  if (step.status !== 'em_execucao') return 'Esta OS não está em execução.';
  if (lossQuantity < 0) return 'Perda inválida.';
  if (lossQuantity > currentQuantity(order)) return 'A perda não pode passar da quantidade atual da OP.';
  // A OS fica com quem a iniciou: finaliza ele mesmo, ou o líder dele na operação.
  // `workerId` nulo dos dois lados (usuário sem funcionário e OS vinda do iApp) não é a mesma pessoa.
  if (actor.isAdmin || (actor.workerId !== null && actor.workerId === step.workerId)
    || (step.workerId && leadsWorker(actor, teams, step.operationId, step.workerId))) return null;
  // OS vinda do iApp em execução: o iApp não diz quem a iniciou, então o líder da operação a finaliza.
  if (!step.workerId && leadsOperation(actor, teams, step.operationId)) return null;
  return 'Só quem iniciou a OS, ou o líder dele, pode finalizá-la.';
}
