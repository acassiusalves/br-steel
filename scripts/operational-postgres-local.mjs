// Runs only synthetic integration tests in a disposable, loopback-only PostgreSQL container.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { Pool } from 'pg';

const port = 55436;
const name = `brsteel-operational-test-${process.pid}`;
const password = randomBytes(24).toString('hex');
const image = 'public.ecr.aws/supabase/postgres:17.6.1.167';
const migrations = new URL('../supabase/operational/migrations/',import.meta.url);
const bootstrap = `mkdir -p /measure/data
chown -R postgres:postgres /measure
printf '%s' "$POSTGRES_PASSWORD" > /measure/password
chmod 600 /measure/password
chown postgres:postgres /measure/password
gosu postgres initdb -D /measure/data --username=postgres --pwfile=/measure/password --auth-host=scram-sha-256 --auth-local=trust >/dev/null
rm /measure/password
printf '\\nhost all all all scram-sha-256\\n' >> /measure/data/pg_hba.conf
exec gosu postgres postgres -D /measure/data -k /tmp -c listen_addresses='*' -c shared_buffers=32MB -c max_connections=20`;
let created = false;
function docker(args) {
  const r = spawnSync('docker',args,{ encoding:'utf8' });
  if (r.status!==0) throw new Error(`Docker operation failed (${args[0]})`);
  return r.stdout;
}
await new Promise((resolve,reject) => {
  const server = net.createServer(); server.once('error',reject);
  server.listen(port,'127.0.0.1',() => server.close(resolve));
});
try {
  docker(['run','--detach','--name',name,'--label','brsteel.purpose=operational-integration',
    '--memory','512m','--memory-swap','512m','--cpus','1','--publish',`127.0.0.1:${port}:5432`,
    '--env',`POSTGRES_PASSWORD=${password}`,'--volume','/measure','--entrypoint','bash',image,'-ec',bootstrap]);
  created = true;
  let ready = false;
  for (let i=0;i<60;i++) {
    const r=spawnSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres','-d','postgres'],{ stdio:'ignore' });
    if (r.status===0) { ready=true; break; }
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if (!ready) throw new Error('Local PostgreSQL did not become ready');
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/brsteel_ops_local`;
  const bootstrapPool = new Pool({ connectionString:url.replace('/brsteel_ops_local','/postgres'),max:1 });
  try { await bootstrapPool.query('create database brsteel_ops_local'); }
  finally { await bootstrapPool.end(); }
  const pool = new Pool({ connectionString:url,max:1 });
  try {
    // Simulate a Supabase anonymous principal to prove it has no operational access.
    await pool.query("do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;");
    for (const file of readdirSync(migrations).filter(file => file.endsWith('.sql')).sort()) {
      const rebuild = file.endsWith('_operational_read_models.sql');
      if (rebuild) {
        // Simulate a ready pre-projection copy in this fresh disposable database.
        await pool.query(`insert into brsteel_import.runs(id,source_project,captured_at,status,next_index,total_records,completed_at)
          values(repeat('a',64),'demo-brsteel-auth','2026-01-01','complete',0,0,now());
          insert into brsteel_import.state(singleton,source_project,active_run,ready) values(true,'demo-brsteel-auth',repeat('a',64),true);`);
      }
      await pool.query(readFileSync(new URL(file,migrations),'utf8'));
      if (rebuild) {
        const state = (await pool.query('select s.ready,r.status,r.next_index from brsteel_import.state s join brsteel_import.runs r on r.id=s.active_run')).rows[0];
        if (state.ready || state.status !== 'loading' || state.next_index !== 0) throw new Error('Existing copy was not invalidated for projection rebuild');
        await pool.query('delete from brsteel_import.state; delete from brsteel_import.runs');
        console.log('Existing copy invalidated for projection rebuild: passed');
      }
    }
    for (const role of ['anon', 'authenticated']) {
      await pool.query(`set role ${role}`);
      let denied = false;
      try { await pool.query('select * from brsteel_ops.sales_orders'); }
      catch (error) { denied=error.code==='42501'; }
      await pool.query('reset role');
      if (!denied) throw new Error('Direct API role access was not denied');
    }
    const catalog = (await pool.query(`select
      (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('brsteel_ops','brsteel_import') and c.relkind='r') as tables,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('brsteel_ops','brsteel_import') and c.relkind='r' and c.relrowsecurity) as rls_tables,
      (select count(*)::int from pg_constraint c join pg_namespace n on n.oid=c.connamespace
        where n.nspname in ('brsteel_ops','brsteel_import') and c.contype='f') as foreign_keys,
      (select count(*)::int from pg_indexes where schemaname in ('brsteel_ops','brsteel_import')) as indexes`)).rows[0];
    if (catalog.tables !== 13 || catalog.rls_tables !== 13 || catalog.foreign_keys !== 18 || catalog.indexes < 20) {
      throw new Error('Operational schema catalog verification failed');
    }
    console.log('Operational schema catalog:', JSON.stringify(catalog));
  } finally { await pool.end(); }
  if (process.env.BRSTEEL_PG_ADVISORS === '1') {
    // The repository's Supabase config belongs to OAuth and expects its own signing keys.
    const workdir = mkdtempSync(join(tmpdir(), 'brsteel-operational-advisors-'));
    try {
      const init = spawnSync('supabase', ['init','--workdir',workdir,'--yes'], { encoding:'utf8',timeout:30000 });
      if (init.status !== 0) throw new Error('Isolated Supabase advisor configuration failed');
      const advisors = spawnSync('supabase', ['db','advisors','--workdir',workdir,'--db-url',`${url}?sslmode=disable`,'--type','all','--level','warn',
        '--fail-on','error','--output-format','json'], { encoding:'utf8',timeout:30000 });
      console.log('Supabase local advisors:', (advisors.stdout + advisors.stderr).replaceAll(password, '[redacted]').trim());
      if (advisors.status !== 0) throw new Error('Supabase local advisors did not complete successfully');
    } finally { rmSync(workdir, { recursive:true,force:true }); }
  }
  const env = { ...process.env,PATH:`/opt/homebrew/opt/openjdk@21/bin:${process.env.PATH}`,BRSTEEL_PG_LOCAL_URL:url,FIRESTORE_EMULATOR_HOST:'127.0.0.1:8188',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID:'demo-brsteel-auth',GCLOUD_PROJECT:'demo-brsteel-auth' };
  const code = await new Promise((resolve,reject) => {
    const child=spawn('firebase',['emulators:exec','--only','firestore','--project','demo-brsteel-auth','--config','firebase.test.json',
      'node --conditions=react-server --import tsx --test --test-concurrency=1 tests/postgres/*.integration.ts'],{ env,stdio:'inherit' });
    child.once('error',reject); child.once('exit',c=>resolve(c ?? 1));
  });
  process.exitCode = code;
} catch (error) {
  // Do not print pg connection objects, payloads or password-bearing commands.
  console.error(error instanceof Error ? error.message.replaceAll(password,'[redacted]') : 'Local verification failed');
  if (created) {
    const logs=spawnSync('docker',['logs','--tail','25',name],{ encoding:'utf8' });
    console.error((logs.stdout+logs.stderr).replaceAll(password,'[redacted]'));
  }
  process.exitCode=1;
} finally {
  if (created) docker(['rm','--force','--volumes',name]);
}
