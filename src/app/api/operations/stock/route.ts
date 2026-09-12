import { requireWebContext } from '@/server/operations/context';
import { operationJson, readOperationBody } from '@/server/operations/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { listProductStock } from '@/server/operations/stock';
export async function GET(request: Request) {
  return operationJson(async () => listProductStock(await requireWebContext(request), Object.fromEntries(new URL(request.url).searchParams)));
}
