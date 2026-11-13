/**
 * Regras dos cadastros de engenharia do PCP, sem acesso a banco.
 *
 * Cada função devolve a mensagem de recusa, ou null quando o cadastro é válido. O repositório chama
 * estas funções dentro da transação, sobre as linhas já travadas, para que a regra e a gravação
 * vejam o mesmo estado.
 */

export type OperationNode = { id: string; lineId: string; predecessorId: string | null };
export type TeamMember = { workerId: string; leaderId: string | null };

/**
 * A predecessora tem de existir, estar na mesma linha e não fechar um ciclo. Sem isso o Kanban
 * poderia exigir que uma OS espere por ela mesma e travar o card.
 */
export function predecessorError(operationId: string, lineId: string, predecessorId: string | null,
  operations: readonly OperationNode[]): string | null {
  if (!predecessorId) return null;
  if (predecessorId === operationId) return 'A operação não pode ser predecessora de si mesma.';
  const byId = new Map(operations.map(op => [op.id, op]));
  const predecessor = byId.get(predecessorId);
  if (!predecessor) return 'Operação predecessora não encontrada.';
  if (predecessor.lineId !== lineId) return 'A predecessora precisa ser da mesma linha de produção.';
  const seen = new Set<string>([operationId]);
  for (let current: OperationNode | undefined = predecessor; current; current = current.predecessorId ? byId.get(current.predecessorId) : undefined) {
    if (seen.has(current.id)) return 'A predecessora escolhida cria um ciclo entre operações.';
    seen.add(current.id);
  }
  return null;
}

/**
 * Organograma de uma equipe, como no iApp: cada membro responde a outro membro da mesma equipe, sem
 * ciclo, e o líder da equipe é um membro. Superiores e líder precisam estar ativos.
 */
export function teamMembersError(members: readonly TeamMember[], leaderId: string | null,
  activeWorkerIds: ReadonlySet<string>, knownWorkerIds: ReadonlySet<string>): string | null {
  const byId = new Map<string, TeamMember>();
  for (const member of members) {
    if (!knownWorkerIds.has(member.workerId)) return 'Funcionário não encontrado.';
    if (byId.has(member.workerId)) return 'Funcionário repetido na equipe.';
    byId.set(member.workerId, member);
  }
  if (leaderId) {
    if (!byId.has(leaderId)) return 'O líder precisa ser membro da equipe.';
    if (!activeWorkerIds.has(leaderId)) return 'O líder precisa estar ativo.';
  }
  for (const member of members) {
    if (!member.leaderId) continue;
    if (member.leaderId === member.workerId) return 'O funcionário não pode responder a si mesmo.';
    if (!byId.has(member.leaderId)) return 'O superior precisa ser membro da mesma equipe.';
    if (!activeWorkerIds.has(member.leaderId)) return 'O superior precisa estar ativo.';
    const seen = new Set<string>();
    for (let current: TeamMember | undefined = member; current; current = current.leaderId ? byId.get(current.leaderId) : undefined) {
      if (seen.has(current.workerId)) return 'O organograma da equipe tem um ciclo.';
      seen.add(current.workerId);
    }
  }
  return null;
}

export type WorkPeriod = { weekday: number; startsAt: string; endsAt: string };

const minutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/** Os intervalos de um mesmo dia não podem se sobrepor; os vãos entre eles são as pausas. */
export function workPeriodsError(periods: readonly WorkPeriod[]): string | null {
  for (let day = 0; day <= 6; day++) {
    const sorted = periods.filter(p => p.weekday === day).sort((a, b) => minutes(a.startsAt) - minutes(b.startsAt));
    for (let i = 0; i < sorted.length; i++) {
      if (minutes(sorted[i].endsAt) <= minutes(sorted[i].startsAt)) return 'O fim do intervalo precisa ser depois do início.';
      if (i > 0 && minutes(sorted[i].startsAt) < minutes(sorted[i - 1].endsAt)) return 'Intervalos do mesmo dia se sobrepõem.';
    }
  }
  return null;
}

export type SheetStep = { operationId: string; predecessorOperationId: string | null };
export type SheetComponent = { componentSku: string; quantity: number; operationId: string | null };

/**
 * Roteiro de uma ficha técnica: cada operação aparece uma vez, existe no cadastro, e a predecessora de
 * um passo é outro passo da mesma ficha, sem ciclo. Os componentes só podem apontar para passos do roteiro.
 */
export function sheetError(steps: readonly SheetStep[], components: readonly SheetComponent[],
  knownOperationIds: ReadonlySet<string>): string | null {
  if (!steps.length) return 'O roteiro precisa de pelo menos uma operação.';
  const byOperation = new Map<string, SheetStep>();
  for (const step of steps) {
    if (!knownOperationIds.has(step.operationId)) return 'Operação não encontrada no cadastro.';
    if (byOperation.has(step.operationId)) return 'A mesma operação aparece duas vezes no roteiro.';
    byOperation.set(step.operationId, step);
  }
  for (const step of steps) {
    if (!step.predecessorOperationId) continue;
    if (step.predecessorOperationId === step.operationId) return 'Um passo não pode ser predecessor de si mesmo.';
    if (!byOperation.has(step.predecessorOperationId)) return 'A predecessora precisa estar no roteiro da ficha.';
    const seen = new Set<string>();
    for (let current: SheetStep | undefined = step; current; current = current.predecessorOperationId ? byOperation.get(current.predecessorOperationId) : undefined) {
      if (seen.has(current.operationId)) return 'O roteiro tem um ciclo entre predecessoras.';
      seen.add(current.operationId);
    }
  }
  const seenComponents = new Set<string>();
  for (const component of components) {
    if (component.operationId && !byOperation.has(component.operationId)) return 'O componente aponta para uma operação fora do roteiro.';
    const key = `${component.componentSku}|${component.operationId ?? ''}`;
    if (seenComponents.has(key)) return 'Componente repetido no mesmo passo.';
    seenComponents.add(key);
  }
  return null;
}
