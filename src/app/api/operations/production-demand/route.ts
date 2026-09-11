import { requireWebContext } from '@/server/operations/context';
import { operationJson, readOperationBody } from '@/server/operations/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { productionDemand } from '@/server/operations/production-demand';
import { refreshProductionSku } from '@/server/operations/stock';
import { documentIdSchema } from '@/server/operations/common';
import { z } from 'zod';
export async function GET(request: Request) {
  return operationJson(async () => productionDemand(await requireWebContext(request), Object.fromEntries(new URL(request.url).searchParams)));
}
export async function POST(request: Request) {
  return operationJson(async () => {
    const context = await requireWebContext(request);
    const { sku } = z.object({ sku: documentIdSchema }).strict().parse(await readOperationBody(request));
    return refreshProductionSku(context, sku);
  });
}
