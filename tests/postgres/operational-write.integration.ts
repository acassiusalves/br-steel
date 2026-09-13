import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { withOperationalWrite } from '@/server/persistence/postgres-write';
import { recordWriteAudit, replayIdempotent, storeIdempotent, type WriteActor } from '@/server/persistence/write-audit';
import { withPilotSnapshot } from '@/server/persistence/pilot-snapshot';
import { COLLECTIONS, NATIVE_RUN_ID } from '@/server/migration/operational-snapshot';
import { createLocalImportPool, importSnapshot } from '@/server/migration/operational-import';
import { createPostgresSuppliesWriteRepository } from '@/server/persistence/postgres-supplies-write';
import type { SupplyFields, SuppliesWriteRepository } from '@/server/persistence/supplies-write-contract';
import { firestoreSuppliesWriteRepository } from '@/server/persistence/firestore-supplies-write';
import { createSuppliesWriteOperations } from '@/server/operations/supplies';
import { createProductionWriteOperations } from '@/server/operations/production';
import { firestoreProductionWriteRepository } from '@/server/persistence/firestore-production-write';
import type { ProductionWriteRepository } from '@/server/persistence/production-write-contract';
import { initializeApp, getApps } from 'firebase-admin/app';
import { createPostgresSalesIngestRepository } from '@/server/persistence/postgres-sales-ingest';
import { firestoreSalesIngestRepository } from '@/server/persistence/firestore-sales-ingest';
import type { SalesIngestRepository } from '@/server/persistence/sales-ingest-contract';
import { createPostgresProductionWriteRepository } from '@/server/persistence/postgres-production-write';
import type { WriteIdentity } from '@/server/persistence/production-write-contract';
import { pagePermissions } from '@/lib/permissions';
import { mcpCapabilities } from '@/lib/mcp-capabilities';
import type { AccessContext } from '@/server/access/types';

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
    // Half an hour back: newer than the seeded copy, but never ahead of the database clock that
    // stamps completed_at, which the ready_copy_metadata constraint compares it against.
    await importSnapshot(importPool, { formatVersion: 1, sourceProject: 'demo-brsteel-auth',
      capturedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      completeCollections: [...COLLECTIONS], records: [] });
  } finally {
    await importPool.end();
  }

  const row = (await pool.query(
    `select source_deleted from brsteel_ops.supplies where source_id = 'native-1'`)).rows[0];
  assert.equal(row?.source_deleted, false, 'a native row must not be reconciled away by a snapshot import');
});

const supplies = createPostgresSuppliesWriteRepository(writerPool);
const fields = (overrides: Partial<SupplyFields> = {}): SupplyFields => ({
  nome: 'Chapa', codigo: 'SKU-1', gtin: '', unidade: 'UN',
  precoCusto: 10, estoqueMinimo: 2, estoqueMaximo: 20, tempoEntrega: 1, ...overrides,
});
const balanceOf = async (id: string) => Number((await pool.query(
  `select payload->>'estoqueAtual' as balance from brsteel_ops.supplies where source_id = $1`, [id])).rows[0].balance);

