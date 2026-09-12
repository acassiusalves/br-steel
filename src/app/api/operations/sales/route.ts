import { requireWebContext } from '@/server/operations/context';
import { operationJson, readOperationBody } from '@/server/operations/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { listSales, summarizeSales } from '@/server/operations/sales';
import { z } from 'zod';
export async function GET(request: Request) {
  return operationJson(async () => {
    const context = await requireWebContext(request);
    const { view, ...input } = Object.fromEntries(new URL(request.url).searchParams);
    if (view === 'summary') return summarizeSales(context, input);
    z.enum(['list']).optional().parse(view);
    return listSales(context, input);
  });
}
