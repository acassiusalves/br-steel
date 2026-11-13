import { z } from 'zod';
import { requireWebContext } from '@/server/operations/context';
import { operationJson, readOperationBody } from '@/server/operations/http';
import { productionOrders as o } from '@/server/operations/production-orders';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return operationJson(async () => {
    const ctx = await requireWebContext(request);
    const params = new URL(request.url).searchParams;
    const view = z.enum(['batches', 'orders']).parse(params.get('view') ?? 'batches');
    return view === 'orders' ? o.listOrders(ctx, params.get('batchId')) : o.listBatches(ctx);
  });
}
export async function POST(request: Request) {
  return operationJson(async () => {
    const ctx = await requireWebContext(request);
    const { action, id, data } = z.object({ action: z.enum(['preview', 'createBatch', 'exportIapp']), id: z.unknown().optional(), data: z.unknown().optional() })
      .strict().parse(await readOperationBody(request));
    switch (action) {
      case 'preview': return o.previewOrders(ctx, data);
      case 'createBatch': return o.createOrderBatch(ctx, data);
      case 'exportIapp': return o.exportIapp(ctx, id);
    }
  });
}