test('SQL supplies keep SKU uniqueness, balance and movement in one transaction', async () => {
  await seedReadyCopy();

  const created = await supplies.create(fields(), actor);
  assert.equal(created.source, 'postgres');
  assert.equal(await balanceOf(created.data.id), 0);
  // The lookup key the read adapter paginates by must be populated by the write, not by an import.
  assert.equal((await pool.query(
    `select lookup_sku from brsteel_ops.supplies where source_id = $1`, [created.data.id])).rows[0].lookup_sku, 'SKU-1');
  assert.equal((await pool.query('select count(*)::int as count from brsteel_ops.supply_codes')).rows[0].count, 1);

  await assert.rejects(supplies.create(fields(), actor),
    (error: unknown) => (error as { code?: string }).code === 'DUPLICATE_SKU');
  assert.equal((await pool.query('select count(*)::int as count from brsteel_ops.supplies')).rows[0].count, 1);

  const movement = await supplies.recordMovement({ supplyId: created.data.id, type: 'entrada', quantity: 7 }, actor);
  assert.equal(movement.data.newStock, 7);
  assert.equal(await balanceOf(created.data.id), 7);
  const stored = (await pool.query(
    `select payload->>'balanceAfter' as after, payload->>'createdBy' as by from brsteel_ops.inventory_movements`)).rows;
  assert.deepEqual(stored, [{ after: '7', by: 'u1' }]);

  const negative = await supplies.recordMovement({ supplyId: created.data.id, type: 'saida', quantity: 9 }, actor);
  assert.equal(negative.data.newStock, -2);
  assert.ok(negative.warnings.some(warning => warning.includes('negativo')));

  await assert.rejects(supplies.recordMovement({ supplyId: 'missing', type: 'entrada', quantity: 1 }, actor),
    (error: unknown) => (error as { code?: string }).code === 'NOT_FOUND');
  // A rejected movement leaves no orphan row behind.
  assert.equal((await pool.query('select count(*)::int as count from brsteel_ops.inventory_movements')).rows[0].count, 2);
});

test('SQL supplies move the uniqueness key atomically and protect records in use', async () => {
  await seedReadyCopy();
  const first = await supplies.create(fields(), actor);
  const second = await supplies.create(fields({ codigo: 'SKU-2' }), actor);

  await assert.rejects(supplies.update(first.data.id, { codigo: 'SKU-2' }, actor),
    (error: unknown) => (error as { code?: string }).code === 'DUPLICATE_SKU');
  await assert.rejects(supplies.update(first.data.id, { estoqueMinimo: 99 }, actor),
    (error: unknown) => (error as { code?: string }).code === 'INVALID_LIMITS');

  await supplies.update(first.data.id, { codigo: 'SKU-3' }, actor);
  const codes = (await pool.query(
    `select payload->>'supplyId' as supply from brsteel_ops.supply_codes order by source_id`)).rows.map(r => r.supply);
  assert.equal(codes.length, 2, 'the old key is removed in the same transaction as the new one');
  assert.equal((await pool.query(
    `select lookup_sku from brsteel_ops.supplies where source_id = $1`, [first.data.id])).rows[0].lookup_sku, 'SKU-3');
  assert.deepEqual(await supplies.findBySku('SKU-3'), [first.data.id]);
  assert.deepEqual(await supplies.findBySku('SKU-1'), []);

  await supplies.recordMovement({ supplyId: second.data.id, type: 'entrada', quantity: 1 }, actor);
  await supplies.recordMovement({ supplyId: second.data.id, type: 'saida', quantity: 1 }, actor);
  // Balance is zero again but history remains, so the record must stay.
  await assert.rejects(supplies.remove(second.data.id, actor),
    (error: unknown) => (error as { code?: string }).code === 'SUPPLY_IN_USE');

  await supplies.remove(first.data.id, actor);
  assert.equal((await pool.query(
    'select count(*)::int as count from brsteel_ops.supplies where not source_deleted')).rows[0].count, 1);
  assert.equal((await pool.query('select count(*)::int as count from brsteel_ops.supply_codes')).rows[0].count, 1);
});

test('concurrent SQL movements never lose an update and duplicate SKUs never both win', async () => {
  await seedReadyCopy();
  const supply = await supplies.create(fields(), actor);

  await Promise.all(Array.from({ length: 5 }, () =>
    supplies.recordMovement({ supplyId: supply.data.id, type: 'entrada', quantity: 2 }, actor)));
  assert.equal(await balanceOf(supply.data.id), 10, 'every concurrent movement must be applied exactly once');
  assert.equal((await pool.query('select count(*)::int as count from brsteel_ops.inventory_movements')).rows[0].count, 5);

  const races = await Promise.allSettled(Array.from({ length: 4 }, () => supplies.create(fields({ codigo: 'RACE' }), actor)));
  assert.equal(races.filter(r => r.status === 'fulfilled').length, 1, 'exactly one creation may win the SKU');
  assert.equal((await pool.query(
    `select count(*)::int as count from brsteel_ops.supplies where lookup_sku = 'RACE' and not source_deleted`)).rows[0].count, 1);
});

