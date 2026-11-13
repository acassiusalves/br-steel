import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AccessContext } from '@/server/access/types';
import type { SupportTicketRepository, TicketRateLimit } from '@/server/persistence/support-tickets-contract';
import { supportTicketRepository } from '@/server/persistence/support-tickets';
import type { WriteActor } from '@/server/persistence/write-audit';
import type { TicketBreadcrumb, TicketCategory, TicketLog, TicketPerson } from '@/types/support-tickets';
import { OperationError, requireWebPage, result } from './common';

export const REPORTS_PAGE = '/reportes';
export const MY_REPORTS_PAGE = '/meus-reportes';
export const LIST_LIMIT = 250;
const MAX_LOGS = 25;
const MAX_BREADCRUMBS = 80;
/** Como no Calculaqui: 5 envios a cada 10 minutos. Administradores não têm limite (registram em reunião). */
export const RATE_LIMIT: TicketRateLimit = { max: 5, windowSeconds: 600 };

type Limits = { maxDepth: number; maxArrayLength: number; maxStringLength: number };
/** Os dados vêm do navegador: valores dessas chaves não são gravados, mesmo que o cliente os envie. */
const SECRET_KEY = /token|authorization|password|passwd|secret|cookie|session(?!id)|code|api[-_]?key|credential/i;
/** Tira query e fragmento de endereços (callbacks de OAuth trazem códigos ali). */
const bareUrl = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return value.split(/[?#]/)[0]; }
};

/** Copia só JSON simples, cortando profundidade, listas e textos longos. */
export function sanitizeJson(value: unknown, limits: Limits, depth = 0): unknown {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.length > limits.maxStringLength ? `${value.slice(0, limits.maxStringLength)}...` : value;
  if (depth >= limits.maxDepth) return null;
  if (Array.isArray(value)) return value.slice(-limits.maxArrayLength).map(item => sanitizeJson(item, limits, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100)
      .map(([key, item]) => [key.slice(0, 120), SECRET_KEY.test(key) ? '[removido]' : sanitizeJson(item, limits, depth + 1)]));
  }
  return null;
}
const record = (value: unknown, limits: Limits) => {
  const clean = sanitizeJson(value, limits);
  return clean && typeof clean === 'object' && !Array.isArray(clean) ? clean as Record<string, unknown> : {};
};
const list = <T>(value: unknown, limits: Limits) => {
  const clean = sanitizeJson(Array.isArray(value) ? value : [], limits);
  return (Array.isArray(clean) ? clean.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : []) as T[];
};

const logText = (log: TicketLog | undefined) => {
  if (!log) return '';
  if (typeof log.message === 'string' && log.message.trim()) return log.message.trim();
  return (log.args ?? []).map(arg => typeof arg === 'string' ? arg
    : arg && typeof arg === 'object' && typeof (arg as { message?: unknown }).message === 'string' ? (arg as { message: string }).message : '')
    .filter(Boolean).join(' ');
};

/** Agrupa repetições do mesmo problema: tipo, página, primeira mensagem de erro e primeira linha do stack. */
export function ticketFingerprint(category: TicketCategory, context: Record<string, unknown>, logs: TicketLog[], description: string) {
  const primary = logs.find(log => logText(log));
  const pathname = typeof context.pathname === 'string' ? context.pathname : '';
  const stack = typeof primary?.stack === 'string' ? primary.stack.split('\n')[0] : '';
  const base = [category, pathname, logText(primary) || description.slice(0, 240), stack].join('|');
  return createHash('sha256').update(base || 'brsteel-support-ticket').digest('hex').slice(0, 20);
}

const createSchema = z.object({
  category: z.enum(['error', 'improvement']).catch('error'),
  description: z.string().trim().min(1, 'Descreva o problema ou a melhoria.').max(4000),
  context: z.unknown().optional(), logs: z.unknown().optional(), breadcrumbs: z.unknown().optional(), domainContext: z.unknown().optional(),
}).strict();
const idSchema = z.string().uuid();
const statusSchema = z.object({ id: idSchema, status: z.enum(['pending', 'in_progress', 'resolved']) }).strict();
const reopenSchema = z.object({ id: idSchema, details: z.string().trim().min(1, 'Explique o que ainda precisa ser corrigido.').max(2000) }).strict();

const isAdmin = (ctx: AccessContext) => ctx.actor.role === 'Administrador';
const personOf = (ctx: AccessContext): TicketPerson => ({
  uid: ctx.actor.userId, email: ctx.actor.email ?? null, name: ctx.actor.name ?? null, role: ctx.actor.role,
});
const writeActor = (ctx: AccessContext): WriteActor => ({
  userId: ctx.actor.userId, source: ctx.actor.source, clientId: ctx.actor.clientId ?? null, idempotencyKey: null,
});
function requireAdmin(ctx: AccessContext) {
  requireWebPage(ctx, REPORTS_PAGE);
  if (!isAdmin(ctx)) throw new OperationError('FORBIDDEN', 'Apenas administradores podem gerenciar reportes.', 403);
}

/** Reportes: qualquer usuário envia e acompanha os seus; o administrador vê todos e muda a situação. */
export function createSupportTicketOperations(repository: SupportTicketRepository) {
  return {
    async list(ctx: AccessContext, scope: 'mine' | 'admin') {
      if (scope === 'admin') {
        requireAdmin(ctx);
        return result({ reports: await repository.list(null, LIST_LIMIT), scope: { mode: 'all' as const, canManage: true } }, 'postgres');
      }
      requireWebPage(ctx, MY_REPORTS_PAGE);
      return result({ reports: await repository.list(ctx.actor.userId, LIST_LIMIT), scope: { mode: 'own' as const, canManage: false } }, 'postgres');
    },
    async create(ctx: AccessContext, input: unknown) {
      requireWebPage(ctx, MY_REPORTS_PAGE);
      const body = createSchema.parse(input);
      const context = record(body.context, { maxDepth: 5, maxArrayLength: 50, maxStringLength: 4000 });
      for (const key of ['url', 'referrer'] as const) if (key in context) context[key] = bareUrl(context[key]);
      delete context.search;
      const logs = list<TicketLog>(body.logs, { maxDepth: 5, maxArrayLength: MAX_LOGS, maxStringLength: 8000 });
      const breadcrumbs = list<TicketBreadcrumb>(body.breadcrumbs, { maxDepth: 5, maxArrayLength: MAX_BREADCRUMBS, maxStringLength: 4000 });
      const domainContext = record(body.domainContext, { maxDepth: 5, maxArrayLength: 80, maxStringLength: 4000 });
      const created = await repository.create({
        category: body.category, description: body.description, createdBy: personOf(ctx),
        fingerprint: ticketFingerprint(body.category, context, logs, body.description), context, domainContext, logs, breadcrumbs,
      }, isAdmin(ctx) ? null : RATE_LIMIT, writeActor(ctx));
      return result(created, 'postgres');
    },
    async setStatus(ctx: AccessContext, input: unknown) {
      requireAdmin(ctx);
      const { id, status } = statusSchema.parse(input);
      return result(await repository.setStatus(id, status, personOf(ctx), writeActor(ctx)), 'postgres');
    },
    async reopen(ctx: AccessContext, input: unknown) {
      requireWebPage(ctx, MY_REPORTS_PAGE);
      const { id, details } = reopenSchema.parse(input);
      return result(await repository.reopen(id, details, personOf(ctx), writeActor(ctx)), 'postgres');
    },
  };
}

export const supportTickets = createSupportTicketOperations(supportTicketRepository);
