import { requireWebContext } from '@/server/operations/context';
import { operationJson, readOperationBody } from '@/server/operations/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { listSales } from '@/server/operations/sales';
export async function GET(request: Request) {
  return operationJson(async () => listSales(await requireWebContext(request), Object.fromEntries(new URL(request.url).searchParams), true));
}
