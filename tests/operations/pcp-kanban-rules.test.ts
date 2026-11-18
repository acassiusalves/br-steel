import { describe, expect, it } from 'vitest';
import {
  closeError, columnOf, currentQuantity, finishError, moveError, nextColumn, pauseError, priorityError, queueOrder, startError, type KanbanOrder, type KanbanStep, type KanbanTeam,
} from '@/lib/pcp/kanban-rules';

// Roteiro do ralo: Check Corte → Dobrar → Check Dobra, cada operação na sua fase.
const step = (id: string, phaseId: string, position: number, status: KanbanStep['status'] = 'aberto', workerId: string | null = null): KanbanStep =>
  ({ id, operationId: `op-${id}`, phaseId, position, status, workerId, predecessorId: position > 0 ? ['s1', 's2', 's3'][position - 1] : null });
const order = (over: Partial<KanbanOrder> = {}, steps?: KanbanStep[]): KanbanOrder => ({
  status: 'a_produzir', phaseId: null, quantity: 20, lossTotal: 0,
  steps: steps ?? [step('s1', 'F-check-corte', 0), step('s2', 'F-dobra', 1), step('s3', 'F-check-dobra', 2)], ...over,
});
// Equipe Dobra: líder conferente com dois dobradores; o conferente também lidera os checks.
const teams: KanbanTeam[] = [
  { leaderId: 'lider', memberIds: ['lider', 'dobrador1', 'dobrador2'], operationIds: ['op-s2'] },
  { leaderId: 'lider', memberIds: ['lider'], operationIds: ['op-s1', 'op-s3'] },
];
const lider = { isAdmin: false, workerId: 'lider' };
const dobrador = { isAdmin: false, workerId: 'dobrador1' };
const admin = { isAdmin: true, workerId: null };

describe('movimento do card', () => {
  it('sai de "A produzir" para a fase da primeira OS, só pelo líder dela', () => {
    const o = order();
    expect(columnOf(o)).toBe('a_produzir');
    expect(nextColumn(o)).toBe('F-check-corte');
    expect(moveError(o, 'F-check-corte', lider, teams)).toBeNull();
    expect(moveError(o, 'F-check-corte', dobrador, teams)).toMatch(/líder/);
    expect(moveError(o, 'F-dobra', lider, teams)).toMatch(/próxima fase/);
  });
  it('não avança enquanto a OS da fase não terminou, e avança até Concluído', () => {
    const emExecucao = order({ status: 'produzindo', phaseId: 'F-dobra' }, [step('s1', 'F-check-corte', 0, 'executada', 'lider'), step('s2', 'F-dobra', 1, 'em_execucao', 'dobrador1'), step('s3', 'F-check-dobra', 2)]);
    expect(nextColumn(emExecucao)).toBeNull();
    expect(moveError(emExecucao, 'F-check-dobra', lider, teams)).toMatch(/Finalize/);
    const dobrada = order({ status: 'produzindo', phaseId: 'F-dobra' }, [step('s1', 'F-check-corte', 0, 'executada', 'lider'), step('s2', 'F-dobra', 1, 'executada', 'dobrador1'), step('s3', 'F-check-dobra', 2)]);
    expect(moveError(dobrada, 'F-check-dobra', dobrador, teams)).toMatch(/líder/);
    expect(moveError(dobrada, 'F-check-dobra', lider, teams)).toBeNull();
    const fim = order({ status: 'produzindo', phaseId: 'F-check-dobra' }, [step('s1', 'F-check-corte', 0, 'executada', 'lider'), step('s2', 'F-dobra', 1, 'executada', 'dobrador1'), step('s3', 'F-check-dobra', 2, 'executada', 'lider')]);
    expect(nextColumn(fim)).toBe('concluido');
    expect(moveError(fim, 'concluido', admin, teams)).toBeNull();
    expect(nextColumn({ ...fim, status: 'concluido' })).toBeNull();
  });
});

