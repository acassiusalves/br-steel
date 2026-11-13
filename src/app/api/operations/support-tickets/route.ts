import { z } from 'zod';
import { requireWebContext } from '@/server/operations/context';
import { operationJson, readOperationBody } from '@/server/operations/http';
import { supportTickets as t } from '@/server/operations/support-tickets';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return operationJson(async () => {
    const ctx = await requireWebContext(request);
    const scope = z.enum(['mine', 'admin']).parse(new URL(request.url).searchParams.get('scope') ?? 'mine');
    return t.list(ctx, scope);
  });
}
export async function POST(request: Request) {
  return operationJson(async () => {
    const ctx = await requireWebContext(request);
    const { action, data } = z.object({ action: z.enum(['create', 'setStatus', 'reopen']), data: z.unknown() })
      .strict().parse(await readOperationBody(request));
    switch (action) {
      case 'create': return t.create(ctx, data);
      case 'setStatus': return t.setStatus(ctx, data);
      case 'reopen': return t.reopen(ctx, data);
    }
  });
}
