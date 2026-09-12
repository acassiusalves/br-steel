import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';

assert.ok(process.env.BRSTEEL_PG_LOCAL_URL);

const pool = new Pool({ connectionString: process.env.BRSTEEL_PG_LOCAL_URL, max: 1 });
const tables = [
  'brsteel_import.runs',
  'brsteel_import.state',
  'brsteel_ops.sales_orders',
  'brsteel_ops.stock_observations',
  'brsteel_ops.supplies',
  'brsteel_ops.production_columns',
  'brsteel_ops.production_counters',
  'brsteel_ops.supply_codes',
  'brsteel_ops.inventory_movements',
  'brsteel_ops.production_lots',
  'brsteel_ops.production_lot_items',
  'brsteel_ops.production_comments',
  'brsteel_ops.sales_order_items',
] as const;

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
  await pool.query('drop schema if exists brsteel_backup_probe cascade');
  await pool.end();
});

test('backup role reads every current operational table without mutation or escalation privileges', async () => {
  const role = (await pool.query(`select rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
      rolreplication, rolbypassrls
    from pg_roles where rolname = 'brsteel_ops_backup'`)).rows;
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
    where (granted.rolname = 'brsteel_ops_backup' and member.rolname in ('brsteel_ops_reader', 'brsteel_ops_importer'))
       or (member.rolname = 'brsteel_ops_backup' and granted.rolname in ('brsteel_ops_reader', 'brsteel_ops_importer'))`)).rows;
  assert.deepEqual(memberships, []);

  const schemas = (await pool.query(`select namespace.nspname
    from pg_namespace namespace
    cross join lateral aclexplode(namespace.nspacl) privilege
    join pg_roles grantee on grantee.oid = privilege.grantee
    where grantee.rolname = 'brsteel_ops_backup'
      and privilege.privilege_type = 'USAGE'
    order by namespace.nspname`)).rows.map(row => row.nspname);
  assert.deepEqual(schemas, ['brsteel_import', 'brsteel_ops']);

  const policies = (await pool.query(`select schemaname || '.' || tablename as table_name, policyname, cmd, roles, qual
    from pg_policies
    where 'brsteel_ops_backup' = any(roles)
    order by table_name`)).rows;
  assert.deepEqual(policies.map(policy => policy.table_name), [...tables].sort());
  assert.ok(policies.every(policy => policy.policyname === 'backup_reader'
    && policy.cmd === 'SELECT'
    && policy.qual === 'true'
    && policy.roles === '{brsteel_ops_backup}'), JSON.stringify(policies));

  await pool.query('create schema brsteel_backup_probe');
  await pool.query('revoke all on schema brsteel_backup_probe from public');
  await pool.query('create table brsteel_backup_probe.secret (value text)');
  await pool.query("insert into brsteel_backup_probe.secret values ('not-for-backup')");

  const client = await pool.connect();
  try {
    await asSessionRole(client, 'brsteel_ops_backup', async () => {
      for (const table of tables) {
        assert.equal((await client.query(`select count(*)::int as count from ${table}`)).rows[0].count >= 0, true);
      }
      await expectPermissionDenied(client.query(`insert into brsteel_import.runs
        (id, source_project, captured_at, status, total_records)
        values (repeat('f', 64), 'backup-probe', now(), 'loading', 0)`));
      await expectPermissionDenied(client.query('update brsteel_ops.sales_orders set source_deleted = source_deleted where false'));
      await expectPermissionDenied(client.query('delete from brsteel_ops.sales_orders where false'));
      await expectPermissionDenied(client.query('truncate brsteel_ops.sales_orders'));
      await expectPermissionDenied(client.query('set role brsteel_ops_importer'));
      await expectPermissionDenied(client.query('create table brsteel_ops.backup_forbidden (id integer)'));
      await expectPermissionDenied(client.query('select * from brsteel_backup_probe.secret'));
    });

    for (const apiRole of ['anon', 'authenticated']) {
      await asSessionRole(client, apiRole, async () => {
        for (const table of tables) {
          await expectPermissionDenied(client.query(`select * from ${table}`));
        }
      });
    }
  } finally {
    client.release();
  }
});