const admin: AccessContext = { actor: { userId: 'u1', role: 'Administrador', source: 'web' }, active: true,
  capabilities: mcpCapabilities.map(capability => capability.key), permissions: pagePermissions, inactivePages: [] };

/**
 * Runs the same script through the operation boundary and records what a caller would observe.
 * Identifiers and timing differ by construction, so they are normalized away; everything else must match.
 */
async function trace(repository: SuppliesWriteRepository) {
  const ops = createSuppliesWriteOperations(repository);
  const steps: unknown[] = [];
  const ids: Record<string, string> = {};
  const run = async (label: string, action: () => Promise<{ data: unknown; warnings: string[] }>) => {
    try {
      const response = await action();
      const data = { ...(response.data as Record<string, unknown>) };
      if (typeof data.id === 'string') { ids[label] = data.id; data.id = `<${label}>`; }
      steps.push({ label, data, warnings: response.warnings });
    } catch (error) {
      steps.push({ label, error: (error as { code?: string }).code ?? String(error), status: (error as { status?: number }).status });
    }
  };

  await run('create-a', () => ops.createSupply(admin, fields({ codigo: 'EQ-1' })));
  await run('create-duplicate', () => ops.createSupply(admin, fields({ codigo: 'EQ-1' })));
  await run('create-bad-limits', () => ops.createSupply(admin, fields({ codigo: 'EQ-X', estoqueMinimo: 9, estoqueMaximo: 3 })));
  await run('create-b', () => ops.createSupply(admin, fields({ codigo: 'EQ-2' })));
  await run('in', () => ops.recordMovement(admin, { supplyId: ids['create-a'], type: 'entrada', quantity: 7 }));
  await run('out', () => ops.recordMovement(admin, { supplyId: ids['create-a'], type: 'saida', quantity: 9 }));
  await run('limits-invalid', () => ops.updateSupplyLimits(admin, { sku: 'EQ-1', estoqueMinimo: 99 }));
  await run('limits-ok', () => ops.updateSupplyLimits(admin, { sku: 'EQ-1', estoqueMinimo: 1, estoqueMaximo: 5 }));
  await run('limits-missing', () => ops.updateSupplyLimits(admin, { sku: 'NAO-EXISTE', estoqueMinimo: 1 }));
  await run('remove-unused', () => ops.deleteSupplyRecord(admin, ids['create-b']));
  await run('remove-in-use', () => ops.deleteSupplyRecord(admin, ids['create-a']));
  await run('remove-missing', () => ops.deleteSupplyRecord(admin, 'nao-existe'));
  return steps;
}

test('Firestore and PostgreSQL supplies write adapters are observationally equivalent', async () => {
  await seedReadyCopy();
  const sql = await trace(supplies);

  const reset = await fetch(
    'http://127.0.0.1:8188/emulator/v1/projects/demo-brsteel-auth/databases/(default)/documents', { method: 'DELETE' });
  assert.ok(reset.ok, 'the Firestore emulator must be reachable for the comparison to mean anything');
  const firestore = await trace(firestoreSuppliesWriteRepository);

  assert.deepEqual(sql, firestore);
  // A trace where every step failed would compare equal and prove nothing.
  assert.ok(sql.filter(step => !(step as { error?: string }).error).length >= 6, JSON.stringify(sql));
});

const production = createPostgresProductionWriteRepository(writerPool);
const author: WriteIdentity = { userId: 'u1', userName: 'Operador' };
const YEAR = new Date().getUTCFullYear();

