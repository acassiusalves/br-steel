import { describe, expect, it } from 'vitest';
import { createEngineeringOperations } from '@/server/operations/engineering';
import type { BadgeAccounts } from '@/server/access/badges';
import type { EngineeringRepository, Worker } from '@/server/persistence/pcp-engineering-contract';
import { context } from './fixtures';

const ID = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

function setup(worker: Partial<Worker> = {}, others: Worker[] = []) {
  const calls: { saved?: unknown; created?: [string, string]; reset?: string } = {};
  const w: Worker = { id: ID, name: 'Ruan', badge: '26557', kind: 'Líder', active: true, userId: null, operationIds: [], ...worker };
  const repo = {
    async read() { return { data: { workers: [w, ...others] } } as never; },
    async saveWorker(id: string | null, input: unknown) { calls.saved = [id, input]; return { data: { id: ID } } as never; },
  } as unknown as EngineeringRepository;
  const accounts: BadgeAccounts = {
    async create(name, badge) { calls.created = [name, badge]; return { userId: `cracha-${badge.toLowerCase()}`, pin: '482913', adopted: false }; },
    async reset(userId) { calls.reset = userId; return { pin: '730164' }; },
  };
  return { ops: createEngineeringOperations(repo, accounts), calls };
}
const workerInput = (over: Partial<Worker> = {}) => ({ name: 'Ruan', badge: '26557', kind: 'Líder', active: true, userId: null, operationIds: [], ...over });

describe('acesso pelo crachá no cadastro de funcionários', () => {
  it('o administrador cria o acesso, recebe o PIN uma vez e o funcionário fica vinculado ao login', async () => {
    const { ops, calls } = setup();
    const result = await ops.createBadgeAccess(context('Administrador'), ID);
    expect(result.data).toEqual({ userId: 'cracha-26557', badge: '26557', pin: '482913', adopted: false });
    expect(calls.created).toEqual(['Ruan', '26557']);
    expect(calls.saved).toEqual([ID, { name: 'Ruan', badge: '26557', kind: 'Líder', active: true, userId: 'cracha-26557', operationIds: [] }]);
  });
  it('recusa quem não é administrador, funcionário já vinculado, sem crachá válido ou crachá cujo login é de outro funcionário', async () => {
    await expect(setup().ops.createBadgeAccess(context('Operador'), ID)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(setup({ userId: 'outro' }).ops.createBadgeAccess(context('Administrador'), ID)).rejects.toMatchObject({ code: 'ALREADY_LINKED' });
    await expect(setup({ badge: ' ' }).ops.createBadgeAccess(context('Administrador'), ID)).rejects.toMatchObject({ code: 'NO_BADGE' });
    const other: Worker = { id: OTHER, name: 'Antigo', badge: '99999', kind: 'Líder', active: false, userId: 'cracha-26557', operationIds: [] };
    const taken = setup({}, [other]);
    await expect(taken.ops.createBadgeAccess(context('Administrador'), ID)).rejects.toMatchObject({ code: 'LINKED_ELSEWHERE' });
    expect(taken.calls.created).toBeUndefined();
  });
  it('o reset vale só para funcionário com login e devolve um PIN novo', async () => {
    const linked = setup({ userId: 'cracha-26557' });
    expect((await linked.ops.resetBadgePassword(context('Administrador'), ID)).data).toEqual({ pin: '730164' });
    expect(linked.calls.reset).toBe('cracha-26557');
    await expect(setup().ops.resetBadgePassword(context('Administrador'), ID)).rejects.toMatchObject({ code: 'NOT_LINKED' });
  });
});

describe('código do crachá no cadastro', () => {
  it('grava o crachá normalizado e recusa formato que o login e a bipagem não leem', async () => {
    const { ops, calls } = setup();
    await ops.saveWorker(context('Administrador'), null, workerInput({ badge: ' ab-07 ' }));
    expect(calls.saved).toEqual([null, workerInput({ badge: 'AB-07' })]);
    for (const badge of ['12 34', 'crachá', 'x'.repeat(41), '']) {
      await expect(setup().ops.saveWorker(context('Administrador'), null, workerInput({ badge }))).rejects.toThrow(/Crachá inválido|String/);
    }
  });
  it('não deixa trocar o crachá de quem entra pelo crachá; mantém zeros à esquerda', async () => {
    const linked = setup({ badge: '012', userId: 'cracha-012' });
    await expect(linked.ops.saveWorker(context('Administrador'), ID, workerInput({ badge: '12', userId: 'cracha-012' }))).rejects.toMatchObject({ code: 'BADGE_LOCKED' });
    await expect(linked.ops.saveWorker(context('Administrador'), ID, workerInput({ badge: '013', userId: null }))).rejects.toMatchObject({ code: 'BADGE_LOCKED' });
    await linked.ops.saveWorker(context('Administrador'), ID, workerInput({ badge: '012', name: 'Ruan Silva', userId: 'cracha-012' }));
    expect(linked.calls.saved).toEqual([ID, workerInput({ badge: '012', name: 'Ruan Silva', userId: 'cracha-012' })]);
    const unlinked = setup({ badge: '012' });
    await unlinked.ops.saveWorker(context('Administrador'), ID, workerInput({ badge: '013' }));
    expect(unlinked.calls.saved).toEqual([ID, workerInput({ badge: '013' })]);
  });
});
