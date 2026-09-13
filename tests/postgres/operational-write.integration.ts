import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { withOperationalWrite } from '@/server/persistence/postgres-write';
import { recordWriteAudit, replayIdempotent, storeIdempotent, type WriteActor } from '@/server/persistence/write-audit';
import { withPilotSnapshot } from '@/server/persistence/pilot-snapshot';
import { COLLECTIONS, NATIVE_RUN_ID } from '@/server/migration/operational-snapshot';
import { createLocalImportPool, importSnapshot } from '@/server/migration/operational-import';

const url = process.env.BRSTEEL_PG_LOCAL_URL;
assert.ok(url);

const pool = new Pool({ connectionString: url, max: 4 });
const writerPool = new Pool({ connectionString: url, max: 4, options: '-c role=brsteel_ops_writer' });

const RUN = 'c'.repeat(64);
const actor: WriteActor = { userId: 'u1', source: 'web', clientId: null, idempotencyKey: null };

/** A ready copy is the precondition every write transaction checks before mutating. */
async function seedReadyCopy(ready = true) {
  await pool.query('truncate brsteel_import.runs cascade');
  await pool.query('truncate brsteel_write.audit, brsteel_write.idempotency');
  await pool.query(`insert into brsteel_import.runs (id, source_project, captured_at, status, next_index, total_records, completed_at)
    values ($1, 'brsteel-native', '-infinity', 'complete', 0, 0, '-infinity') on conflict (id) do nothing`, [NATIVE_RUN_ID]);
  await pool.query(`insert into brsteel_import.runs (id, source_project, captured_at, status, next_index, total_records, completed_at)
    values ($1, 'demo-brsteel-auth', now() - interval '1 hour', 'complete', 0, 0, now() - interval '1 hour')`, [RUN]);
  await pool.query(`insert into brsteel_import.state (singleton, source_project, active_run, ready, captured_at, completed_at)
    values (true, 'demo-brsteel-auth', $1, $2, now() - interval '1 hour', now() - interval '1 hour')
    on conflict (singleton) do update set active_run = excluded.active_run, ready = excluded.ready,
      captured_at = excluded.captured_at, completed_at = excluded.completed_at`, [RUN, ready]);
}

const insertSupply = (client: PoolClient, id: string) => client.query(
  `insert into brsteel_ops.supplies (source_id, payload, source_version, source_hash, import_run_id)
   values ($1, '{}'::jsonb, 1, $2, $3)`, [id, 'd'.repeat(64), RUN]);

const countSupply = async (id: string) =>
  (await pool.query('select count(*)::int as count from brsteel_ops.supplies where source_id = $1', [id])).rows[0].count;

const expectPermissionDenied = async (query: Promise<unknown>) => {
  await assert.rejects(query, (error: unknown) => (error as { code?: string }).code === '42501');
};

const asSessionRole = async (client: PoolClient, role: string, run: () => Promise<void>) => {
  await client.query(`set session authorization ${role}`);
  try {
    await run();
  } finally {
    await client.query('reset session authorization');
  }
};

after(async () => {
  await writerPool.end();
  await pool.end();
});

test('writer role exists with least privilege and no escalation path', async () => {
  const role = (await pool.query(`select rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
      rolreplication, rolbypassrls
    from pg_roles where rolname = 'brsteel_ops_writer'`)).rows;
  assert.deepEqual(role, [{
    rolcanlogin: false,
    rolinherit: true,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false,
  }]);

  const memberships = (await pool.query(`select granted.rolname as granted_role, member.rolname as member_role
    from pg_auth_members membership
    join pg_roles granted on granted.oid = membership.roleid
    join pg_roles member on member.oid = membership.member
    where granted.rolname = 'brsteel_ops_writer'
       or member.rolname = 'brsteel_ops_writer'`)).rows;
  assert.deepEqual(memberships, []);
});

test('reader cannot write to operational tables', async () => {
  const client = await pool.connect();
  try {
    await asSessionRole(client, 'brsteel_ops_reader', async () => {
      await expectPermissionDenied(client.query(
        `insert into brsteel_ops.supplies (source_id, payload, source_version, source_hash, import_run_id)
         values ('probe', '{}'::jsonb, 1, repeat('a', 64), 'probe')`));
    });
  } finally {
    client.release();
  }
});

test('write transaction commits only against a ready copy and never inside a pilot scope', async () => {
  await seedReadyCopy();
  await withOperationalWrite(writerPool, client => insertSupply(client, 'ready-1'));
  assert.equal(await countSupply('ready-1'), 1);

  await seedReadyCopy(false);
  await assert.rejects(
    withOperationalWrite(writerPool, client => insertSupply(client, 'not-ready')),
    /not ready/i);
  assert.equal(await countSupply('not-ready'), 0);

  // A pilot copy is a read-only artifact with a 24h expiry; writing into it must be impossible.
  await seedReadyCopy();
  const policy = { sourceProject: 'demo-brsteel-auth', snapshotHash: RUN, expiresAt: Date.now() + 60_000 };
  await assert.rejects(
    withPilotSnapshot(policy, async () => {
      await withOperationalWrite(writerPool, client => insertSupply(client, 'pilot'));
      return { data: null, source: 'postgres' as const, asOf: '', warnings: [], nextCursor: null };
    }),
    /pilot/i);
  assert.equal(await countSupply('pilot'), 0);
});

