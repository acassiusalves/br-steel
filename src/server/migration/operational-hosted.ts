import { Pool, type PoolClient, type PoolConfig } from 'pg';

export const HOSTED_PROJECT = 'mlumbvxpaqfzpdjnvzxc';
export const HOSTED_SOURCE = 'marketflow-9h4tg';
type Purpose = 'reader' | 'importer';
const hostedPools = new WeakMap<Pool, Purpose>();

/** Explicit endpoints verified for this project. Never pass URL SSL overrides to pg. */
export function hostedPoolConfig(connectionString: string, purpose: Purpose, ca?: string): PoolConfig {
  const url = new URL(connectionString), role = `brsteel_pilot_${purpose}`;
  const direct = url.hostname === `db.${HOSTED_PROJECT}.supabase.co`;
  const pooled = url.hostname === 'aws-0-sa-east-1.pooler.supabase.com';
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooled)
    || url.pathname !== '/postgres' || url.search || url.hash || !url.password
    || decodeURIComponent(url.username) !== (direct ? role : `${role}.${HOSTED_PROJECT}`)
    || !(url.port === '5432' || (pooled && purpose === 'reader' && url.port === '6543'))) {
    throw new Error('Explicit hosted pilot connection required');
  }
  return { host:url.hostname,port:Number(url.port),database:'postgres',user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),ssl:{ rejectUnauthorized:true,...(ca ? { ca } : {}) },
    max:1,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,statement_timeout:30000,
    application_name:`brsteel-hosted-pilot-${purpose}` };
}

export function createHostedPilotPool(connectionString: string, purpose: Purpose, ca?: string): Pool {
  const pool = new Pool(hostedPoolConfig(connectionString,purpose,ca));
  hostedPools.set(pool,purpose);
  return pool;
}

export function assertHostedSource(sourceProject: string) {
  if (sourceProject !== HOSTED_SOURCE) throw new Error('Hosted pilot source mismatch');
}

export function assertHostedIdentity(row: Record<string,unknown>, purpose: Purpose) {
  const role = `brsteel_pilot_${purpose}`;
  if (row.db !== 'postgres' || row.actor !== role || row.login !== role || row.superuser !== false || row.bypassrls !== false) {
    throw new Error('Hosted pilot database identity mismatch');
  }
}

/** Unregistered pools retain the original local-only guard. */
export async function checkImportTarget(pool: Pool, client: PoolClient, sourceProject: string) {
  const purpose = hostedPools.get(pool);
  if (!purpose) {
    if ((await client.query('select current_database() as db')).rows[0].db !== 'brsteel_ops_local') throw new Error('Local import target required');
    return;
  }
  if (purpose !== 'importer') throw new Error('Hosted importer connection required');
  assertHostedSource(sourceProject);
  await checkHostedConnection(client,purpose);
}

export async function checkHostedConnection(client: PoolClient, purpose: Purpose) {
  const row = (await client.query(`select current_database() as db,current_user as actor,session_user as login,
    rolsuper as superuser,rolbypassrls as bypassrls from pg_roles where rolname=current_user`)).rows[0];
  assertHostedIdentity(row ?? {},purpose);
}
