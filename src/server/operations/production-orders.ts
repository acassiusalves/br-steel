import 'server-only';
import { z } from 'zod';
import { saoPauloDay } from '@/lib/iso-week';
import type { AccessContext } from '@/server/access/types';
import type { BlingQueueProgress, ProductionOrderRepository } from '@/server/persistence/pcp-orders-contract';
import { productionOrderRepository } from '@/server/persistence/pcp-orders';
import type { WriteActor } from '@/server/persistence/write-audit';
import { dateSchema, requireOperation } from './common';

export const ORDERS_PAGE = '/producao/ops';

const kind = z.enum(['semanal', 'corte']);
const factor = z.number().finite().positive().max(10);
const policy = z.literal('bling').optional();
const period = { from: dateSchema, to: dateSchema };
const laterThanStart = (v: { from: string; to: string }) => v.from <= v.to;
const validRangeAndFactor = (v: { policy?: 'bling'; to: string; factor: number }) =>
  v.policy === 'bling' ? v.to <= saoPauloDay(new Date()) : v.factor >= 0.1;
const previewSchema = z.object({ kind, factor, policy, ...period }).strict()
  .refine(laterThanStart, 'O início deve ser anterior ao fim.')
  .refine(validRangeAndFactor, 'Confira o fim do período e a margem.');
const item = z.object({
  sku: z.string().trim().min(1).max(100), sheetId: z.string().uuid(),
  quantity: z.number().finite().positive().max(1_000_000), description: z.string().trim().max(300).nullable(),
}).strict();
const batchSchema = z.object({
  kind, factor, policy, ...period,
  previewToken: z.string().max(160_000).optional(),
  idempotencyKey: z.string().uuid().optional(),
  items: z.array(item).min(1, 'Escolha ao menos um item.').max(300)
    .refine(items => new Set(items.map(i => i.sku)).size === items.length, 'SKU repetido no lote.'),
}).strict().refine(laterThanStart, 'O início deve ser anterior ao fim.')
  .refine(validRangeAndFactor, 'Confira o fim do período e a margem.')
  .refine(v => v.policy !== 'bling' || Boolean(v.previewToken && v.idempotencyKey), 'Calcule a prévia antes de gerar a fila.');
const manualSchema = z.object({
  kind, sku: z.string().trim().min(1).max(100), sheetId: z.string().uuid(), quantity: z.number().finite().positive().max(1_000_000),
  urgent: z.boolean().default(false), notes: z.string().trim().max(2000).nullable().default(null).transform(v => v || null),
}).strict();
const salesOrderNumber = z.object({ number: z.string().trim().regex(/^[A-Za-z0-9._/-]{1,60}$/, 'Número de pedido inválido.') }).strict();
const salesOrderBatchSchema = z.object({
  blingOrderId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  urgent: z.boolean().default(false), confirmDuplicate: z.boolean().default(false),
  items: z.array(item.extend({ parts: z.array(item).max(50) }).strict()).min(1, 'Escolha ao menos um item.').max(100)
    .refine(items => new Set(items.map(i => i.sku)).size === items.length, 'SKU repetido no pedido.'),
}).strict();

const writeActor = (context: AccessContext): WriteActor => ({
  userId: context.actor.userId, source: context.actor.source, clientId: context.actor.clientId ?? null, idempotencyKey: null,
});

/** Gerador e lista de OPs: quem opera a produção (Administrador e Operador) lê e gera. */
export function createProductionOrderOperations(repository: ProductionOrderRepository) {
  return {
    async previewOrders(ctx: AccessContext, input: unknown, progress?: (step: BlingQueueProgress) => void) {
      requireOperation(ctx, 'producao:read', ORDERS_PAGE);
      const input2 = previewSchema.parse(input);
      // Reler o cadastro do Bling grava a cópia: só para quem pode gerar OP.
      let canRefresh = true;
      try { requireOperation(ctx, 'producao:write', ORDERS_PAGE); } catch { canRefresh = false; }
      return repository.preview(input2, canRefresh ? writeActor(ctx) : null, progress);
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
    async listProducible(ctx: AccessContext) {
      requireOperation(ctx, 'producao:read', ORDERS_PAGE);
      return repository.listProducible();
    },
    async createManualOrder(ctx: AccessContext, input: unknown) {
      requireOperation(ctx, 'producao:write', ORDERS_PAGE);
      return repository.createManualOrder(manualSchema.parse(input), writeActor(ctx));
    },
    /** Consulta o Bling: só para quem pode gerar OP. */
    async previewSalesOrder(ctx: AccessContext, input: unknown) {
      requireOperation(ctx, 'producao:write', ORDERS_PAGE);
      return repository.previewSalesOrder(salesOrderNumber.parse(input).number);
    },
    async createFromSalesOrder(ctx: AccessContext, input: unknown) {
      requireOperation(ctx, 'producao:write', ORDERS_PAGE);
      return repository.createFromSalesOrder(salesOrderBatchSchema.parse(input), writeActor(ctx));
    },
  };
}

export const productionOrders = createProductionOrderOperations(productionOrderRepository);