describe('iniciar e finalizar OS', () => {
  const naDobra = order({ status: 'produzindo', phaseId: 'F-dobra' }, [step('s1', 'F-check-corte', 0, 'executada', 'lider'), step('s2', 'F-dobra', 1), step('s3', 'F-check-dobra', 2)]);
  it('o líder inicia em nome de um membro; o membro só em nome próprio; precisa da permissão da operação', () => {
    expect(startError(naDobra, 's2', 'dobrador2', ['op-s2'], true, lider, teams)).toBeNull();
    expect(startError(naDobra, 's2', 'dobrador1', ['op-s2'], true, dobrador, teams)).toBeNull();
    expect(startError(naDobra, 's2', 'dobrador2', ['op-s2'], true, dobrador, teams)).toMatch(/seu nome/);
    expect(startError(naDobra, 's2', 'dobrador1', ['op-s9'], true, lider, teams)).toMatch(/não pode executar/);
    expect(startError(naDobra, 's2', 'dobrador1', ['op-s2'], false, lider, teams)).toMatch(/inativo/);
    expect(startError(naDobra, 's3', 'lider', ['op-s3'], true, lider, teams)).toMatch(/Mova o card/);
  });
  it('só quem iniciou (ou o líder dele) finaliza, e a perda não passa da quantidade atual', () => {
    const iniciada = order({ status: 'produzindo', phaseId: 'F-dobra', lossTotal: 1 }, [step('s1', 'F-check-corte', 0, 'executada', 'lider'), step('s2', 'F-dobra', 1, 'em_execucao', 'dobrador1'), step('s3', 'F-check-dobra', 2)]);
    expect(finishError(iniciada, 's2', dobrador, teams, 0)).toBeNull();
    expect(finishError(iniciada, 's2', lider, teams, 1)).toBeNull();
    expect(finishError(iniciada, 's2', { isAdmin: false, workerId: 'dobrador2' }, teams, 0)).toMatch(/Só quem iniciou/);
    expect(finishError(iniciada, 's2', dobrador, teams, 20)).toMatch(/quantidade atual/);
    expect(currentQuantity(iniciada)).toBe(19);
    expect(finishError(naDobra, 's2', lider, teams, 0)).toMatch(/não está em execução/);
  });  it('OS vinda do iApp em execução, sem funcionário: o líder da operação finaliza, o membro não', () => {
    const doIapp = order({ status: 'produzindo', phaseId: 'F-dobra' }, [step('s1', 'F-check-corte', 0, 'executada'), step('s2', 'F-dobra', 1, 'em_execucao'), step('s3', 'F-check-dobra', 2)]);
    expect(finishError(doIapp, 's2', lider, teams, 0)).toBeNull();
    expect(finishError(doIapp, 's2', admin, teams, 0)).toBeNull();
    expect(finishError(doIapp, 's2', dobrador, teams, 0)).toMatch(/Só quem iniciou/);
    // Usuário sem funcionário vinculado não "coincide" com a OS sem funcionário.
    expect(finishError(doIapp, 's2', { isAdmin: false, workerId: null }, teams, 0)).toMatch(/Só quem iniciou/);
  });
});

describe('crachá ao passar o card para a operação', () => {
  const naDobra = order({ status: 'produzindo', phaseId: 'F-dobra' }, [step('s1', 'F-check-corte', 0, 'executada', 'lider'), step('s2', 'F-dobra', 1), step('s3', 'F-check-dobra', 2)]);
  // O conferente do corte opera a tela, mas não lidera quem dobra: sem o crachá, não iniciaria em nome dele.
  const conferente = { isAdmin: false, workerId: 'conferente' };
  it('o crachá vale como a presença de quem executa, mas a permissão da operação continua valendo', () => {
    expect(startError(naDobra, 's2', 'dobrador2', ['op-s2'], true, conferente, teams)).toMatch(/seu nome/);
    expect(startError(naDobra, 's2', 'dobrador2', ['op-s2'], true, conferente, teams, true)).toBeNull();
    expect(startError(naDobra, 's2', 'dobrador2', ['op-s9'], true, conferente, teams, true)).toMatch(/não pode executar/);
    expect(startError(naDobra, 's2', 'dobrador2', ['op-s2'], false, conferente, teams, true)).toMatch(/inativo/);
  });
});

