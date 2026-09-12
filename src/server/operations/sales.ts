import 'server-only';
import { z } from 'zod';
import type { AccessContext } from '@/server/access/types';
import type { SaleOrder } from '@/types/sale-order';
import { salesReadRepository } from '@/server/persistence/sales';
import { dateSchema, dateRangeSchema, documentIdSchema, pageInputSchema, requireOperation, requireWebPage } from './common';

const listInput = pageInputSchema.extend({ from: dateSchema.optional(), to: dateSchema.optional(), storeId: z.coerce.number().int().optional(), statusId: z.coerce.number().int().optional() }).strict().refine(v => !v.from || !v.to || v.from <= v.to, 'Período inválido.');

/** Internal persistence read; callers must authorize the appropriate sales or operational projection. */
export async function readOrdersForPeriod(input: { from: string; to: string }): Promise<SaleOrder[]> {
  return salesReadRepository.readOrdersForPeriod(dateRangeSchema.parse(input));
}

export async function listSales(context: AccessContext, raw: unknown, webFinance = false) {
  if (webFinance) requireWebPage(context, '/financeiro/conciliacao'); else requireOperation(context, 'vendas:read');
  return salesReadRepository.list(listInput.parse(raw));
}

export async function getSale(context: AccessContext, id: string) {
  requireOperation(context, 'vendas:read');
  return salesReadRepository.get(documentIdSchema.parse(id));
}

export async function summarizeSales(context: AccessContext, raw: unknown) {
  requireOperation(context, 'vendas:read');
  return salesReadRepository.summarize(dateRangeSchema.parse(raw), {
    databaseOnly: context.actor.source === 'mcp',
  });
}
