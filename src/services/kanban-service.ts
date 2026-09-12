import { fetchOperation, fetchAllOperationPages, notifyOperationsChanged } from '@/lib/operation-client';
import type { ProductionColumn, ProductionLot, ProductionLotItem, ProductionComment, ProductionOrder, CreateColumnInput, UpdateColumnInput, CreateLotInput, UpdateLotInput, CreateCommentInput } from '@/types/kanban';
const path = '/api/operations/production';
async function mutate<T>(action: string, data?: unknown, id?: string, columnId?: string): Promise<T> {
  const response = await fetchOperation<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data, id, columnId }) });
  notifyOperationsChanged();
  return response.data;
}
export async function getColumns(): Promise<ProductionColumn[]> { return (await fetchAllOperationPages<ProductionColumn>(`${path}?view=columns`)).sort((a, b) => a.order - b.order); }
export async function getLots(): Promise<ProductionLot[]> { return (await fetchAllOperationPages<ProductionLot>(`${path}?view=lots`)).sort((a, b) => a.columnOrder - b.columnOrder); }
export async function getLotById(id: string): Promise<ProductionLot | null> { return (await getLots()).find(l => l.id === id) || null; }
export async function getLotItems(lotId: string): Promise<ProductionLotItem[]> { return fetchAllOperationPages(`${path}?view=items&lotId=${encodeURIComponent(lotId)}`); }
export async function getComments(lotId: string): Promise<ProductionComment[]> { return (await fetchAllOperationPages<ProductionComment>(`${path}?view=comments&lotId=${encodeURIComponent(lotId)}`)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export async function getProductionOrders(): Promise<ProductionOrder[]> { return fetchAllOperationPages(`${path}?view=orders`); }
export async function getCommentsCount(lotId: string): Promise<number> { return (await getComments(lotId)).length; }
export async function createColumn(data: CreateColumnInput): Promise<{ id: string }> { return mutate('createColumn', data); }
export async function updateColumn(id: string, data: UpdateColumnInput): Promise<void> { await mutate('updateColumn', data, id); }
export async function deleteColumn(id: string): Promise<void> { await mutate('deleteColumn', undefined, id); }
export async function reorderColumns(data: { id: string; order: number }[]): Promise<void> { await mutate('reorderColumns', data); }
export async function seedDefaultColumns(): Promise<void> { await mutate('seedDefaultColumns'); }
export async function createLot(data: CreateLotInput): Promise<{ id: string; lotNumber: string }> { return mutate('createLot', data); }
export async function updateLot(id: string, data: UpdateLotInput): Promise<void> { await mutate('updateLot', data, id); }
export async function moveLot(id: string, columnId: string, columnOrder: number): Promise<void> { await updateLot(id, { columnId, columnOrder }); }
export async function reorderLotsInColumn(columnId: string, data: { id: string; order: number }[]): Promise<void> { await mutate('reorderLotsInColumn', data, undefined, columnId); }
export async function deleteLot(id: string): Promise<void> { await mutate('deleteLot', undefined, id); }
export async function createComment(data: CreateCommentInput): Promise<{ id: string }> { return mutate('createComment', data); }
export async function updateComment(id: string, content: string): Promise<void> { await mutate('updateComment', content, id); }
export async function deleteComment(id: string): Promise<void> { await mutate('deleteComment', undefined, id); }