/** Lots reference a column and items reference both the lot and a sales order, so both must exist. */
async function seedProductionBase() {
  await seedReadyCopy();
  for (const [table, id, payload] of [
    ['production_columns', 'queue', { name: 'Fila', order: 0, color: '#000000' }],
    ['sales_orders', '123', { id: 123, numero: 456, itens: [{ codigo: 'SKU', descricao: 'Steel', quantidade: 5, unidade: 'KG' }] }],
  ] as const) {
    await pool.query(`insert into brsteel_ops.${table} (source_id, payload, source_version, source_hash, import_run_id)
      values ($1, $2, 1, $3, $4)`, [id, JSON.stringify(payload), 'a'.repeat(64), RUN]);
  }
}
const lotInput = (quantity = 2) => ({ title: 'Lote', columnId: 'queue', priority: 'normal' as const,
  items: [{ sourceOrderId: 123, sku: 'SKU', quantity }] });

test('SQL lot numbers are annual, consecutive and never repeat under concurrency', async () => {
  await seedProductionBase();

  const first = await production.createLot(lotInput(), { author, assignedTo: null }, actor);
  assert.equal(first.data.lotNumber, `LOT-${YEAR}-0001`);
  assert.equal(first.source, 'postgres');

  const concurrent = await Promise.all(Array.from({ length: 4 }, () =>
    production.createLot(lotInput(0.5), { author, assignedTo: null }, actor)));
  const numbers = concurrent.map(response => response.data.lotNumber);
  assert.equal(new Set(numbers).size, 4, `concurrent lots must not repeat a number: ${numbers.join()}`);
  assert.deepEqual([...numbers].sort(), [2, 3, 4, 5].map(n => `LOT-${YEAR}-000${n}`));

  // Column order keeps appending rather than colliding on the same position.
  const orders = (await pool.query(
    `select payload->>'columnOrder' as position from brsteel_ops.production_lots order by (payload->>'columnOrder')::int`))
    .rows.map(row => Number(row.position));
  assert.deepEqual(orders, [0, 1, 2, 3, 4]);
});

test('SQL lots bootstrap the counter from legacy numbers instead of colliding', async () => {
  await seedProductionBase();
  // A migrated lot that already carries a number, with no counter row yet.
  await pool.query(`insert into brsteel_ops.production_lots (source_id, payload, source_version, source_hash, import_run_id)
    values ('legacy', $1, 1, $2, $3)`,
    [JSON.stringify({ title: 'Legado', columnId: 'queue', columnOrder: 0, lotNumber: `LOT-${YEAR}-0042` }), 'b'.repeat(64), RUN]);

  const created = await production.createLot(lotInput(), { author, assignedTo: null }, actor);
  assert.equal(created.data.lotNumber, `LOT-${YEAR}-0043`, 'the counter must start above the highest legacy number');

  // A number minted in another column is still a number: ignoring it would mint a duplicate.
  const other = await production.createColumn({ name: 'Outra', order: 1, color: '#123456' }, actor);
  await pool.query(`insert into brsteel_ops.production_lots (source_id, payload, source_version, source_hash, import_run_id)
    values ('legacy-outra', $1, 1, $2, $3)`,
    [JSON.stringify({ title: 'Legado', columnId: other.data.id, columnOrder: 0, lotNumber: `LOT-${YEAR}-0100` }), 'c'.repeat(64), RUN]);
  const after = await production.createLot(lotInput(), { author, assignedTo: null }, actor);
  assert.equal(after.data.lotNumber, `LOT-${YEAR}-0101`);
});

