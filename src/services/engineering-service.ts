import { fetchOperation, notifyOperationsChanged } from '@/lib/operation-client';
import type {
  EngineeringSnapshot, Holiday, LineInput, OperationInput, ProductSheet, ProductSheetSummary, SheetInput, TeamInput, WorkerInput, WorkPeriodRow,
} from '@/server/persistence/pcp-engineering-contract';

const path = '/api/operations/engineering';

async function mutate<T>(action: string, data?: unknown, id?: string | null): Promise<T> {
  const response = await fetchOperation<T>(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data, id: id ?? undefined }),
  });
  notifyOperationsChanged();
  return response.data;
}

export async function getEngineering(): Promise<EngineeringSnapshot> {
  return (await fetchOperation<EngineeringSnapshot>(path)).data;
}
export const saveLine = (id: string | null, data: LineInput) => mutate<{ id: string }>('saveLine', data, id);
export const saveOperation = (id: string | null, data: OperationInput) => mutate<{ id: string }>('saveOperation', data, id);
export const saveTeam = (id: string | null, data: TeamInput) => mutate<{ id: string }>('saveTeam', data, id);
export const saveWorker = (id: string | null, data: WorkerInput) => mutate<{ id: string }>('saveWorker', data, id);
export const replaceWorkPeriods = (data: WorkPeriodRow[]) => mutate<null>('replaceWorkPeriods', data);
export const saveHoliday = (data: Holiday) => mutate<null>('saveHoliday', data);
export const deleteHoliday = (day: string) => mutate<null>('deleteHoliday', undefined, day);
export const saveLossReason = (id: string | null, data: { name: string; active: boolean }) => mutate<{ id: string }>('saveLossReason', data, id);
export async function getSheets(): Promise<ProductSheetSummary[]> {
  return (await fetchOperation<ProductSheetSummary[]>(`${path}?view=sheets`)).data;
}
export async function getSheet(id: string): Promise<ProductSheet> {
  return (await fetchOperation<ProductSheet>(`${path}?view=sheet&id=${encodeURIComponent(id)}`)).data;
}
export const saveSheet = (id: string | null, data: SheetInput) => mutate<{ id: string }>('saveSheet', data, id);
