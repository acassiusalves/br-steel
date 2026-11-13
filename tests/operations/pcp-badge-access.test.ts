import { describe, expect, it } from 'vitest';
import { createEngineeringOperations } from '@/server/operations/engineering';
import type { BadgeAccounts } from '@/server/access/badges';
import type { EngineeringRepository, Worker } from '@/server/persistence/pcp-engineering-contract';
import { context } from './fixtures';

const ID = '00000000-0000-4000-8000-000000000001';

function setup(worker: Partial<Worker> = {}) {
  const calls: { saved?: unknown; created?: [string, string]; reset?: string } = {};
  const w: Worker = { id: ID, name: 'Ruan', badge: '26557', kind: 'Líder', active: true, userId: null, operationIds: [], ...worker };
  const repo = {
    async read() { return { data: { workers: [w] } } as never; },
    async saveWorker(id: string | null, input: unknown) { calls.saved = [id, input]; return { data: { id: ID } } as never; },
  } as unknown as EngineeringRepository;
  const accounts: BadgeAccounts = {
    async create(name, badge) { calls.created = [name, badge]; return { userId: `cracha-${badge}` }; },
    async reset(userId) { calls.reset = userId; },
  };
  return { ops: createEngineeringOperations(repo, accounts), calls };
}

describe('acesso pelo crachá no cadastro de funcionários', () => {
  it('o administrador cria o acesso e o funcionário fica vinculado ao login', async () => {
    const { ops, calls } = setup();
    const result = await ops.createBadgeAccess(context('Administrador'), ID);
    expect(result.data).toEqual({ userId: 'cracha-26557', badge: '26557' });
    expect(calls.created).toEqual(['Ruan', '26557']);
    expect(calls.saved).toEqual([ID, { name: 'Ruan', badge: '26557', kind: 'Líder', active: true, userId: 'cracha-26557', operationIds: [] }]);
  });
  it('recusa quem não é administrador, funcionário já vinculado ou sem crachá válido', async () => {
    await expect(setup().ops.createBadgeAccess(context('Operador'), ID)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(setup({ userId: 'outro' }).ops.createBadgeAccess(context('Administrador'), ID)).rejects.toMatchObject({ code: 'ALREADY_LINKED' });
    await expect(setup({ badge: ' ' }).ops.createBadgeAccess(context('Administrador'), ID)).rejects.toMatchObject({ code: 'NO_BADGE' });
  });
  it('o reset vale só para funcionário com login', async () => {
    const linked = setup({ userId: 'cracha-26557' });
    await linked.ops.resetBadgePassword(context('Administrador'), ID);
    expect(linked.calls.reset).toBe('cracha-26557');
    await expect(setup().ops.resetBadgePassword(context('Administrador'), ID)).rejects.toMatchObject({ code: 'NOT_LINKED' });
  });
});
