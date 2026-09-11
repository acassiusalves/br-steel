'use client';
import type { OperationResult } from '@/types/operations';
export async function fetchOperation<T>(path: string, init: RequestInit = {}): Promise<OperationResult<T>> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Não foi possível carregar os dados.');
  return payload;
}
export async function fetchAllOperationPages<T>(path: string, onPage?: (page: OperationResult<T[]>) => void): Promise<T[]> {
  const data: T[] = []; let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const url = new URL(path, window.location.origin); url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const result = await fetchOperation<T[]>(`${url.pathname}${url.search}`);
    if (!Array.isArray(result.data)) throw new Error('Resposta de paginação inválida.');
    onPage?.(result);
    data.push(...result.data); cursor = result.nextCursor;
    if (cursor) { if (seen.has(cursor)) throw new Error('A paginação não avançou. Atualize a página.'); seen.add(cursor); }
  } while (cursor);
  return data;
}
const event = 'brsteel:operations-changed';
export const notifyOperationsChanged = () => window.dispatchEvent(new Event(event));
/** One request at a time, no polling in hidden tabs, no delivery after unmount. */
export function subscribeOperation<T>(load: () => Promise<T>, onData: (value: T) => void, onError: (error: Error) => void) {
  let active = true, loading = false, rerun = false;
  const refresh = async () => {
    if (!active || document.visibilityState === 'hidden') return;
    if (loading) { rerun = true; return; }
    loading = true;
    try { const data = await load(); if (active) onData(data); }
    catch (error) { if (active) onError(error instanceof Error ? error : new Error('Falha ao atualizar os dados.')); }
    finally { loading = false; if (rerun && active) { rerun = false; void refresh(); } }
  };
  void refresh();
  const timer = window.setInterval(refresh, 10000);
  document.addEventListener('visibilitychange', refresh); window.addEventListener(event, refresh);
  return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener(event, refresh); };
}
