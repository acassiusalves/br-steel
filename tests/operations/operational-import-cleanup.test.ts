import { expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { importSnapshot } from '@/server/migration/operational-import';
import { COLLECTIONS } from '@/server/migration/operational-snapshot';

it('destroys a disconnected client even when advisory unlock fails, preserving the original failure', async () => {
  const failure = new Error('Connection lost during import');
  const release = vi.fn();
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('current_database')) return { rows: [{ db: 'brsteel_ops_local' }] };
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql === 'begin') throw failure;
    throw new Error('Connection lost during cleanup');
  });
  const pool = { connect: async () => ({ query, release }) } as unknown as Pool;
  await expect(importSnapshot(pool, { formatVersion: 1, sourceProject: 'demo-brsteel-auth',
    capturedAt: '2026-09-12T12:00:00.000Z', completeCollections: [...COLLECTIONS], records: [],
  })).rejects.toBe(failure);
  expect(release).toHaveBeenCalledWith(true);
});
