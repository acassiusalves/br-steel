import { z } from 'zod';
import { requireWebContext } from '@/server/operations/context';
import { operationJson, readOperationBody } from '@/server/operations/http';
import * as p from '@/server/operations/production';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return operationJson(async () => p.listProduction(await requireWebContext(request), Object.fromEntries(new URL(request.url).searchParams)));
}
export async function POST(request: Request) {
  return operationJson(async () => {
    const ctx = await requireWebContext(request);
    const { action, id, data, columnId } = z.object({ action: z.enum(['createColumn', 'updateColumn', 'deleteColumn', 'reorderColumns', 'seedDefaultColumns', 'createLot', 'updateLot', 'reorderLotsInColumn', 'deleteLot', 'createComment', 'updateComment', 'deleteComment']), id: z.unknown().optional(), data: z.unknown().optional(), columnId: z.unknown().optional() }).strict().parse(await readOperationBody(request));
    switch (action) {
      case 'createColumn': return p.createColumn(ctx, data);
      case 'updateColumn': return p.updateColumn(ctx, id, data);
      case 'deleteColumn': return p.deleteColumn(ctx, id);
      case 'reorderColumns': return p.reorderColumns(ctx, data);
      case 'seedDefaultColumns': return p.seedDefaultColumns(ctx);
      case 'createLot': return p.createLot(ctx, data);
      case 'updateLot': return p.updateLot(ctx, id, data);
      case 'reorderLotsInColumn': return p.reorderLotsInColumn(ctx, columnId, data);
      case 'deleteLot': return p.deleteLot(ctx, id);
      case 'createComment': return p.createComment(ctx, data);
      case 'updateComment': return p.updateComment(ctx, id, data);
      case 'deleteComment': return p.deleteComment(ctx, id);
    }
  });
}