test('SQL production enforces item, column and comment rules', async () => {
  await seedProductionBase();
  await assert.rejects(production.createLot({ ...lotInput(), items: [{ sourceOrderId: 123, sku: 'OUTRO', quantity: 1 }] },
    { author, assignedTo: null }, actor), (error: unknown) => (error as { code?: string }).code === 'INVALID_ITEM');
  await assert.rejects(production.createLot(lotInput(6), { author, assignedTo: null }, actor),
    (error: unknown) => (error as { code?: string }).code === 'INVALID_QUANTITY');
  await assert.rejects(production.createLot({ ...lotInput(), columnId: 'missing' }, { author, assignedTo: null }, actor),
    (error: unknown) => (error as { code?: string }).code === 'NOT_FOUND');

  const lot = await production.createLot(lotInput(), { author, assignedTo: null }, actor);
  await assert.rejects(production.deleteColumn('queue', actor),
    (error: unknown) => (error as { code?: string }).code === 'COLUMN_NOT_EMPTY');

  const other = await production.createColumn({ name: 'Outra', order: 1, color: '#123456' }, actor);
  await assert.rejects(production.reorderLotsInColumn(other.data.id, [{ id: lot.data.id, order: 0 }], actor),
    (error: unknown) => (error as { code?: string }).code === 'INVALID_COLUMN');

  const comment = await production.createComment({ lotId: lot.data.id, content: 'Olá' }, author, actor);
  await assert.rejects(production.changeComment(comment.data.id, 'x', { isAdmin: false },
    { ...actor, userId: 'outro' }), (error: unknown) => (error as { code?: string }).code === 'FORBIDDEN');
  await production.changeComment(comment.data.id, 'pelo admin', { isAdmin: true }, { ...actor, userId: 'outro' });

  // Deleting a lot removes its items and comments in the same transaction.
  await production.deleteLot(lot.data.id, actor);
  for (const table of ['production_lot_items', 'production_comments']) {
    assert.equal((await pool.query(`select count(*)::int as count from brsteel_ops.${table}`)).rows[0].count, 0, table);
  }
});

const operator: AccessContext = { ...admin, actor: { userId: 'operator', role: 'Operador', source: 'web' } };
const outsider: AccessContext = { ...admin, actor: { userId: 'outro', role: 'Operador', source: 'web' } };

const resetFirestore = async () => {
  const response = await fetch(
    'http://127.0.0.1:8188/emulator/v1/projects/demo-brsteel-auth/databases/(default)/documents', { method: 'DELETE' });
  assert.ok(response.ok, 'the Firestore emulator must be reachable');
};

/** The identity store is shared by both adapters: users are not part of the operational core. */
async function seedIdentities() {
  if (!getApps().length) initializeApp({ projectId: 'demo-brsteel-auth' });
  const { getFirestore } = await import('firebase-admin/firestore');
  const db = getFirestore();
  await db.collection('users').doc('operator').set({ role: 'Operador', name: 'Actual Operator', active: true });
  await db.collection('users').doc('u1').set({ role: 'Administrador', name: 'Chefe', active: true });
  await db.collection('users').doc('outro').set({ role: 'Operador', name: 'Outro', active: true });
  return db;
}

