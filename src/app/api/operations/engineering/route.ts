import { z } from 'zod';
import { requireWebContext } from '@/server/operations/context';
import { operationJson, readOperationBody } from '@/server/operations/http';
import { engineering as e } from '@/server/operations/engineering';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const actions = ['saveLine', 'saveOperation', 'saveTeam', 'saveWorker', 'replaceWorkPeriods', 'saveHoliday', 'deleteHoliday', 'saveLossReason'] as const;

export async function GET(request: Request) {
  return operationJson(async () => e.readEngineering(await requireWebContext(request)));
}
export async function POST(request: Request) {
  return operationJson(async () => {
    const ctx = await requireWebContext(request);
    const { action, id, data } = z.object({ action: z.enum(actions), id: z.unknown().optional(), data: z.unknown().optional() })
      .strict().parse(await readOperationBody(request));
    switch (action) {
      case 'saveLine': return e.saveLine(ctx, id, data);
      case 'saveOperation': return e.saveOperation(ctx, id, data);
      case 'saveTeam': return e.saveTeam(ctx, id, data);
      case 'saveWorker': return e.saveWorker(ctx, id, data);
      case 'replaceWorkPeriods': return e.replaceWorkPeriods(ctx, data);
      case 'saveHoliday': return e.saveHoliday(ctx, data);
      case 'deleteHoliday': return e.deleteHoliday(ctx, id);
      case 'saveLossReason': return e.saveLossReason(ctx, id, data);
    }
  });
}
