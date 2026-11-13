import 'server-only';
import { z } from 'zod';
import type { AccessContext } from '@/server/access/types';
import type { BoardActor, KanbanRepository } from '@/server/persistence/pcp-kanban-contract';
import { kanbanRepository } from '@/server/persistence/pcp-kanban';
import { requireOperation } from './common';

export const BOARD_PAGE = '/producao/quadro';

const uuid = z.string().uuid();
const target = z.union([uuid, z.literal('concluido')]);
const finishSchema = z.object({
  lossQuantity: z.number().finite().min(0).max(1_000_000).default(0),
  lossReasonId: uuid.nullable().default(null),
  notes: z.string().trim().max(2000).nullable().transform(v => v || null).default(null),
}).strict();

const boardActor = (ctx: AccessContext): BoardActor => ({
  userId: ctx.actor.userId, source: ctx.actor.source, clientId: ctx.actor.clientId ?? null, idempotencyKey: null,
  isAdmin: ctx.actor.role === 'Administrador',
});

/**
 * Kanban de OPs. Ler e agir exigem acesso à produção; quem pode mover, iniciar ou finalizar cada card
 * é decidido pelas regras do quadro, a partir do funcionário vinculado ao usuário da sessão.
 */
export function createKanbanOperations(repository: KanbanRepository) {
  return {
    async board(ctx: AccessContext) {
      requireOperation(ctx, 'producao:read', BOARD_PAGE);
      return repository.board(boardActor(ctx));
    },
    async move(ctx: AccessContext, input: unknown) {
      requireOperation(ctx, 'producao:write', BOARD_PAGE);
      const data = z.object({ orderId: uuid, target }).strict().parse(input);
      return repository.move(data.orderId, data.target, boardActor(ctx));
    },
    async start(ctx: AccessContext, input: unknown) {
      requireOperation(ctx, 'producao:write', BOARD_PAGE);
      const data = z.object({ orderId: uuid, stepId: uuid, workerId: uuid }).strict().parse(input);
      return repository.start(data.orderId, data.stepId, data.workerId, boardActor(ctx));
    },
    async finish(ctx: AccessContext, input: unknown) {
      requireOperation(ctx, 'producao:write', BOARD_PAGE);
      const data = z.object({ orderId: uuid, stepId: uuid, finish: finishSchema }).strict().parse(input);
      return repository.finish(data.orderId, data.stepId, data.finish, boardActor(ctx));
    },
  };
}

export const productionKanban = createKanbanOperations(kanbanRepository);
