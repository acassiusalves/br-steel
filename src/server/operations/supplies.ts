import 'server-only';
import { z } from 'zod';
import type { AccessContext } from '@/server/access/types';
import type { SuppliesReadRepository } from '@/server/persistence/supplies-contract';
import { suppliesReadRepository } from '@/server/persistence/supplies';
import type { SuppliesWriteRepository } from '@/server/persistence/supplies-write-contract';
import { validateLimits } from '@/server/persistence/supplies-write-contract';
import { suppliesWriteRepository } from '@/server/persistence/supplies-write';
import type { WriteActor } from '@/server/persistence/write-audit';
import { dateSchema, documentIdSchema, pageInputSchema, requireOperation, OperationError } from './common';

const finite = z.number().finite().min(0).max(1e12);
const fields = z.object({ nome: z.string().trim().min(1).max(200), codigo: documentIdSchema.transform(v => v.trim()).refine(Boolean), gtin: z.string().max(50).default(''), unidade: z.string().trim().min(1).max(20),
  precoCusto: finite, estoqueMinimo: finite, estoqueMaximo: finite, tempoEntrega: finite });
const movementSchema = z.object({ supplyId: documentIdSchema, type: z.enum(['entrada', 'saida']), quantity: z.number().finite().positive().max(1e12), unitCost: finite.optional(), notes: z.string().trim().max(2000).optional() });
const limitsSchema = z.object({ sku: documentIdSchema, estoqueMinimo: finite.optional(), estoqueMaximo: finite.optional() }).strict().refine(v => v.estoqueMinimo !== undefined || v.estoqueMaximo !== undefined);
const notFound = () => new OperationError('NOT_FOUND', 'Insumo não encontrado.', 404);

const writeActor = (context: AccessContext): WriteActor => ({
  userId: context.actor.userId, source: context.actor.source,
  clientId: context.actor.clientId ?? null, idempotencyKey: null,
});

/** Authorization remains at the operation boundary for every persistence adapter. */
export function createSuppliesReadOperations(repository: SuppliesReadRepository) {
  return {
    async listSupplies(context: AccessContext, raw: unknown) {
      requireOperation(context, 'insumos:read');
      return repository.list(pageInputSchema.strict().parse(raw));
    },
    async listMovements(context: AccessContext, raw: unknown) {
      requireOperation(context, 'insumos:read');
      const input = pageInputSchema.extend({ supplyId: documentIdSchema, from: dateSchema.optional(), to: dateSchema.optional() }).strict().parse(raw);
      if (input.from && input.to && input.from > input.to) throw new OperationError('INVALID_INPUT', 'Período inválido.');
      return repository.listMovements(input);
    },
  };
}
export const { listSupplies, listMovements } = createSuppliesReadOperations(suppliesReadRepository);

export function createSuppliesWriteOperations(repository: SuppliesWriteRepository) {
  async function updateSupplyRecord(context: AccessContext, id: string, raw: unknown) {
    requireOperation(context, 'insumos:write');
    documentIdSchema.parse(id);
    const input = fields.partial().strict().parse(raw);
    return repository.update(id, input, writeActor(context));
  }
  return {
    updateSupplyRecord,
    async createSupply(context: AccessContext, raw: unknown) {
      requireOperation(context, 'insumos:write');
      const input = fields.parse(raw);
      validateLimits(input);
      return repository.create(input, writeActor(context));
    },
    /** Duplicate SKUs are an operation-level rule: persistence only resolves the identifier. */
    async updateSupplyLimits(context: AccessContext, raw: unknown) {
      requireOperation(context, 'insumos:write');
      const input = limitsSchema.parse(raw);
      const matches = await repository.findBySku(input.sku);
      if (!matches.length) throw notFound();
      if (matches.length > 1) throw new OperationError('DUPLICATE_SKU', 'Há cadastros duplicados para este SKU. Corrija antes de atualizar.', 409);
      const data = { ...(input.estoqueMinimo !== undefined ? { estoqueMinimo: input.estoqueMinimo } : {}), ...(input.estoqueMaximo !== undefined ? { estoqueMaximo: input.estoqueMaximo } : {}) };
      return updateSupplyRecord(context, matches[0], data);
    },
    async deleteSupplyRecord(context: AccessContext, id: string) {
      requireOperation(context, 'insumos:write');
      documentIdSchema.parse(id);
      return repository.remove(id, writeActor(context));
    },
    async recordMovement(context: AccessContext, raw: unknown) {
      requireOperation(context, 'insumos:write');
      return repository.recordMovement(movementSchema.parse(raw), writeActor(context));
    },
  };
}
export const { createSupply, updateSupplyRecord, updateSupplyLimits, deleteSupplyRecord, recordMovement } =
  createSuppliesWriteOperations(suppliesWriteRepository);