test('serialization conflicts retry instead of losing an update', async () => {
  await seedReadyCopy();
  await pool.query(`insert into brsteel_ops.production_counters (source_id, payload, source_version, source_hash, import_run_id)
    values ('2026', '{"sequence": 0}'::jsonb, 1, $1, $2)`, ['e'.repeat(64), RUN]);

  const bump = () => withOperationalWrite(writerPool, async client => {
    const current = Number((await client.query(
      `select payload->>'sequence' as sequence from brsteel_ops.production_counters where source_id = '2026'`)).rows[0].sequence);
    await new Promise(resolve => setTimeout(resolve, 20));
    await client.query(
      `update brsteel_ops.production_counters set payload = jsonb_build_object('sequence', $1::int) where source_id = '2026'`,
      [current + 1]);
  });

  await Promise.all([bump(), bump(), bump()]);
  const final = (await pool.query(
    `select payload->>'sequence' as sequence from brsteel_ops.production_counters where source_id = '2026'`)).rows[0].sequence;
  assert.equal(final, '3', 'every concurrent increment must survive');
});

test('audit and idempotency share the transaction of the effect they describe', async () => {
  await seedReadyCopy();

  // A failing audit row aborts the effect it was supposed to describe.
  await assert.rejects(withOperationalWrite(writerPool, async client => {
    await insertSupply(client, 'audit-fail');
    await recordWriteAudit(client, { operation: 'supplies.create',
      actor: { ...actor, source: 'bogus' as unknown as 'web' }, target: { collection: 'supplies', id: 'audit-fail' } });
  }));
  assert.equal(await countSupply('audit-fail'), 0);

  await withOperationalWrite(writerPool, async client => {
    await insertSupply(client, 'audited');
    await recordWriteAudit(client, { operation: 'supplies.create', actor,
      target: { collection: 'supplies', id: 'audited' } });
  });
  const audit = (await pool.query(`select operation, user_id, source, target_id from brsteel_write.audit`)).rows;
  assert.deepEqual(audit, [{ operation: 'supplies.create', user_id: 'u1', source: 'web', target_id: 'audited' }]);

  // Replaying the same key returns the stored response without a second effect.
  const keyed: WriteActor = { ...actor, idempotencyKey: 'k1' };
  const request = { sku: 'A' };
  const once = async () => withOperationalWrite(writerPool, async client => {
    const replayed = await replayIdempotent<{ id: string }>(client, keyed, 'supplies.create', request);
    if (replayed) return replayed;
    await insertSupply(client, 'idem');
    const response = { id: 'idem' };
    await storeIdempotent(client, keyed, 'supplies.create', request, response);
    return response;
  });
  assert.deepEqual(await once(), { id: 'idem' });
  assert.deepEqual(await once(), { id: 'idem' });
  assert.equal(await countSupply('idem'), 1);

  // The same key with a different request is a conflict, not a silent replay.
  await assert.rejects(withOperationalWrite(writerPool, client =>
    replayIdempotent(client, keyed, 'supplies.create', { sku: 'B' })),
    (error: unknown) => (error as { code?: string }).code === 'IDEMPOTENCY_CONFLICT');
});

test('writer cannot touch import bookkeeping or escalate', async () => {
  // Escalation is checked against the session user, so it needs real session authorization: a pool
  // built with `-c role=` keeps postgres as the session user and would pass `set role` vacuously.
  const client = await pool.connect();
  try {
    await asSessionRole(client, 'brsteel_ops_writer', async () => {
      await expectPermissionDenied(client.query(`insert into brsteel_import.runs
        (id, source_project, captured_at, status, total_records)
        values (repeat('9', 64), 'probe', now(), 'loading', 0)`));
      await expectPermissionDenied(client.query('set role brsteel_ops_importer'));
      await expectPermissionDenied(client.query('set role brsteel_ops_backup'));
      await expectPermissionDenied(client.query('update brsteel_write.audit set operation = operation where false'));
      await expectPermissionDenied(client.query('delete from brsteel_write.audit where false'));
      await expectPermissionDenied(client.query('create table brsteel_ops.writer_forbidden (id integer)'));
    });
  } finally {
    client.release();
  }
});

test('api roles stay locked out of the native write schema', async () => {
  const client = await pool.connect();
  try {
    for (const apiRole of ['anon', 'authenticated']) {
      await asSessionRole(client, apiRole, async () => {
        await expectPermissionDenied(client.query('select * from brsteel_write.audit'));
        await expectPermissionDenied(client.query('select * from brsteel_write.idempotency'));
      });
    }
    const rls = (await pool.query(`select bool_and(c.relrowsecurity) as rls from pg_class c
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'brsteel_write' and c.relkind = 'r'`)).rows[0];
    assert.equal(rls.rls, true);
  } finally {
    client.release();
  }
});

test('native rows survive an import that reconciles snapshot documents', async () => {
  await seedReadyCopy();
  await pool.query(`insert into brsteel_ops.supplies (source_id, payload, source_version, source_hash, import_run_id)
    values ('native-1', '{"codigo": "N1"}'::jsonb, 1, $1, $2)`, ['f'.repeat(64), NATIVE_RUN_ID]);

  const importPool = createLocalImportPool(url!);
  try {
    // A complete but empty snapshot is the sharpest case: every snapshot document is absent.
    await importSnapshot(importPool, { formatVersion: 1, sourceProject: 'demo-brsteel-auth',
      capturedAt: new Date().toISOString(), completeCollections: [...COLLECTIONS], records: [] });
  } finally {
    await importPool.end();
  }

  const row = (await pool.query(
    `select source_deleted from brsteel_ops.supplies where source_id = 'native-1'`)).rows[0];
  assert.equal(row?.source_deleted, false, 'a native row must not be reconciled away by a snapshot import');
});
