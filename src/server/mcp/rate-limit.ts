import 'server-only';
import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import type { McpPrincipal } from './auth';
import { READS_PER_MINUTE } from './config';
import { McpHttpError } from './errors';
type Bucket = 'read' | 'protocol';
export const rateLimitId = (principal: McpPrincipal, bucket: Bucket, minute: number) => createHash('sha256')
  .update(JSON.stringify([principal.context.actor.userId, principal.context.actor.clientId, bucket, minute])).digest('hex');
/** Firestore transaction shares the counter across instances; no process-local limiter. */
export async function consumeRateLimit(principal: McpPrincipal, bucket: Bucket, now = Date.now()): Promise<void> {
  const minute = Math.floor(now / 60000);
  const ref = adminDb.collection('mcpRateLimits').doc(rateLimitId(principal, bucket, minute));
  const limit = bucket === 'read' ? READS_PER_MINUTE : 240;
  await adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const count = snapshot.exists ? snapshot.data()!.count : 0;
    if (!Number.isSafeInteger(count) || count < 0) throw new McpHttpError('UNAVAILABLE', 'Limite de uso indisponível.', 503);
    if (count >= limit) throw new McpHttpError('RATE_LIMITED', 'Limite de consultas atingido. Aguarde e tente novamente.', 429, Math.max(1, Math.ceil(((minute + 1) * 60000 - now) / 1000)));
    tx.set(ref, { count: count + 1, expiresAt: Timestamp.fromMillis((minute + 2) * 60000) });
  }, { maxAttempts: 5 });
}
