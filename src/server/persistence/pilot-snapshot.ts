import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { OperationResult, ReadCopy } from '@/types/operations';

export const MAX_COPY_AGE_MS = 24 * 60 * 60 * 1000;
export type PilotSnapshotPolicy = { sourceProject: string; snapshotHash: string; expiresAt: number };
type Scope = { policy: PilotSnapshotPolicy; copy?: ReadCopy };
const scope = new AsyncLocalStorage<Scope>();
const unavailable = () => new Error('Operational pilot copy unavailable');
function assertTime(policy: PilotSnapshotPolicy, now = Date.now()) {
  if (!Number.isFinite(policy.expiresAt) || policy.expiresAt <= now || policy.expiresAt > now + MAX_COPY_AGE_MS) throw unavailable();
}

/** A pilot copy is read-only; the write path refuses to run while one is in scope. */
export function isPilotScopeActive() { return scope.getStore() !== undefined; }

/** Called inside the same repeatable-read transaction as the business SELECTs. */
export function validatePilotSnapshot(state: Record<string, unknown>) {
  const current = scope.getStore();
  if (!current) return;
  const { policy } = current, now = Date.now();
  assertTime(policy, now);
  const captured = state.captured_at instanceof Date ? state.captured_at.getTime() : NaN;
  const completed = state.completed_at instanceof Date ? state.completed_at.getTime() : NaN;
  if (state.ready !== true || state.source_project !== policy.sourceProject || state.active_run !== policy.snapshotHash
    || !Number.isFinite(captured) || !Number.isFinite(completed) || captured > completed || completed > now
    || captured <= now - MAX_COPY_AGE_MS) throw unavailable();
  const copy: ReadCopy = { mode:'pilot',sourceProject:policy.sourceProject,snapshotHash:policy.snapshotHash,
    capturedAt:new Date(captured).toISOString(),completedAt:new Date(completed).toISOString() };
  if (current.copy && JSON.stringify(current.copy) !== JSON.stringify(copy)) throw unavailable();
  current.copy = copy;
}

/** Request-local scope prevents another user's tool call from supplying copy evidence. */
export async function withPilotSnapshot<T>(policy: PilotSnapshotPolicy, read: () => Promise<OperationResult<T>>): Promise<OperationResult<T>> {
  assertTime(policy);
  return scope.run({policy}, async () => {
    const response = await read(), copy = scope.getStore()?.copy;
    assertTime(policy);
    if (!copy || response.source !== 'postgres' || Date.parse(copy.capturedAt) <= Date.now() - MAX_COPY_AGE_MS) throw unavailable();
    return { ...response, asOf:copy.capturedAt, readCopy:copy,
      warnings:[...response.warnings,`Leitura de cópia de piloto capturada em ${copy.capturedAt}; não representa dados atuais do sistema. As datas das observações de estoque podem ser anteriores à captura.`] };
  });
}
