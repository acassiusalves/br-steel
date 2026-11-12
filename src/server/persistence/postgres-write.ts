import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { isPilotScopeActive } from './pilot-snapshot';

// Serialization failure and deadlock are the two conflicts worth retrying; everything else is a real error.
const RETRYABLE = new Set(['40001', '40P01']);
const MAX_ATTEMPTS = 4;

/**
 * Mutate the operational core in one serializable transaction, refusing to run against a copy that is
 * not ready. Unlike the read path this never validates pilot metadata: a pilot copy is a read-only
 * artifact with a short expiry, so a write must not reach one at all.
 *
 * `serializeOn` queues writes that would otherwise conflict: a session advisory lock taken on the same
 * connection *before* `begin`, so each transaction's snapshot already sees the previous holder's commit.
 * Taken inside the transaction instead, the snapshot would predate the wait and still fail to serialize.
 */
export async function withOperationalWrite<T>(pool: Pool, run: (client: PoolClient) => Promise<T>,
  options: { serializeOn?: number } = {}): Promise<T> {
  if (isPilotScopeActive()) throw new Error('Operational writes are not allowed inside a pilot copy scope');
  let lastError: unknown = new Error('Operational write did not run');
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const client = await pool.connect();
    let locked = false;
    try {
      if (options.serializeOn !== undefined) {
        await client.query('select pg_advisory_lock($1)', [options.serializeOn]);
        locked = true;
      }
      await client.query('begin isolation level serializable');
      const state = (await client.query('select ready, source_project from brsteel_import.state where singleton')).rows[0];
      if (!state?.ready) throw new Error('Operational copy not ready');
      const value = await run(client);
      await client.query('commit');
      return value;
    } catch (error) {
      // Do not surface driver errors carrying statements or payloads; callers map their own codes.
      await client.query('rollback').catch(() => undefined);
      const code = (error as { code?: string }).code;
      if (code && RETRYABLE.has(code) && attempt < MAX_ATTEMPTS) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, attempt * 10 + Math.floor(Math.random() * 10)));
        continue;
      }
      throw error;
    } finally {
      // A session lock outlives the transaction: release it before the connection goes back to the pool,
      // and destroy the connection if the unlock fails so the lock cannot stay held.
      let broken = false;
      if (locked) await client.query('select pg_advisory_unlock($1)', [options.serializeOn]).catch(() => { broken = true; });
      client.release(broken);
    }
  }
  throw lastError;
}
