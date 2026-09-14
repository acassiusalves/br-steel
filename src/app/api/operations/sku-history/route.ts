import { requireWebContext } from '@/server/operations/context';
import { operationJson } from '@/server/operations/http';
import { skuHistory } from '@/server/operations/sku-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return operationJson(async () =>
    skuHistory(await requireWebContext(request), Object.fromEntries(new URL(request.url).searchParams)));
}
