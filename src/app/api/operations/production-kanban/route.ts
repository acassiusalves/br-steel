import { z } from 'zod';
import { requireWebContext } from '@/server/operations/context';
import { operationJson, readOperationBody } from '@/server/operations/http';
import { productionKanban as k } from '@/server/operations/production-kanban';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return operationJson(async () => k.board(await requireWebContext(request)));
}
export async function POST(request: Request) {
  return operationJson(async () => {
    const ctx = await requireWebContext(request);
    const { action, data } = z.object({ action: z.enum(['move', 'start', 'finish']), data: z.unknown() }).strict().parse(await readOperationBody(request));
    switch (action) {
      case 'move': return k.move(ctx, data);
      case 'start': return k.start(ctx, data);
      case 'finish': return k.finish(ctx, data);
    }
  });
}
