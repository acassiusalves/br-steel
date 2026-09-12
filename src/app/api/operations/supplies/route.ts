import { requireWebContext } from '@/server/operations/context';
import { operationJson, readOperationBody } from '@/server/operations/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { listSupplies, listMovements, createSupply, updateSupplyRecord, updateSupplyLimits, deleteSupplyRecord, recordMovement } from '@/server/operations/supplies';
import { documentIdSchema } from '@/server/operations/common';
import { z } from 'zod';
export async function GET(request: Request) {
  return operationJson(async () => {
    const context = await requireWebContext(request);
    const { view, ...input } = Object.fromEntries(new URL(request.url).searchParams);
    if (view === 'movements') return listMovements(context, input);
    z.enum(['list']).optional().parse(view);
    return listSupplies(context, input);
  });
}
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), data: z.unknown() }).strict(),
  z.object({ action: z.literal('update'), id: documentIdSchema, data: z.unknown() }).strict(),
  z.object({ action: z.literal('delete'), id: documentIdSchema }).strict(),
  z.object({ action: z.literal('limits'), data: z.unknown() }).strict(),
  z.object({ action: z.literal('movement'), data: z.unknown() }).strict(),
]);
export async function POST(request: Request) {
  return operationJson(async () => {
    const context = await requireWebContext(request);
    const input = command.parse(await readOperationBody(request));
    switch (input.action) {
      case 'create': return createSupply(context, input.data);
      case 'update': return updateSupplyRecord(context, input.id, input.data);
      case 'delete': return deleteSupplyRecord(context, input.id);
      case 'limits': return updateSupplyLimits(context, input.data);
      case 'movement': return recordMovement(context, input.data);
    }
  });
}
