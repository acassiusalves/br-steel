import 'server-only';
import { z } from 'zod';
import type { AccessContext } from '@/server/access/types';
import type { EngineeringRepository } from '@/server/persistence/pcp-engineering-contract';
import { engineeringRepository } from '@/server/persistence/pcp-engineering';
import type { WriteActor } from '@/server/persistence/write-audit';
import { firestoreBadgeAccounts, normalizeBadge, type BadgeAccounts } from '@/server/access/badges';
import { dateSchema, requireOperation, OperationError } from './common';

export const ENGINEERING_PAGE = '/producao/engenharia';

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(200);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido.');
const idInput = uuid.nullable().optional().transform(v => v ?? null);

const lineSchema = z.object({
  name, monthlyCapacity: z.number().int().min(0).max(1_000_000), active: z.boolean(),
  phases: z.array(z.object({ id: uuid.optional(), name }).strict()).min(1).max(50)
    .refine(list => new Set(list.map(p => p.name.toLowerCase())).size === list.length, 'Fases com nomes repetidos.'),
}).strict();
const operationSchema = z.object({
  code: z.string().trim().min(1).max(50), name, phaseId: uuid, position: z.number().int().min(0).max(1000),
  predecessorId: uuid.nullable(), location: z.enum(['interno', 'externo']),
  classification: z.string().trim().min(1).max(100).nullable(), defaultWorkerId: uuid.nullable(), active: z.boolean(),
}).strict();
const operationIds = z.array(uuid).max(200).transform(list => [...new Set(list)]);
const teamSchema = z.object({
  name, status: z.enum(['aberto', 'inativo', 'fechado']), shift: z.enum(['manha', 'tarde', 'noite', 'integral']),
  leaderId: uuid.nullable(), operationIds,
  members: z.array(z.object({ workerId: uuid, leaderId: uuid.nullable() }).strict()).max(200),
}).strict();
const workerSchema = z.object({
  name, badge: z.string().trim().min(1).max(50), kind: z.string().trim().min(1).max(100), active: z.boolean(),
  userId: z.string().trim().min(1).max(200).nullable(), operationIds,
}).strict();
const periodsSchema = z.array(z.object({ weekday: z.number().int().min(0).max(6), startsAt: time, endsAt: time }).strict()).max(70);
const holidaySchema = z.object({ day: dateSchema, name }).strict();
const lossReasonSchema = z.object({ name, active: z.boolean() }).strict();
const quantity = z.number().finite().positive().max(1_000_000);
const sheetSchema = z.object({
  code: z.string().trim().min(1).max(50), sku: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(300),
  status: z.enum(['aberto', 'aberto_avulso', 'bloqueado', 'suspenso', 'versao_revisada', 'fechado', 'amostra']),
  baseQuantity: quantity, lineId: uuid.nullable(),
  steps: z.array(z.object({ operationId: uuid, predecessorOperationId: uuid.nullable(),
    plannedMinutes: z.number().finite().min(0).max(1_000_000).nullable(), notes: z.string().trim().max(2000).nullable() }).strict()).min(1).max(50),
  components: z.array(z.object({ componentSku: z.string().trim().min(1).max(100), componentName: z.string().trim().max(300).nullable(),
    quantity, operationId: uuid.nullable() }).strict()).max(200),
}).strict();

const writeActor = (context: AccessContext): WriteActor => ({
  userId: context.actor.userId, source: context.actor.source, clientId: context.actor.clientId ?? null, idempotencyKey: null,
});

/**
 * Cadastros de engenharia do PCP. Leitura para quem acessa a produção; gravação só para Administrador,
 * porque estes cadastros definem as regras que valem para todos no Kanban.
 */
