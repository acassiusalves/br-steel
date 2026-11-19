import { describe, expect, it } from 'vitest';
import { createEngineeringOperations } from '@/server/operations/engineering';
import type { BadgeAccounts } from '@/server/access/badges';
import { OperationError } from '@/server/operations/common';
import type { EngineeringRepository, Worker } from '@/server/persistence/pcp-engineering-contract';
import { context } from './fixtures';

const ID = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

type Account = { role: string; active: boolean; badge: string | null };
type Options = { linkFails?: boolean; deactivateFails?: boolean; changeFails?: boolean; accounts?: Record<string, Account> };
function setup(worker: Partial<Worker> = {}, others: Worker[] = [], options: Options = {}) {
  const calls: {
    saved?: unknown; linked?: unknown; created?: [string, string, string]; reset?: [string, string]; deactivated: string[];
    renamed: [string, string][]; moved?: [string, string]; undone?: [string, string]; changed?: unknown;
  } = { deactivated: [], renamed: [] };
  const w: Worker = { id: ID, name: 'Ruan', badge: '26557', kind: 'Líder', active: true, userId: null, operationIds: [], ...worker };
  const repo = {
    async read() { return { data: { workers: [w, ...others] } } as never; },
    async saveWorker(id: string | null, input: unknown) { calls.saved = [id, input]; return { data: { id: ID } } as never; },
    async linkWorkerUser(workerId: string, userId: string, badge: string) {
      if (options.linkFails) throw new OperationError('LINK_CONFLICT', 'O funcionário mudou enquanto o acesso era criado.', 409);
      calls.linked = [workerId, userId, badge]; return { data: { id: workerId } } as never;
    },
    async changeWorkerBadge(workerId: string, fromUserId: string, toUserId: string, badge: string) {
      if (options.changeFails) throw new OperationError('LINK_CONFLICT', 'O funcionário mudou enquanto o crachá era trocado.', 409);
      calls.changed = [workerId, fromUserId, toUserId, badge]; return { data: { id: workerId } } as never;
    },
  } as unknown as EngineeringRepository;
  const accounts: BadgeAccounts = {
    async create(name, badge, actor) { calls.created = [name, badge, actor]; return { userId: `cracha-${badge.toLowerCase()}`, pin: '482913', adopted: false }; },
    async reset(userId, actor) { calls.reset = [userId, actor]; return { pin: '730164' }; },
    async deactivate(userId) {
      if (options.deactivateFails) throw new Error('Firestore indisponível');
      calls.deactivated.push(userId); return true;
    },
    async describe(userId) { return options.accounts?.[userId] ?? null; },
    async rename(userId, name) { calls.renamed.push([userId, name]); return true; },
    async moveBadge(fromUserId, badge) { calls.moved = [fromUserId, badge]; return { userId: `cracha-${badge.toLowerCase()}` }; },
    async undoMove(toUserId, fromUserId) { calls.undone = [toUserId, fromUserId]; },
  };
  return { ops: createEngineeringOperations(repo, accounts), calls };
}
const workerInput = (over: Partial<Worker> = {}) => ({ name: 'Ruan', badge: '26557', kind: 'Líder', active: true, userId: null, operationIds: [], ...over });
const admin = () => context('Administrador');

