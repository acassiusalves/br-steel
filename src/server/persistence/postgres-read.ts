import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { validatePilotSnapshot } from './pilot-snapshot';

/** Read readiness and business data in the same snapshot, even if another import starts concurrently. */
export async function withOperationalSnapshot<T>(pool: Pool, read: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    const state = (await client.query('select ready,source_project,active_run,captured_at,completed_at from brsteel_import.state where singleton')).rows[0];
    if (!state?.ready) throw new Error('Operational copy not ready');
    validatePilotSnapshot(state);
    const value = await read(client);
    await client.query('commit');
    return value;
  } catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}