async function productionTrace(repository: ProductionWriteRepository) {
  const ops = createProductionWriteOperations(repository);
  const steps: unknown[] = [];
  const ids: Record<string, string> = {};
  const run = async (label: string, action: () => Promise<{ data: unknown }>) => {
    try {
      const response = await action();
      const data = response.data === null ? null : { ...(response.data as Record<string, unknown>) };
      if (data && typeof data.id === 'string') { ids[label] = data.id; data.id = `<${label}>`; }
      steps.push({ label, data });
    } catch (error) {
      steps.push({ label, error: (error as { code?: string }).code ?? String(error), status: (error as { status?: number }).status });
    }
  };

  await run('column', () => ops.createColumn(operator, { name: 'Fila', order: 0, color: '#000000' }));
  const columnId = ids.column;
  const lotOf = (items: unknown[]) => ({ title: 'Lote', columnId, priority: 'normal', items });
  await run('lot', () => ops.createLot(operator, lotOf([{ sourceOrderId: 123, sku: 'SKU', quantity: 2 }])));
  await run('lot-bad-sku', () => ops.createLot(operator, lotOf([{ sourceOrderId: 123, sku: 'X', quantity: 1 }])));
  await run('lot-excess', () => ops.createLot(operator, lotOf([{ sourceOrderId: 123, sku: 'SKU', quantity: 9 }])));
  await run('lot-missing-column', () => ops.createLot(operator, { ...lotOf([{ sourceOrderId: 123, sku: 'SKU', quantity: 1 }]), columnId: 'nao-existe' }));
  await run('lot-ghost-author', () => ops.createLot({ ...operator, actor: { ...operator.actor, userId: 'fantasma' } }, lotOf([{ sourceOrderId: 123, sku: 'SKU', quantity: 1 }])));
  await run('column-2', () => ops.createColumn(operator, { name: 'Outra', order: 1, color: '#123456' }));
  await run('reorder-wrong-column', () => ops.reorderLotsInColumn(operator, ids['column-2'], [{ id: ids.lot, order: 0 }]));
  await run('delete-column-in-use', () => ops.deleteColumn(operator, columnId));
  await run('comment', () => ops.createComment(operator, { lotId: ids.lot, content: 'Olá' }));
  await run('comment-outsider', () => ops.updateComment(outsider, ids.comment, 'ataque'));
  await run('comment-admin', () => ops.updateComment(admin, ids.comment, 'pelo admin'));
  await run('delete-lot', () => ops.deleteLot(operator, ids.lot));
  await run('delete-column', () => ops.deleteColumn(operator, columnId));
  return steps;
}

test('Firestore and PostgreSQL production write adapters are observationally equivalent', async () => {
  await seedProductionBase();
  await resetFirestore();
  const db = await seedIdentities();
  const sqlSteps = await productionTrace(production);

  // The SQL trace ran against the seeded columns/orders; give Firestore the same starting point.
  await db.collection('salesOrders').doc('123').set({ id: 123, numero: 456, total: 999,
    contato: { nome: 'Private', cpf: 'secret' }, xml: 'secret',
    itens: [{ codigo: 'SKU', descricao: 'Steel', quantidade: 5, unidade: 'KG', valor: 100 }] });
  const firestoreSteps = await productionTrace(firestoreProductionWriteRepository);

  assert.deepEqual(sqlSteps, firestoreSteps);
  assert.ok(sqlSteps.filter(step => !(step as { error?: string }).error).length >= 7, JSON.stringify(sqlSteps));
});

test('production lot items never carry commercial data from the order', async () => {
  await seedProductionBase();
  await resetFirestore();
  await seedIdentities();
  await pool.query(`update brsteel_ops.sales_orders set payload = $1 where source_id = '123'`,
    [JSON.stringify({ id: 123, numero: 456, total: 999, contato: { nome: 'Private', cpf: 'secret' }, xml: 'secret',
      itens: [{ codigo: 'SKU', descricao: 'Steel', quantidade: 5, unidade: 'KG', valor: 100 }] })]);

  const ops = createProductionWriteOperations(production);
  const lot = await ops.createLot(operator, { title: 'Lote', columnId: 'queue', priority: 'normal',
    items: [{ sourceOrderId: 123, sku: 'SKU', quantity: 2 }] });

  const items = (await pool.query('select payload from brsteel_ops.production_lot_items')).rows.map(row => row.payload);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { lotId: lot.data.id, sku: 'SKU', quantity: 2, productName: 'Steel', unit: 'KG',
    sourceOrderId: 123, sourceOrderNumber: '456', customerName: '', createdAt: items[0].createdAt });
  const serialized = JSON.stringify(items);
  for (const leak of ['secret', 'Private', 'cpf', 'xml', '999', '100']) {
    assert.ok(!serialized.includes(leak), `production items leaked ${leak}: ${serialized}`);
  }
});

const ingest = createPostgresSalesIngestRepository(writerPool);
const order = (id: number, total: number, itens: unknown[] = [{ codigo: 'A', quantidade: 1, valor: total }]) =>
  ({ id, numero: id, data: '2026-09-01', total, contato: { id }, itens });

