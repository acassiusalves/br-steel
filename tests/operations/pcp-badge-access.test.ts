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
    async create(name, badge) { calls.created = [name, badge]; return { userId: `cracha-${badge.toLowerCase()}`, initialPassword: '480215', expiresAt: 1 }; },
    async reset(userId) { calls.reset = userId; return { userId, initialPassword: '730164', expiresAt: 2 }; },
  };
  return { ops: createEngineeringOperations(repo, accounts), calls };
}
const workerInput = (badge: string, userId: string | null = null) => ({ name: 'Ruan', badge, kind: 'Líder', active: true, userId, operationIds: [] });

describe('acesso pelo crachá no cadastro de funcionários', () => {
  it('o administrador cria o acesso, recebe o PIN uma vez e o funcionário fica vinculado ao login', async () => {
    const { ops, calls } = setup({ badge: 'ab-1' });
    const result = await ops.createBadgeAccess(context('Administrador'), ID);
    expect(result.data).toEqual({ userId: 'cracha-ab-1', badge: 'AB-1', initialPassword: '480215', expiresAt: 1 });
    expect(calls.created).toEqual(['Ruan', 'AB-1']);
    expect(calls.saved).toEqual([ID, { name: 'Ruan', badge: 'AB-1', kind: 'Líder', active: true, userId: 'cracha-ab-1', operationIds: [] }]);
  });
  it('recusa quem não é administrador, funcionário já vinculado ou sem crachá válido', async () => {
    await expect(setup().ops.createBadgeAccess(context('Operador'), ID)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(setup({ userId: 'outro' }).ops.createBadgeAccess(context('Administrador'), ID)).rejects.toMatchObject({ code: 'ALREADY_LINKED' });
    await expect(setup({ badge: ' ' }).ops.createBadgeAccess(context('Administrador'), ID)).rejects.toMatchObject({ code: 'NO_BADGE' });
  });
  it('não cria acesso quando o login do mesmo crachá já está vinculado a outro funcionário', async () => {
    const holder: Worker = { id: OTHER, name: 'Antigo', badge: 'X', kind: 'Líder', active: false, userId: 'cracha-26557', operationIds: [] };
    const { ops, calls } = setup({}, [holder]);
    await expect(ops.createBadgeAccess(context('Administrador'), ID)).rejects.toMatchObject({ code: 'BADGE_TAKEN' });
    expect(calls.created).toBeUndefined();
  });
  it('o reset vale só para funcionário com login e devolve o PIN novo', async () => {
    const linked = setup({ userId: 'cracha-26557' });
    expect((await linked.ops.resetBadgePassword(context('Administrador'), ID)).data).toEqual({ initialPassword: '730164', expiresAt: 2 });
    expect(linked.calls.reset).toBe('cracha-26557');
    await expect(setup().ops.resetBadgePassword(context('Administrador'), ID)).rejects.toMatchObject({ code: 'NOT_LINKED' });
  });
});

describe('crachá no cadastro do funcionário', () => {
  it('grava o crachá normalizado e recusa código fora do padrão com mensagem clara', async () => {
    const { ops, calls } = setup();
    await ops.saveWorker(context('Administrador'), null, workerInput(' ab-7 '));
    expect((calls.saved as [null, { badge: string }])[1].badge).toBe('AB-7');
    for (const bad of ['12 34', 'Çx', 'A'.repeat(41), '']) {
      await expect(ops.saveWorker(context('Administrador'), null, workerInput(bad))).rejects.toMatchObject({ code: 'INVALID_BADGE' });
    }
  });
  it('não troca o código de quem já entra pelo crachá, mas aceita editar o resto', async () => {
    const { ops, calls } = setup({ badge: '26557', userId: 'cracha-26557' });
    await expect(ops.saveWorker(context('Administrador'), ID, workerInput('30001', 'cracha-26557'))).rejects.toMatchObject({ code: 'BADGE_HAS_LOGIN' });
    expect(calls.saved).toBeUndefined();
    await ops.saveWorker(context('Administrador'), ID, { ...workerInput('26557', 'cracha-26557'), kind: 'Supervisor' });
    expect((calls.saved as [string, { kind: string }])[1].kind).toBe('Supervisor');
  });
  it('troca o código livremente quando o funcionário não tem login pelo crachá', async () => {
    const { ops, calls } = setup({ badge: '26557', userId: null });
    await ops.saveWorker(context('Administrador'), ID, workerInput('30001'));
    expect((calls.saved as [string, { badge: string }])[1].badge).toBe('30001');
  });
});