export function createEngineeringOperations(repository: EngineeringRepository, accounts: BadgeAccounts = firestoreBadgeAccounts) {
  const write = (ctx: AccessContext) => {
    requireOperation(ctx, 'producao:write', ENGINEERING_PAGE);
    if (ctx.actor.role !== 'Administrador') throw new OperationError('FORBIDDEN', 'Só administradores alteram os cadastros de engenharia.', 403);
    return writeActor(ctx);
  };
  const findWorker = async (id: string) => {
    const worker = (await repository.read()).data.workers.find(w => w.id === id);
    if (!worker) throw new OperationError('NOT_FOUND', 'Funcionário não encontrado.', 404);
    return worker;
  };
  return {
    async readEngineering(ctx: AccessContext) {
      requireOperation(ctx, 'producao:read', ENGINEERING_PAGE);
      return repository.read();
    },
    async saveLine(ctx: AccessContext, id: unknown, input: unknown) {
      const actor = write(ctx); return repository.saveLine(idInput.parse(id), lineSchema.parse(input), actor);
    },
    async saveOperation(ctx: AccessContext, id: unknown, input: unknown) {
      const actor = write(ctx); return repository.saveOperation(idInput.parse(id), operationSchema.parse(input), actor);
    },
    async saveTeam(ctx: AccessContext, id: unknown, input: unknown) {
      const actor = write(ctx); return repository.saveTeam(idInput.parse(id), teamSchema.parse(input), actor);
    },
    async saveWorker(ctx: AccessContext, id: unknown, input: unknown) {
      const actor = write(ctx); return repository.saveWorker(idInput.parse(id), workerSchema.parse(input), actor);
    },
    async replaceWorkPeriods(ctx: AccessContext, input: unknown) {
      const actor = write(ctx); return repository.replaceWorkPeriods(periodsSchema.parse(input), actor);
    },
    async saveHoliday(ctx: AccessContext, input: unknown) {
      const actor = write(ctx); return repository.saveHoliday(holidaySchema.parse(input), actor);
    },
    async deleteHoliday(ctx: AccessContext, day: unknown) {
      const actor = write(ctx); return repository.deleteHoliday(dateSchema.parse(day), actor);
    },
    async listSheets(ctx: AccessContext) {
      requireOperation(ctx, 'producao:read', ENGINEERING_PAGE);
      return repository.listSheets();
    },
    async getSheet(ctx: AccessContext, id: unknown) {
      requireOperation(ctx, 'producao:read', ENGINEERING_PAGE);
      return repository.getSheet(uuid.parse(id));
    },
    async saveSheet(ctx: AccessContext, id: unknown, input: unknown) {
      const actor = write(ctx); return repository.saveSheet(idInput.parse(id), sheetSchema.parse(input), actor);
    },
    async saveLossReason(ctx: AccessContext, id: unknown, input: unknown) {
      const actor = write(ctx); return repository.saveLossReason(idInput.parse(id), lossReasonSchema.parse(input), actor);
    },
    /** Cria o login do funcionário pelo crachá e já o vincula, para ele agir no Kanban de OPs. */
    async createBadgeAccess(ctx: AccessContext, id: unknown) {
      const actor = write(ctx);
      const worker = await findWorker(uuid.parse(id));
      if (worker.userId) throw new OperationError('ALREADY_LINKED', 'Este funcionário já tem um login vinculado.', 409);
      const badge = normalizeBadge(worker.badge);
      if (!badge) throw new OperationError('NO_BADGE', 'Cadastre um código de crachá válido (letras, números ou hífen) antes de criar o acesso.');
      let userId: string;
      try { ({ userId } = await accounts.create(worker.name, badge)); }
      catch (error) { throw new OperationError('BADGE_TAKEN', error instanceof Error ? error.message : 'Não foi possível criar o acesso.', 409); }
      const { id: workerId, ...fields } = worker;
      await repository.saveWorker(workerId, { ...fields, userId }, actor);
      return { data: { userId, badge }, source: 'postgres' as const, asOf: new Date().toISOString(), warnings: [], nextCursor: null };
    },
    /** Volta o login do crachá para o primeiro acesso (senha 123456 e troca obrigatória). */
    async resetBadgePassword(ctx: AccessContext, id: unknown) {
      write(ctx);
      const worker = await findWorker(uuid.parse(id));
      if (!worker.userId) throw new OperationError('NOT_LINKED', 'Este funcionário não tem login.', 409);
      try { await accounts.reset(worker.userId); }
      catch (error) { throw new OperationError('NOT_BADGE', error instanceof Error ? error.message : 'Não foi possível resetar a senha.', 409); }
      return { data: null, source: 'postgres' as const, asOf: new Date().toISOString(), warnings: [], nextCursor: null };
    },
  };
}

export const engineering = createEngineeringOperations(engineeringRepository);
