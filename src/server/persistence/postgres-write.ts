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
 */
export async function withOperationalWrite<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  if (isPilotScopeActive()) throw new Error('Operational writes are not allowed inside a pilot copy scope');
  let lastError: unknown = new Error('Operational write did not run');
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const client = await pool.connect();
    try {
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
      client.release();
    }
  }
  throw lastError;
}
