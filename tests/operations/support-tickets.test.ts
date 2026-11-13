import { describe, expect, it } from 'vitest';
import { createSupportTicketOperations, RATE_LIMIT, sanitizeJson, ticketFingerprint } from '@/server/operations/support-tickets';
import type { NewTicket, SupportTicketRepository, TicketRateLimit } from '@/server/persistence/support-tickets-contract';
import { matchesTicketNumber, formatTicketNumber, type SupportTicket } from '@/types/support-tickets';
import { context } from './fixtures';

const ID = '00000000-0000-4000-8000-000000000001';

function fakeRepository() {
  const calls: { create?: { input: NewTicket; rateLimit: TicketRateLimit }; list?: (string | null)[]; status?: unknown[]; reopen?: unknown[] } = { list: [] };
  const repo: SupportTicketRepository = {
    async list(uid) { calls.list!.push(uid); return [] as SupportTicket[]; },
    async create(input, rateLimit) { calls.create = { input, rateLimit }; return { id: ID, ticketNumber: 7, fingerprint: input.fingerprint, category: input.category }; },
    async setStatus(id, status, by) { calls.status = [id, status, by]; return {} as SupportTicket; },
    async reopen(id, details, by) { calls.reopen = [id, details, by]; return {} as SupportTicket; },
  };
  return { repo, calls };
}
const withPerson = (role: string) => { const ctx = context(role); ctx.actor = { ...ctx.actor, userId: `u-${role}`, name: `Nome ${role}`, email: `${role}@example.test` }; return ctx; };

describe('reportes (cópia do Calculaqui)', () => {
  it('cada usuário vê só os seus; o administrador vê todos e pode gerenciar', async () => {
    const { repo, calls } = fakeRepository(); const ops = createSupportTicketOperations(repo);
    expect((await ops.list(withPerson('Operador'), 'mine')).data.scope).toEqual({ mode: 'own', canManage: false });
    expect((await ops.list(withPerson('Administrador'), 'admin')).data.scope).toEqual({ mode: 'all', canManage: true });
    expect(calls.list).toEqual(['u-Operador', null]);
    await expect(ops.list(withPerson('Vendedor'), 'admin')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('envio grava autor da sessão, fingerprint e limite só para quem não é administrador', async () => {
    const { repo, calls } = fakeRepository(); const ops = createSupportTicketOperations(repo);
    const created = await ops.create(withPerson('Vendedor'), {
      category: 'error', description: '  Botão de salvar não responde  ', context: { pathname: '/estoque' },
      logs: [{ timestamp: 't', level: 'error', source: 'console.error', message: 'Falha' }], breadcrumbs: [], domainContext: {},
    });
    expect(created.data.ticketNumber).toBe(7);
    expect(calls.create!.input).toMatchObject({ description: 'Botão de salvar não responde',
      createdBy: { uid: 'u-Vendedor', name: 'Nome Vendedor', email: 'Vendedor@example.test', role: 'Vendedor' } });
    expect(calls.create!.input.fingerprint).toBe(ticketFingerprint('error', { pathname: '/estoque' }, calls.create!.input.logs, 'x'));
    expect(calls.create!.rateLimit).toEqual(RATE_LIMIT);
    await ops.create(withPerson('Administrador'), { category: 'improvement', description: 'Exportar em PDF' });
    expect(calls.create!.rateLimit).toBeNull();
    await expect(ops.create(withPerson('Vendedor'), { category: 'error', description: '   ' })).rejects.toThrow();
  });

  it('só o administrador muda a situação; reabrir exige explicação', async () => {
    const { repo, calls } = fakeRepository(); const ops = createSupportTicketOperations(repo);
    await expect(ops.setStatus(withPerson('Operador'), { id: ID, status: 'resolved' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await ops.setStatus(withPerson('Administrador'), { id: ID, status: 'in_progress' });
    expect(calls.status?.slice(0, 2)).toEqual([ID, 'in_progress']);
    await expect(ops.reopen(withPerson('Operador'), { id: ID, details: ' ' })).rejects.toThrow();
    await ops.reopen(withPerson('Operador'), { id: ID, details: 'Ainda acontece no celular' });
    expect(calls.reopen?.slice(0, 2)).toEqual([ID, 'Ainda acontece no celular']);
  });

  it('fingerprint agrupa o mesmo erro na mesma página', () => {
    const log = [{ timestamp: 'a', level: 'error' as const, source: 'x', message: 'TypeError: x', stack: 'TypeError: x\n at y' }];
    expect(ticketFingerprint('error', { pathname: '/a' }, log, 'um')).toBe(ticketFingerprint('error', { pathname: '/a' }, log, 'outro'));
    expect(ticketFingerprint('error', { pathname: '/a' }, log, 'um')).not.toBe(ticketFingerprint('error', { pathname: '/b' }, log, 'um'));
    expect(ticketFingerprint('error', {}, [], 'um')).toHaveLength(20);
  });

  it('limpa JSON enviado pelo navegador e reconhece o número do chamado', () => {
    expect(sanitizeJson({ a: 'x'.repeat(10), b: [1, 2, 3], c: { d: { e: 1 } } }, { maxDepth: 2, maxArrayLength: 2, maxStringLength: 4 }))
      .toEqual({ a: 'xxxx...', b: [2, 3], c: { d: null } });
    expect(formatTicketNumber(42)).toBe('#42');
    expect(matchesTicketNumber(42, '#42')).toBe(true);
    expect(matchesTicketNumber(42, 'abc')).toBe(false);
  });
});
