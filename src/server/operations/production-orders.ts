import 'server-only';
import { z } from 'zod';
import type { AccessContext } from '@/server/access/types';
import type { ProductionOrderRepository } from '@/server/persistence/pcp-orders-contract';
import { productionOrderRepository } from '@/server/persistence/pcp-orders';
import type { WriteActor } from '@/server/persistence/write-audit';
import { dateSchema, requireOperation } from './common';

export const ORDERS_PAGE = '/producao/ops';

const kind = z.enum(['semanal', 'corte']);
const factor = z.number().finite().min(0.1).max(10);
const period = { from: dateSchema, to: dateSchema };
const laterThanStart = (v: { from: string; to: string }) => v.from <= v.to;
const previewSchema = z.object({ kind, factor, ...period }).strict().refine(laterThanStart, 'O início deve ser anterior ao fim.');
const batchSchema = z.object({
  kind, factor, ...period,
  items: z.array(z.object({
    sku: z.string().trim().min(1).max(100), sheetId: z.string().uuid(),
    quantity: z.number().finite().positive().max(1_000_000), description: z.string().trim().max(300).nullable(),
  }).strict()).min(1, 'Escolha ao menos um item.').max(300)
    .refine(items => new Set(items.map(i => i.sku)).size === items.length, 'SKU repetido no lote.'),
}).strict().refine(laterThanStart, 'O início deve ser anterior ao fim.');

const writeActor = (context: AccessContext): WriteActor => ({
  userId: context.actor.userId, source: context.actor.source, clientId: context.actor.clientId ?? null, idempotencyKey: null,
});

/** Gerador e lista de OPs: quem opera a produção (Administrador e Operador) lê e gera. */
export function createProductionOrderOperations(repository: ProductionOrderRepository) {
  return {
    async previewOrders(ctx: AccessContext, input: unknown) {
      requireOperation(ctx, 'producao:read', ORDERS_PAGE);
      return repository.preview(previewSchema.parse(input));
    },
    async createOrderBatch(ctx: AccessContext, input: unknown) {
      requireOperation(ctx, 'producao:write', ORDERS_PAGE);
      return repository.createBatch(batchSchema.parse(input), writeActor(ctx));
    },
    async listBatches(ctx: AccessContext) {
      requireOperation(ctx, 'producao:read', ORDERS_PAGE);
      return repository.listBatches();
    },
    async listOrders(ctx: AccessContext, batchId: unknown) {
      requireOperation(ctx, 'producao:read', ORDERS_PAGE);
      return repository.listOrders(batchId == null || batchId === '' ? null : z.string().uuid().parse(batchId));
    },
    async exportIapp(ctx: AccessContext, batchId: unknown) {
      requireOperation(ctx, 'producao:write', ORDERS_PAGE);
      return repository.exportIapp(z.string().uuid().parse(batchId), writeActor(ctx));
    },
  };
}

export const productionOrders = createProductionOrderOperations(productionOrderRepository);
