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
  let active = true, loading = false, rerun = false, timer = 0;
  /** Only an explicit change queues a reload behind a load in flight, because that load may have read
   *  the data the change replaced. Polling and returning to the tab never queue: the load already
   *  running is the refresh they were asking for. */
  const refresh = async (queueIfBusy = false) => {
    if (!active || document.visibilityState === 'hidden') return;
    if (loading) { if (queueIfBusy) rerun = true; return; }
    loading = true;
    try { const data = await load(); if (active) onData(data); }
    catch (error) { if (active) onError(error instanceof Error ? error : new Error('Falha ao atualizar os dados.')); }
    finally { loading = false; if (rerun && active) { rerun = false; void refresh(); } }
  };
  // The next poll is scheduled once the previous one settles, never on a fixed clock: a load slower than
  // the interval would otherwise be followed straight away by the next, reloading without pause.
  const poll = () => void refresh().finally(() => {
    window.clearTimeout(timer);
    if (active) timer = window.setTimeout(poll, 10000);
  });
  const reload = () => void refresh(true);
  poll();
  document.addEventListener('visibilitychange', poll); window.addEventListener(event, reload);
  return () => { active = false; window.clearTimeout(timer); document.removeEventListener('visibilitychange', poll); window.removeEventListener(event, reload); };
}
