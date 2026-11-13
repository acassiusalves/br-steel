import { describe, expect, it } from 'vitest';
import { predecessorError, sheetError, teamMembersError, workPeriodsError, type OperationNode } from '@/lib/pcp/engineering-rules';

// Mesma cadeia da linha da fábrica: Cortar → Check Corte → Dobrar → Check Dobra.
const ops: OperationNode[] = [
  { id: 'cortar', lineId: 'L1', predecessorId: null },
  { id: 'check-corte', lineId: 'L1', predecessorId: 'cortar' },
  { id: 'dobrar', lineId: 'L1', predecessorId: 'check-corte' },
  { id: 'check-dobra', lineId: 'L1', predecessorId: 'dobrar' },
  { id: 'outra-linha', lineId: 'L2', predecessorId: null },
];

describe('predecessorError', () => {
  it('aceita operação sem predecessora e predecessora válida na mesma linha', () => {
    expect(predecessorError('cortar', 'L1', null, ops)).toBeNull();
    expect(predecessorError('dobrar', 'L1', 'check-corte', ops)).toBeNull();
    expect(predecessorError('nova', 'L1', 'check-dobra', ops)).toBeNull();
  });
  it('recusa a própria operação, predecessora ausente e outra linha', () => {
    expect(predecessorError('dobrar', 'L1', 'dobrar', ops)).toMatch(/si mesma/);
    expect(predecessorError('dobrar', 'L1', 'nao-existe', ops)).toMatch(/não encontrada/);
    expect(predecessorError('dobrar', 'L1', 'outra-linha', ops)).toMatch(/mesma linha/);
  });
  it('recusa ciclo indireto', () => {
    // Cortar passaria a depender de Check Dobra, que depende de Cortar pela cadeia.
    expect(predecessorError('cortar', 'L1', 'check-dobra', ops)).toMatch(/ciclo/);
  });
});

const known = new Set(['lider', 'membro1', 'membro2', 'inativo']);
const active = new Set(['lider', 'membro1', 'membro2']);

describe('teamMembersError', () => {
  it('aceita o organograma da equipe Dobra: líder com dois subordinados', () => {
    const members = [{ workerId: 'lider', leaderId: null }, { workerId: 'membro1', leaderId: 'lider' }, { workerId: 'membro2', leaderId: 'membro1' }];
    expect(teamMembersError(members, 'lider', active, known)).toBeNull();
    expect(teamMembersError([], null, active, known)).toBeNull();
  });
  it('recusa líder fora da equipe ou inativo, superior fora da equipe, repetido, desconhecido e ciclo', () => {
    expect(teamMembersError([{ workerId: 'membro1', leaderId: null }], 'lider', active, known)).toMatch(/membro da equipe/);
    expect(teamMembersError([{ workerId: 'inativo', leaderId: null }], 'inativo', active, known)).toMatch(/ativo/);
    expect(teamMembersError([{ workerId: 'membro1', leaderId: 'lider' }], null, active, known)).toMatch(/mesma equipe/);
    expect(teamMembersError([{ workerId: 'membro1', leaderId: null }, { workerId: 'membro1', leaderId: null }], null, active, known)).toMatch(/repetido/);
    expect(teamMembersError([{ workerId: 'fantasma', leaderId: null }], null, active, known)).toMatch(/não encontrado/);
    expect(teamMembersError([{ workerId: 'lider', leaderId: 'membro1' }, { workerId: 'membro1', leaderId: 'lider' }], null, active, known)).toMatch(/ciclo/);
    expect(teamMembersError([{ workerId: 'lider', leaderId: 'lider' }], null, active, known)).toMatch(/si mesmo/);
  });
});

describe('workPeriodsError', () => {
  // Expediente do iApp: 07:45–12:00, 13:00–16:00, 16:15–17:30.
  const day = (weekday: number) => [
    { weekday, startsAt: '07:45', endsAt: '12:00' },
    { weekday, startsAt: '13:00', endsAt: '16:00' },
    { weekday, startsAt: '16:15', endsAt: '17:30' },
  ];
  it('aceita o expediente da fábrica', () => {
    expect(workPeriodsError([1, 2, 3, 4, 5].flatMap(day))).toBeNull();
  });
  it('recusa intervalo invertido e sobreposição', () => {
    expect(workPeriodsError([{ weekday: 1, startsAt: '12:00', endsAt: '07:45' }])).toMatch(/depois do início/);
    expect(workPeriodsError([...day(1), { weekday: 1, startsAt: '11:00', endsAt: '12:30' }])).toMatch(/sobrepõem/);
  });
});

describe('sheetError', () => {
  const known = new Set(['cortar', 'dobrar', 'embalar']);
  const route = [
    { operationId: 'cortar', predecessorOperationId: null },
    { operationId: 'dobrar', predecessorOperationId: 'cortar' },
    { operationId: 'embalar', predecessorOperationId: 'dobrar' },
  ];
  it('aceita o roteiro e componentes ligados a passos do roteiro', () => {
    expect(sheetError(route, [{ componentSku: 'CHAPA', quantity: 2, operationId: 'cortar' }, { componentSku: 'CAIXA', quantity: 1, operationId: null }], known)).toBeNull();
    // Suporte simples do iApp: só Dobrar e Embalar.
    expect(sheetError([{ operationId: 'dobrar', predecessorOperationId: null }, { operationId: 'embalar', predecessorOperationId: 'dobrar' }], [], known)).toBeNull();
  });
  it('recusa roteiro vazio, operação desconhecida, repetida, predecessora fora do roteiro e ciclo', () => {
    expect(sheetError([], [], known)).toMatch(/pelo menos uma/);
    expect(sheetError([{ operationId: 'soldar', predecessorOperationId: null }], [], known)).toMatch(/não encontrada/);
    expect(sheetError([...route, { operationId: 'cortar', predecessorOperationId: null }], [], known)).toMatch(/duas vezes/);
    expect(sheetError([{ operationId: 'dobrar', predecessorOperationId: 'cortar' }], [], known)).toMatch(/no roteiro da ficha/);
    expect(sheetError([{ operationId: 'cortar', predecessorOperationId: 'dobrar' }, { operationId: 'dobrar', predecessorOperationId: 'cortar' }], [], known)).toMatch(/ciclo/);
  });
  it('recusa componente fora do roteiro ou repetido no mesmo passo', () => {
    expect(sheetError(route, [{ componentSku: 'X', quantity: 1, operationId: 'soldar' }], known)).toMatch(/fora do roteiro/);
    expect(sheetError(route, [{ componentSku: 'X', quantity: 1, operationId: 'cortar' }, { componentSku: 'X', quantity: 2, operationId: 'cortar' }], known)).toMatch(/repetido/);
  });
});