test('SQL ingest is idempotent, preserves item order and distinguishes deleted from absent', async () => {
  await seedReadyCopy();

  const first = await ingest.upsertOrders([order(1, 100), order(2, 200)]);
  assert.deepEqual(first, { count: 2, created: 2, updated: 0 });
  const again = await ingest.upsertOrders([order(1, 100)]);
  assert.deepEqual(again, { count: 1, created: 0, updated: 1 }, 'reprocessing the same order is an update, not a duplicate');
  assert.equal((await pool.query('select count(*)::int as count from brsteel_ops.sales_orders')).rows[0].count, 2);

  // The item array order is part of the contract; the projection is rebuilt, never appended to.
  await ingest.upsertOrders([order(1, 100, [{ codigo: 'B', quantidade: 2 }, { codigo: 'C', quantidade: 3 }])]);
  const items = (await pool.query(
    `select position, payload->>'codigo' as codigo from brsteel_ops.sales_order_items
     where order_id = '1' order by position`)).rows;
  assert.deepEqual(items, [{ position: 0, codigo: 'B' }, { position: 1, codigo: 'C' }]);

  await ingest.markOrderDeleted('1', '2026-09-12T00:00:00.000Z');
  const deleted = (await pool.query(
    `select payload->>'deleted' as deleted, payload->>'deletedAt' as at from brsteel_ops.sales_orders where source_id = '1'`)).rows[0];
  assert.deepEqual(deleted, { deleted: 'true', at: '2026-09-12T00:00:00.000Z' });
  // An event for an order that was never stored must not conjure a row.
  await ingest.markOrderDeleted('999', '2026-09-12T00:00:00.000Z');
  assert.equal((await pool.query(`select count(*)::int as count from brsteel_ops.sales_orders where source_id = '999'`)).rows[0].count, 0);
});

test('SQL stock observations rebuild the read projection instead of drifting', async () => {
  await seedReadyCopy();
  await ingest.applyStockObservation('B', { sku: 'B', estoqueAtual: 5, webhookReceivedAt: '2026-09-01T00:00:00Z' });
  await ingest.applyStockObservation('A', { sku: 'A', estoqueAtual: 0, webhookReceivedAt: '2026-09-02T00:00:00Z' });

  const rows = (await pool.query(
    `select source_id, sku_order, stock_read->>'saldoVirtualTotal' as virtual, stock_read->>'saldoFisicoTotal' as physical
     from brsteel_ops.stock_observations order by sku_order`)).rows;
  // Inserting A after B must renumber both, not append A at the end.
  assert.deepEqual(rows.map(row => row.source_id), ['A', 'B']);
  assert.deepEqual(rows.map(row => row.sku_order), [0, 1]);
  // A real zero stays zero; an unknown physical balance stays null.
  assert.equal(rows[0].virtual, '0');
  assert.equal(rows[0].physical, null);

  await ingest.applyStockObservation('A', { estoqueAtual: 9, webhookReceivedAt: '2026-09-03T00:00:00Z' });
  const merged = (await pool.query(
    `select payload->>'sku' as sku, stock_read->>'saldoVirtualTotal' as virtual from brsteel_ops.stock_observations where source_id = 'A'`)).rows[0];
  assert.deepEqual(merged, { sku: 'A', virtual: '9' }, 'a partial observation merges instead of dropping known fields');
});