describe('acesso pelo crachá no cadastro de funcionários', () => {
  it('o administrador cria o acesso, recebe o PIN uma vez e o vínculo é gravado só no campo do login', async () => {
    const { ops, calls } = setup();
    const result = await ops.createBadgeAccess(admin(), ID);
    expect(result.data).toEqual({ userId: 'cracha-26557', badge: '26557', pin: '482913', adopted: false });
    expect(calls.created?.slice(0, 2)).toEqual(['Ruan', '26557']);
    expect(calls.created?.[2]).toEqual(expect.any(String));
    expect(calls.linked).toEqual([ID, 'cracha-26557', '26557']);
    expect(calls.saved).toBeUndefined();
  });
  it('se o vínculo falha, a conta recém-criada é desativada e o erro chega ao administrador', async () => {
    const { ops, calls } = setup({}, [], { linkFails: true });
    await expect(ops.createBadgeAccess(admin(), ID)).rejects.toMatchObject({ code: 'LINK_CONFLICT' });
    expect(calls.deactivated).toEqual(['cracha-26557']);
  });
  it('recusa quem não é administrador, funcionário inativo, já vinculado, sem crachá válido ou com login de outro', async () => {
    await expect(setup().ops.createBadgeAccess(context('Operador'), ID)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(setup({ active: false }).ops.createBadgeAccess(admin(), ID)).rejects.toMatchObject({ code: 'WORKER_INACTIVE' });
    await expect(setup({ userId: 'outro' }).ops.createBadgeAccess(admin(), ID)).rejects.toMatchObject({ code: 'ALREADY_LINKED' });
    await expect(setup({ badge: ' ' }).ops.createBadgeAccess(admin(), ID)).rejects.toMatchObject({ code: 'NO_BADGE' });
    const other: Worker = { id: OTHER, name: 'Antigo', badge: '99999', kind: 'Líder', active: false, userId: 'cracha-26557', operationIds: [] };
    const taken = setup({}, [other]);
    await expect(taken.ops.createBadgeAccess(admin(), ID)).rejects.toMatchObject({ code: 'LINKED_ELSEWHERE' });
    expect(taken.calls.created).toBeUndefined();
  });
  it('o reset vale só para funcionário ativo com login e devolve um PIN novo', async () => {
    const linked = setup({ userId: 'cracha-26557' });
    expect((await linked.ops.resetBadgePassword(admin(), ID)).data).toEqual({ pin: '730164' });
    expect(linked.calls.reset?.[0]).toBe('cracha-26557');
    await expect(setup().ops.resetBadgePassword(admin(), ID)).rejects.toMatchObject({ code: 'NOT_LINKED' });
    await expect(setup({ userId: 'cracha-26557', active: false }).ops.resetBadgePassword(admin(), ID)).rejects.toMatchObject({ code: 'WORKER_INACTIVE' });
  });
});

describe('código do crachá no cadastro', () => {
  it('grava o crachá normalizado e recusa formato que o login e a bipagem não leem', async () => {
    const { ops, calls } = setup();
    await ops.saveWorker(admin(), null, workerInput({ badge: ' ab-07 ' }));
    expect(calls.saved).toEqual([null, workerInput({ badge: 'AB-07' })]);
    for (const badge of ['12 34', 'crachá', 'x'.repeat(41), '']) {
      await expect(setup().ops.saveWorker(admin(), null, workerInput({ badge }))).rejects.toThrow(/Crachá inválido|String/);
    }
  });
  it('não deixa trocar o crachá de quem entra pelo crachá; mantém zeros à esquerda', async () => {
    const linked = setup({ badge: '012', userId: 'cracha-012' });
    await expect(linked.ops.saveWorker(admin(), ID, workerInput({ badge: '12', userId: 'cracha-012' }))).rejects.toMatchObject({ code: 'BADGE_LOCKED' });
    await expect(linked.ops.saveWorker(admin(), ID, workerInput({ badge: '013', userId: null }))).rejects.toMatchObject({ code: 'BADGE_LOCKED' });
    await linked.ops.saveWorker(admin(), ID, workerInput({ badge: '012', name: 'Ruan Silva', userId: 'cracha-012' }));
    expect(linked.calls.saved).toEqual([ID, workerInput({ badge: '012', name: 'Ruan Silva', userId: 'cracha-012' })]);
    const unlinked = setup({ badge: '012' });
    await unlinked.ops.saveWorker(admin(), ID, workerInput({ badge: '013' }));
    expect(unlinked.calls.saved).toEqual([ID, workerInput({ badge: '013' })]);
  });
});

describe('o login pelo crachá acompanha o funcionário', () => {
  it('formulário sem o campo de login mantém o vínculo e não desativa nada', async () => {
    const { ops, calls } = setup({ userId: 'cracha-26557' });
    const { userId: _omit, ...withoutLogin } = workerInput({ kind: 'Supervisor' });
    void _omit;
    await ops.saveWorker(admin(), ID, withoutLogin);
    expect(calls.saved).toEqual([ID, withoutLogin]);
    expect(calls.deactivated).toEqual([]);
  });
  it('inativar o funcionário desativa o login pelo crachá', async () => {
    const { ops, calls } = setup({ userId: 'cracha-26557' });
    await ops.saveWorker(admin(), ID, workerInput({ active: false, userId: 'cracha-26557' }));
    expect(calls.deactivated).toEqual(['cracha-26557']);
  });
  it('desvincular desativa o login pelo crachá, mas não mexe em login de e-mail', async () => {
    const badge = setup({ userId: 'cracha-26557' });
    await badge.ops.saveWorker(admin(), ID, workerInput({ userId: null }));
    expect(badge.calls.deactivated).toEqual(['cracha-26557']);
    const email = setup({ userId: 'conta-de-email' });
    await email.ops.saveWorker(admin(), ID, workerInput({ userId: null }));
    expect(email.calls.deactivated).toEqual([]);
  });
  it('se a desativação falha, avisa que o funcionário foi salvo e o login continua ativo', async () => {
    const { ops, calls } = setup({ userId: 'cracha-26557' }, [], { deactivateFails: true });
    await expect(ops.saveWorker(admin(), ID, workerInput({ active: false, userId: 'cracha-26557' }))).rejects.toMatchObject({ code: 'LOGIN_STILL_ACTIVE' });
    expect(calls.saved).toBeDefined();
  });
});

describe('trocar o crachá de quem já tem login', () => {
  it('leva o login para o código novo e grava crachá e login juntos no funcionário', async () => {
    const { ops, calls } = setup({ badge: '012', userId: 'cracha-012' });
    const result = await ops.changeBadgeLogin(admin(), ID, { badge: ' 0000012345 ' });
    expect(result.data).toEqual({ userId: 'cracha-0000012345', badge: '0000012345' });
    expect(calls.moved).toEqual(['cracha-012', '0000012345']);
    expect(calls.changed).toEqual([ID, 'cracha-012', 'cracha-0000012345', '0000012345']);
    expect(calls.undone).toBeUndefined();
  });
  it('se o cadastro não acompanha, o login volta para o crachá antigo', async () => {
    const { ops, calls } = setup({ badge: '012', userId: 'cracha-012' }, [], { changeFails: true });
    await expect(ops.changeBadgeLogin(admin(), ID, { badge: '013' })).rejects.toMatchObject({ code: 'LINK_CONFLICT' });
    expect(calls.undone).toEqual(['cracha-013', 'cracha-012']);
  });
  it('recusa quem não entra pelo crachá, código igual, inválido ou de outro funcionário', async () => {
    await expect(setup({ badge: '012' }).ops.changeBadgeLogin(admin(), ID, { badge: '013' })).rejects.toMatchObject({ code: 'NOT_BADGE' });
    await expect(setup({ badge: '012', userId: 'cracha-012' }).ops.changeBadgeLogin(admin(), ID, { badge: '012' })).rejects.toMatchObject({ code: 'SAME_BADGE' });
    await expect(setup({ badge: '012', userId: 'cracha-012' }).ops.changeBadgeLogin(admin(), ID, { badge: '12 3' })).rejects.toThrow(/Crachá inválido|String/);
    const other: Worker = { id: OTHER, name: 'Outro', badge: '013', kind: 'Líder', active: true, userId: null, operationIds: [] };
    const taken = setup({ badge: '012', userId: 'cracha-012' }, [other]);
    await expect(taken.ops.changeBadgeLogin(admin(), ID, { badge: '013' })).rejects.toMatchObject({ code: 'DUPLICATE' });
    expect(taken.calls.moved).toBeUndefined();
    await expect(setup({ badge: '012', userId: 'cracha-012' }).ops.changeBadgeLogin(context('Operador'), ID, { badge: '013' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('vínculo escolhido à mão e nome do login', () => {
  const accounts: Record<string, Account> = {
    'conta-operador': { role: 'Operador', active: true, badge: null },
    'conta-vendedor': { role: 'Vendedor', active: true, badge: null },
    'conta-inativa': { role: 'Operador', active: false, badge: null },
    'cracha-99999': { role: 'Produção', active: true, badge: '99999' },
    'cracha-26557': { role: 'Produção', active: true, badge: '26557' },
  };
  it('só vincula login que existe, está ativo, age no Kanban e, se for de crachá, é do mesmo crachá', async () => {
    const ops = () => setup({}, [], { accounts }).ops;
    await expect(ops().saveWorker(admin(), ID, workerInput({ userId: 'sumiu' }))).rejects.toMatchObject({ code: 'LOGIN_NOT_FOUND' });
    await expect(ops().saveWorker(admin(), ID, workerInput({ userId: 'conta-inativa' }))).rejects.toMatchObject({ code: 'LOGIN_INACTIVE' });
    await expect(ops().saveWorker(admin(), ID, workerInput({ userId: 'conta-vendedor' }))).rejects.toMatchObject({ code: 'LOGIN_ROLE' });
    await expect(ops().saveWorker(admin(), ID, workerInput({ userId: 'cracha-99999' }))).rejects.toMatchObject({ code: 'LOGIN_OTHER_BADGE' });
    await expect(ops().saveWorker(admin(), null, workerInput({ userId: 'cracha-99999' }))).rejects.toMatchObject({ code: 'LOGIN_OTHER_BADGE' });
    const ok = setup({}, [], { accounts });
    await ok.ops.saveWorker(admin(), ID, workerInput({ userId: 'conta-operador' }));
    expect((ok.calls.saved as [string, { userId: string }])[1].userId).toBe('conta-operador');
    const sameBadge = setup({}, [], { accounts });
    await sameBadge.ops.saveWorker(admin(), ID, workerInput({ userId: 'cracha-26557' }));
    expect(sameBadge.calls.saved).toBeDefined();
  });
  it('o nome do login de crachá acompanha o cadastro do funcionário', async () => {
    const { ops, calls } = setup({ userId: 'cracha-26557' }, [], { accounts });
    await ops.saveWorker(admin(), ID, workerInput({ name: 'Ruan Silva', userId: 'cracha-26557' }));
    expect(calls.renamed).toEqual([['cracha-26557', 'Ruan Silva']]);
    const email = setup({ userId: 'conta-operador' }, [], { accounts });
    await email.ops.saveWorker(admin(), ID, workerInput({ name: 'Ruan Silva', userId: 'conta-operador' }));
    expect(email.calls.renamed).toEqual([]);
  });
});