describe('pausa da OS', () => {
  const emExecucao = (paused: boolean) => order({ status: 'produzindo', phaseId: 'F-dobra' }, [
    step('s1', 'F-check-corte', 0, 'executada', 'lider'), { ...step('s2', 'F-dobra', 1, 'em_execucao', 'dobrador1'), paused }, step('s3', 'F-check-dobra', 2)]);
  it('pausa e retoma quem pode finalizar; não pausa duas vezes nem retoma o que não está pausado', () => {
    expect(pauseError(emExecucao(false), 's2', true, dobrador, teams)).toBeNull();
    expect(pauseError(emExecucao(false), 's2', true, lider, teams)).toBeNull();
    expect(pauseError(emExecucao(false), 's2', true, { isAdmin: false, workerId: 'dobrador2' }, teams)).toMatch(/pausá-la/);
    expect(pauseError(emExecucao(true), 's2', true, lider, teams)).toMatch(/já está pausada/);
    expect(pauseError(emExecucao(false), 's2', false, lider, teams)).toMatch(/não está pausada/);
    expect(pauseError(emExecucao(true), 's2', false, dobrador, teams)).toBeNull();
    expect(pauseError(emExecucao(true), 's3', true, lider, teams)).toMatch(/não está em execução/);
  });
  it('a OS pausada ainda pode ser finalizada', () => {
    expect(finishError(emExecucao(true), 's2', lider, teams, 0)).toBeNull();
  });
});

describe('excluir OP', () => {
  it('só o administrador, só em "A produzir" e antes de qualquer OS começar', () => {
    expect(closeError(order(), admin)).toBeNull();
    expect(closeError(order(), lider)).toMatch(/administrador/);
    expect(closeError(order({ status: 'produzindo', phaseId: 'F-check-corte' }), admin)).toMatch(/A produzir/);
    expect(closeError(order({}, [step('s1', 'F-check-corte', 0, 'em_execucao', 'lider'), step('s2', 'F-dobra', 1)]), admin)).toMatch(/iniciada/);
  });
});

describe('urgência', () => {
  it('só o administrador muda, e só em OP que ainda está no quadro', () => {
    expect(priorityError(order(), admin)).toBeNull();
    expect(priorityError(order({ status: 'produzindo', phaseId: 'F-dobra' }), admin)).toBeNull();
    expect(priorityError(order(), lider)).toMatch(/administrador/);
    expect(priorityError(order({ status: 'concluido' }), admin)).toMatch(/quadro/);
    expect(priorityError(order({ status: 'encerrado' }), admin)).toMatch(/quadro/);
  });
  it('urgente mais nova passa na frente da normal mais antiga; no empate vale o número', () => {
    const cards = [{ number: 10, urgent: false }, { number: 30, urgent: true }, { number: 5, urgent: false }, { number: 20, urgent: true }];
    expect([...cards].sort(queueOrder).map(c => c.number)).toEqual([20, 30, 5, 10]);
  });
  it('ordem crescente pelo número mostrado no card: OPs do iApp (importadas de trás para frente) antes das do BR Steel (chamado nº 2)', () => {
    const cards = [
      { number: 3, iappNumber: '0009658', urgent: false }, { number: 1, iappNumber: '0009660', urgent: false },
      { number: 2, iappNumber: '0009659', urgent: false }, { number: 54, iappNumber: null, urgent: false },
      { number: 55, iappNumber: null, urgent: false }, { number: 60, iappNumber: null, urgent: true },
    ];
    expect([...cards].sort(queueOrder).map(c => c.iappNumber ?? String(c.number))).toEqual(['60', '0009658', '0009659', '0009660', '54', '55']);
  });
});
