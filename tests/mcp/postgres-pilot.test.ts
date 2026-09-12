import { afterEach, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { AccessContext } from '@/server/access/types';
import { getPostgresPilotConfig } from '@/server/mcp/postgres-pilot-config';
import { withPilotSnapshot } from '@/server/persistence/pilot-snapshot';
import { withOperationalSnapshot } from '@/server/persistence/postgres-read';

const now = Date.parse('2026-09-12T19:00:00Z');
const context = { actor: { userId: 'pilot', source: 'mcp' } } as AccessContext;
const env = { MCP_PG_PILOT_ENABLED:'true', MCP_PG_PILOT_USER_IDS:'pilot', MCP_PG_PILOT_SNAPSHOT_HASH:'a'.repeat(64),
  MCP_PG_PILOT_EXPIRES_AT:'2026-09-12T20:00:00Z', MCP_PG_PILOT_DATABASE_URL:'postgres://brsteel_pilot_reader:p@db.mlumbvxpaqfzpdjnvzxc.supabase.co:5432/postgres', MCP_PG_PILOT_CA:'test CA' };
const policy = { sourceProject:'marketflow-9h4tg', snapshotHash:'a'.repeat(64), expiresAt:Date.parse(env.MCP_PG_PILOT_EXPIRES_AT) };
const state = { ready:true, source_project:policy.sourceProject, active_run:policy.snapshotHash,
  captured_at:new Date('2026-09-12T17:00:00Z'), completed_at:new Date('2026-09-12T18:00:00Z') };
afterEach(() => vi.useRealTimers());

it('keeps web, disabled pilots and users outside the list on their existing source even with incomplete SQL config', () => {
  expect(getPostgresPilotConfig(context,{},now)).toBeNull();
  expect(getPostgresPilotConfig(context,{...env,MCP_PG_PILOT_ENABLED:'false'},now)).toBeNull();
  expect(getPostgresPilotConfig({...context,actor:{...context.actor,source:'web'}},{MCP_PG_PILOT_ENABLED:'true'},now)).toBeNull();
  expect(getPostgresPilotConfig({...context,actor:{...context.actor,userId:'outside'}},{MCP_PG_PILOT_ENABLED:'true',MCP_PG_PILOT_USER_IDS:'pilot'},now)).toBeNull();
});
it('requires explicit bounded configuration for selected users', () => {
  expect(getPostgresPilotConfig(context,env,now)).toMatchObject({ policy });
  for (const patch of [{MCP_PG_PILOT_ENABLED:'yes'},{MCP_PG_PILOT_SNAPSHOT_HASH:'bad'},
    {MCP_PG_PILOT_EXPIRES_AT:'2026-09-12T18:59:59Z'},{MCP_PG_PILOT_EXPIRES_AT:'2026-09-14T00:00:00Z'},
    {MCP_PG_PILOT_DATABASE_URL:''},{MCP_PG_PILOT_CA:''},{MCP_PG_PILOT_DATABASE_URL:env.MCP_PG_PILOT_DATABASE_URL+'?sslmode=no-verify'}]) {
    expect(() => getPostgresPilotConfig(context,{...env,...patch},now)).toThrow();
  }
});

// The SQL client is the external boundary; the real transaction helper and request scope run unchanged.
function database(row: Record<string,unknown>) {
  const statements: string[] = [];
  const client = { query:async (sql: string) => { statements.push(sql); return { rows:sql.startsWith('select ') ? [row] : [] }; }, release:vi.fn() };
  return { pool:{connect:async()=>client} as unknown as Pool, statements, client };
}
const result = {data:[{asOf:'2026-09-10T00:00:00Z'}],source:'postgres' as const,asOf:'2026-09-12T19:00:00Z',warnings:[],nextCursor:null};
it('attaches database-validated copy timestamps without replacing individual observation dates', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const db = database(state);
  const response = await withPilotSnapshot(policy,()=>withOperationalSnapshot(db.pool,async()=>result));
  expect(response.readCopy).toEqual({mode:'pilot',sourceProject:policy.sourceProject,snapshotHash:policy.snapshotHash,capturedAt:'2026-09-12T17:00:00.000Z',completedAt:'2026-09-12T18:00:00.000Z'});
  expect(response.asOf).toBe('2026-09-12T17:00:00.000Z'); expect(response.data[0].asOf).toBe('2026-09-10T00:00:00Z');
  expect(response.warnings.join(' ')).toMatch(/cópia.*piloto/i);
  expect(db.statements[0]).toMatch(/repeatable read read only/); expect(db.statements.at(-1)).toBe('commit');
});
it('rejects incomplete, swapped, future, expired or missing metadata before business reads', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  for (const patch of [{ready:false},{source_project:'other'},{active_run:'b'.repeat(64)},{captured_at:null},
    {completed_at:null},{captured_at:new Date('2026-09-11T18:00:00Z')},{completed_at:new Date('2026-09-12T20:00:00Z')},
    {completed_at:new Date('2026-09-12T16:00:00Z')}]) {
    const db = database({...state,...patch}); let read = false;
    await expect(withPilotSnapshot(policy,()=>withOperationalSnapshot(db.pool,async()=>{read=true;return result;}))).rejects.toThrow();
    expect(read).toBe(false); expect(db.statements.at(-1)).toBe('rollback'); expect(db.client.release).toHaveBeenCalled();
  }
});
it('does not accept a fallback response or leak metadata between concurrent requests', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  await expect(withPilotSnapshot(policy,async()=>result)).rejects.toThrow();
  const db = database(state);
  const [a,b] = await Promise.allSettled([
    withPilotSnapshot(policy,()=>withOperationalSnapshot(db.pool,async()=>result)),
    withPilotSnapshot({...policy,snapshotHash:'b'.repeat(64)},()=>withOperationalSnapshot(db.pool,async()=>result)),
  ]);
  expect(a.status).toBe('fulfilled'); expect(b.status).toBe('rejected');
  expect((await withOperationalSnapshot(db.pool,async()=>result))).not.toHaveProperty('readCopy');
});
it('rejects pilot expiry before connecting and expiry during a read', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  let connected = false;
  await expect(withPilotSnapshot({...policy,expiresAt:now},async()=>{connected=true;return result;})).rejects.toThrow();
  expect(connected).toBe(false);
  const db = database(state);
  await expect(withPilotSnapshot(policy,()=>withOperationalSnapshot(db.pool,async()=>{
    vi.setSystemTime(policy.expiresAt); return result;
  }))).rejects.toThrow();
});
