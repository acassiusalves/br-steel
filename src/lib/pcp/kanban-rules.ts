/**
 * Regras do Kanban de OPs, sem acesso a banco. Seguem o que foi mostrado no iApp na reunião de
 * 10/11/2026: o card só avança quando a OS da fase terminou; só o líder da fase passa o card adiante
 * (é a conferência de quantidade e qualidade); só quem iniciou a OS a finaliza.
 */

export type StepStatus = 'aberto' | 'em_execucao' | 'executada';
export type KanbanStep = {
  id: string; operationId: string; phaseId: string; position: number; status: StepStatus;
  workerId: string | null; predecessorId: string | null;
  /** OS em execução com pausa aberta: o tempo parado conta como espera. */
  paused?: boolean;
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

/**
 * Quem pode iniciar a OS. Com `byBadge`, o funcionário se identificou com o crachá no terminal do líder:
 * o crachá vale como a presença dele, então não importa de qual equipe é quem opera a tela.
 */
export function startError(order: KanbanOrder, stepId: string, workerId: string, workerOperationIds: readonly string[],
  workerActive: boolean, actor: KanbanActor, teams: readonly KanbanTeam[], byBadge = false): string | null {
  const step = order.steps.find(s => s.id === stepId);
  if (!step) return 'OS não encontrada nesta OP.';
  if (order.phaseId !== step.phaseId) return 'Mova o card para a fase desta OS antes de iniciá-la.';
  if (step.status !== 'aberto') return 'Esta OS já foi iniciada.';
  const predecessor = step.predecessorId ? order.steps.find(s => s.id === step.predecessorId) : null;
  if (predecessor && predecessor.status !== 'executada') return 'A OS anterior ainda não foi executada.';
  if (!workerActive) return 'O funcionário está inativo.';
  if (!workerOperationIds.includes(step.operationId)) return 'Este funcionário não pode executar esta operação.';
  if (byBadge || actor.isAdmin || actor.workerId === workerId || leadsWorker(actor, teams, step.operationId, workerId)) return null;
  return 'Você só pode iniciar OS em seu nome ou de membros da equipe que lidera.';
}

export function finishError(order: KanbanOrder, stepId: string, actor: KanbanActor, teams: readonly KanbanTeam[],
  lossQuantity: number): string | null {
  const step = order.steps.find(s => s.id === stepId);
  if (!step) return 'OS não encontrada nesta OP.';
  if (step.status !== 'em_execucao') return 'Esta OS não está em execução.';
  if (lossQuantity < 0) return 'Perda inválida.';
  if (lossQuantity > currentQuantity(order)) return 'A perda não pode passar da quantidade atual da OP.';
  return holdsStep(actor, teams, step) ? null : 'Só quem iniciou a OS, ou o líder dele, pode finalizá-la.';
}

/** A OS fica com quem a iniciou: age nela ele mesmo, o líder dele na operação ou o administrador. */
function holdsStep(actor: KanbanActor, teams: readonly KanbanTeam[], step: KanbanStep): boolean {
  // `workerId` nulo dos dois lados (usuário sem funcionário e OS vinda do iApp) não é a mesma pessoa.
  if (actor.isAdmin || (actor.workerId !== null && actor.workerId === step.workerId)
    || (step.workerId && leadsWorker(actor, teams, step.operationId, step.workerId))) return true;
  // OS vinda do iApp em execução: o iApp não diz quem a iniciou, então o líder da operação responde por ela.
  return !step.workerId && leadsOperation(actor, teams, step.operationId);
}

/** Pausar (`pause = true`) ou retomar a OS em execução: as mesmas pessoas que podem finalizá-la. */
export function pauseError(order: KanbanOrder, stepId: string, pause: boolean, actor: KanbanActor, teams: readonly KanbanTeam[]): string | null {
  const step = order.steps.find(s => s.id === stepId);
  if (!step) return 'OS não encontrada nesta OP.';
  if (step.status !== 'em_execucao') return 'Esta OS não está em execução.';
  if (pause && step.paused) return 'Esta OS já está pausada.';
  if (!pause && !step.paused) return 'Esta OS não está pausada.';
  return holdsStep(actor, teams, step) ? null : `Só quem iniciou a OS, ou o líder dele, pode ${pause ? 'pausá-la' : 'retomá-la'}.`;
}

/** Excluir (encerrar) a OP: só o administrador, só em "A produzir" e antes de qualquer OS começar. */
export function closeError(order: KanbanOrder, actor: KanbanActor): string | null {
  if (!actor.isAdmin) return 'Só o administrador exclui OP.';
  if (order.status !== 'a_produzir' || order.phaseId) return 'Só dá para excluir OP que está em "A produzir".';
  if (order.steps.some(s => s.status !== 'aberto')) return 'Esta OP já tem OS iniciada e não pode ser excluída.';
  return null;
}

/** Marcar ou tirar a urgência: só o administrador, só em OP que ainda está no quadro. */
export function priorityError(order: KanbanOrder, actor: KanbanActor): string | null {
  if (!actor.isAdmin) return 'Só o administrador muda a urgência da OP.';
  if (order.status !== 'a_produzir' && order.status !== 'produzindo') return 'Só dá para mudar a urgência de OP que ainda está no quadro.';
  return null;
}

type QueueCard = { urgent: boolean; number: number; iappNumber?: string | null };
/** Número que aparece no card: o do iApp, quando a OP veio de lá; senão, o do BR Steel. */
const shownNumber = (card: QueueCard) => {
  const iapp = card.iappNumber ? Number(card.iappNumber) : NaN;
  return Number.isFinite(iapp) ? iapp : card.number;
};
/**
 * Ordem dos cards na coluna (chamado nº 2, de 17/11/2026): a de menor número no topo, em ordem crescente
 * do número mostrado no card. As OPs do iApp, mais antigas, vêm antes das geradas no BR Steel, que têm
 * numeração própria. Urgente fura a fila (reunião de 13/11/2026).
 */
export function queueOrder(a: QueueCard, b: QueueCard): number {
  return Number(b.urgent) - Number(a.urgent)
    || Number(!a.iappNumber) - Number(!b.iappNumber)
    || shownNumber(a) - shownNumber(b)
    || a.number - b.number;
}