async function ingestTrace(repository: SalesIngestRepository) {
  const steps: unknown[] = [];
  steps.push(await repository.upsertOrders([order(1, 100), order(2, 200)]));
  steps.push(await repository.upsertOrders([order(1, 150)]));
  steps.push(await repository.upsertOrders([]));
  // A sparse re-save: the detail fetch failed, so only the list-shaped order comes back. Firestore
  // merges, keeping itens and the invoice fields; replacing the payload would destroy them.
  steps.push(await repository.upsertOrders([{ id: 3, numero: 3, total: 300, xml: 'NF', itens: [{ codigo: 'Z', quantidade: 7 }] }]));
  steps.push(await repository.upsertOrders([{ id: 3, total: 350 }]));
  // An undefined field is dropped by serialize on both sides; without it the SQL hash rejects the write.
  steps.push(await repository.upsertOrders([{ id: 4, numero: 4, total: 400, xml: undefined, itens: [] }]));
  await repository.markOrderDeleted('2', '2026-09-12T00:00:00.000Z');
  await repository.markOrderDeleted('404', '2026-09-12T00:00:00.000Z');
  await repository.applyStockObservation('A', { sku: 'A', estoqueAtual: 0, webhookReceivedAt: '2026-09-02T00:00:00Z' });
  return steps;
}

test('Firestore and PostgreSQL ingest adapters agree on counts and final state', async () => {
  await seedReadyCopy();
  const sqlSteps = await ingestTrace(ingest);
  const sqlOrders = (await pool.query(
    `select source_id, payload->>'total' as total, coalesce(payload->>'deleted','false') as deleted,
            coalesce(payload->>'xml','') as xml,
            coalesce(jsonb_array_length(payload->'itens')::text,'0') as itens
     from brsteel_ops.sales_orders order by source_id`)).rows;
  const sqlItems = (await pool.query(
    `select order_id, count(*)::int as items from brsteel_ops.sales_order_items group by order_id order by order_id`)).rows;

  await resetFirestore();
  const firestoreSteps = await ingestTrace(firestoreSalesIngestRepository);
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ projectId: 'demo-brsteel-auth' });
  const snapshot = await getFirestore().collection('salesOrders').orderBy('__name__').get();
  const firestoreOrders = snapshot.docs.map(doc => ({ source_id: doc.id, total: String(doc.data().total),
    deleted: String(doc.data().deleted ?? false), xml: String(doc.data().xml ?? ''),
    itens: String((doc.data().itens ?? []).length) }));

  assert.deepEqual(sqlSteps, firestoreSteps, 'created/updated counts must agree');
  assert.deepEqual(sqlOrders, firestoreOrders, 'final stored state must agree');
  assert.deepEqual(sqlSteps[0], { count: 2, created: 2, updated: 0 });
  assert.deepEqual(sqlSteps[1], { count: 1, created: 0, updated: 1 });
  // The sparse re-save must not have emptied the item projection.
  assert.deepEqual(sqlItems, [{ order_id: '1', items: 1 }, { order_id: '2', items: 1 }, { order_id: '3', items: 1 }]);
});

test('an import refuses to reclaim a natively written row instead of overwriting it', async () => {
  await seedReadyCopy();
  // A native lot counter, the sharpest case: the id is deterministic and shared with Firestore, and
  // letting the snapshot win would walk the sequence backwards and mint duplicate lot numbers.
  await pool.query(`insert into brsteel_ops.production_counters (source_id, payload, source_version, source_hash, import_run_id)
    values ($1, '{"sequence": 42}'::jsonb, 1, $2, $3)`, [`production-lots-${YEAR}`, 'a'.repeat(64), NATIVE_RUN_ID]);

  const importPool = createLocalImportPool(url!);
  try {
    await assert.rejects(importSnapshot(importPool, { formatVersion: 1, sourceProject: 'demo-brsteel-auth',
      capturedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), completeCollections: [...COLLECTIONS],
      records: [{ collection: 'operationsMetadata', id: `production-lots-${YEAR}`, version: '100', data: { sequence: 3 } }] }),
      /collision/i);
  } finally {
    await importPool.end();
  }

  // The refusal must leave the native value intact, not half-applied.
  const kept = (await pool.query(
    `select payload->>'sequence' as sequence, import_run_id from brsteel_ops.production_counters where source_id = $1`,
    [`production-lots-${YEAR}`])).rows[0];
  assert.deepEqual(kept, { sequence: '42', import_run_id: NATIVE_RUN_ID });
});
