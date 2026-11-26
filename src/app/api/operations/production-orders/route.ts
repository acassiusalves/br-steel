import { z } from 'zod';
import type { AccessContext } from '@/server/access/types';
import { requireWebContext } from '@/server/operations/context';
import { operationJson, readOperationBody } from '@/server/operations/http';
import { productionOrders as o } from '@/server/operations/production-orders';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  return operationJson(async () => {
    const ctx = await requireWebContext(request);
    const params = new URL(request.url).searchParams;
    const view = z.enum(['batches', 'orders', 'products']).parse(params.get('view') ?? 'batches');
    if (view === 'products') return o.listProducible(ctx);
    return view === 'orders' ? o.listOrders(ctx, params.get('batchId')) : o.listBatches(ctx);
  });
}
function streamPreview(ctx: AccessContext, data: unknown): Response {
  const encoder = new TextEncoder();
  let disconnected = false;
  const body = new ReadableStream({
    async start(controller) {
      const send = (message: unknown) => {
        if (!disconnected) controller.enqueue(encoder.encode(JSON.stringify(message) + '\n'));
      };
      try {
        const result = await o.previewOrders(ctx, data, progress => send({ progress }));
        send({ result });
      } catch (error) {
        const response = await operationJson(async () => { throw error; });
        const { error: message } = await response.json();
        send({ error: message });
      } finally {
        if (!disconnected) controller.close();
      }
    },
    cancel() { disconnected = true; },
  });
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
}

const postSchema = z.object({
  action: z.enum(['preview', 'createBatch', 'exportIapp', 'createManual', 'previewSalesOrder', 'createFromSalesOrder']),
  id: z.unknown().optional(), data: z.unknown().optional(), stream: z.boolean().optional(),
}).strict();

export async function POST(request: Request) {
  try {
    const ctx = await requireWebContext(request);
    const { action, data, id, stream } = postSchema.parse(await readOperationBody(request));
    if (action === 'preview' && stream) return streamPreview(ctx, data);
    return operationJson(async () => {
      switch (action) {
        case 'preview': return o.previewOrders(ctx, data);
        case 'createBatch': return o.createOrderBatch(ctx, data);
        case 'exportIapp': return o.exportIapp(ctx, id);
        case 'createManual': return o.createManualOrder(ctx, data);
        case 'previewSalesOrder': return o.previewSalesOrder(ctx, data);
        case 'createFromSalesOrder': return o.createFromSalesOrder(ctx, data);
      }
    });
  } catch (error) {
    return operationJson(async () => { throw error; });
  }
}
