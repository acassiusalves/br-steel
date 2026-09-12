import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { OperationError } from '@/server/operations/common';

export type WriteActor = {
  userId: string;
  source: 'web' | 'mcp';
  clientId: string | null;
  idempotencyKey: string | null;
};
export type WriteAuditEntry = {
  operation: string;
  actor: WriteActor;
  target: { collection: string; id: string };
};

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');

/**
 * Derived from the idempotency key so replaying a confirmation reuses the same audit row. Without a key
 * the id is random: two legitimate writes to the same target are distinct history, not a duplicate.
 */
const auditId = (entry: WriteAuditEntry) => entry.actor.idempotencyKey
  ? digest(`${entry.operation}:${entry.actor.idempotencyKey}`)
  : randomUUID();

/** Must run inside the same transaction as the effect it describes. */
export async function recordWriteAudit(client: PoolClient, entry: WriteAuditEntry): Promise<void> {
  await client.query(
    `insert into brsteel_write.audit (id, operation, user_id, source, client_id, target_collection, target_id)
     values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing`,
    [auditId(entry), entry.operation, entry.actor.userId, entry.actor.source, entry.actor.clientId,
      entry.target.collection, entry.target.id]);
}

/** Returns the stored response for a repeated confirmation, or null when the operation must still run. */
export async function replayIdempotent<T>(client: PoolClient, actor: WriteActor, operation: string,
  request: unknown): Promise<T | null> {
  if (!actor.idempotencyKey) return null;
  const row = (await client.query(
    `select operation, user_id, request_hash, response from brsteel_write.idempotency
     where key = $1 and expires_at > now()`, [actor.idempotencyKey])).rows[0];
  if (!row) return null;
  if (row.operation !== operation || row.user_id !== actor.userId || row.request_hash !== digest(request)) {
    throw new OperationError('IDEMPOTENCY_CONFLICT', 'Esta chave de idempotência já foi usada com outro pedido.', 409);
  }
  return row.response as T;
}

export async function storeIdempotent(client: PoolClient, actor: WriteActor, operation: string,
  request: unknown, response: unknown): Promise<void> {
  if (!actor.idempotencyKey) return;
  await client.query(
    `insert into brsteel_write.idempotency (key, operation, user_id, request_hash, response)
     values ($1, $2, $3, $4, $5) on conflict (key) do nothing`,
    [actor.idempotencyKey, operation, actor.userId, digest(request), JSON.stringify(response)]);
}
