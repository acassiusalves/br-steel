// Operational recovery rehearsal only. Never restores into an existing or remote database.
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, unlink, rename, stat, open } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import net from 'node:net';
import { Pool } from 'pg';
import { backupConnection, assertSameManifest, privateLocation, manifest, project, sourceProject, localDockerEndpoint, copyHash } from './lib/operational-backup.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const image='public.ecr.aws/supabase/postgres:17.6.1.167';
const container=`brsteel-backup-restore-${randomUUID()}`;
const children=new Set();
let created=false,stage='configuration',pool,proxy,dockerHost,interrupted=false,sourceClient;
const dockerEnv={...process.env};
for(const name of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete dockerEnv[name];
const report={startedAt:new Date().toISOString(),project,sourceProject,cleanup:{containerRemoved:false}};
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{
  interrupted=true;for(const p of children)p.kill();sourceClient?.end().catch(()=>{});
});
function child(binary,args,options={}) {
  if(interrupted&&stage!=='cleanup')throw new Error('Interrupted');
  if(binary==='docker'&&dockerHost){args=['--host',dockerHost,...args];options={...options,env:dockerEnv};}
  const p=spawn(binary,args,{stdio:['pipe','pipe','ignore'],...options});
  children.add(p);
  const timer=setTimeout(()=>p.kill('SIGKILL'),180000);timer.unref();
  const done=new Promise((res,rej)=>{
    p.once('error',()=>{clearTimeout(timer);children.delete(p);rej(new Error('Child failed'));});
    p.once('close',code=>{clearTimeout(timer);children.delete(p);code===0?res():rej(new Error('Child failed'));});
  });
  // Callers may wire a pipeline before awaiting this process.
  done.catch(()=>{});
  return {p,done};
}
async function command(binary,args,input) {
  const {p,done}=child(binary,args); const chunks=[];
  p.stdout.on('data',b=>chunks.push(b)); p.stdin.end(input);
  await done; return Buffer.concat(chunks).toString('utf8');
}
function progress(value) { stage=value; console.log(JSON.stringify({stage})); }
async function localQuery(sql) {
  const prefix="set timezone='UTC'; set extra_float_digits=3; set search_path=pg_catalog; ";
  const select=/^select\b/i.test(sql.trim());
  const wrapped=select?`select coalesce(json_agg(q),'[]'::json) from (${sql}) q`:sql;
  const out=await command('docker',['exec','-i',container,'psql','-h','/tmp','-U','postgres','-d','postgres','-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],prefix+wrapped+';');
  return {rows:select?JSON.parse(out):[]};
}
async function makeProxy(host,port) {
  const sockets=new Set(),counts={received:0,sent:0,connections:0};
  const server=net.createServer(down=>{
    counts.connections++; const up=net.connect(port,host); sockets.add(down);sockets.add(up);
    down.on('data',b=>{counts.sent+=b.length;}); up.on('data',b=>{counts.received+=b.length;});
    down.on('error',()=>up.destroy());up.on('error',()=>down.destroy());
    down.on('close',()=>{sockets.delete(down);up.destroy();});up.on('close',()=>sockets.delete(up));
    down.pipe(up);up.pipe(down);
  });
  await new Promise((res,rej)=>{server.once('error',rej);server.listen(0,'127.0.0.1',res);});
  return {port:server.address().port,counts,close:()=>new Promise(res=>{for(const s of sockets)s.destroy();server.close(res);})};
}
async function restore(archive,identity) {
  const age=child('age',['--decrypt','--identity',identity,archive]); age.p.stdin.end();
  const pg=child('docker',['exec','-i',container,'pg_restore','-h','/tmp','-U','postgres','-d','postgres',
    '--no-owner','--exit-on-error','--single-transaction']); pg.p.stdout.resume();
  try { await Promise.all([pipeline(age.p.stdout,pg.p.stdin),age.done,pg.done]); }
  catch { age.p.kill();pg.p.kill();await Promise.allSettled([age.done,pg.done]);throw new Error('Restore failed'); }
}
async function run() {
  const mode=process.argv[2];
  if (!['backup','restore'].includes(mode)||process.argv.length!==3) throw new Error('Expected backup or restore');
  const dir=await privateLocation(process.env.BRSTEEL_BACKUP_DIRECTORY,'directory',repo);
  const identity=await privateLocation(process.env.BRSTEEL_BACKUP_IDENTITY,'file',repo);
  await privateLocation(identity,'file',dir); // Identity must be outside the entire archive directory tree.
  const hash=copyHash(process.env.BRSTEEL_BACKUP_SNAPSHOT_HASH);
  const archive=join(dir,'operational.dump.age'),manifestPath=join(dir,'manifest.json');
  const reportPath=join(dir,mode==='backup'?'drill.json':`restore-${Date.now()}.json`);
  const handle=await open(reportPath,'wx',0o600);await handle.close();
  let expected;
  try {
    dockerHost=localDockerEndpoint((await command('docker',['context','inspect','--format','{{.Endpoints.docker.Host}}'])).trim());
    if(process.env.DOCKER_HOST)dockerHost=localDockerEndpoint(process.env.DOCKER_HOST);
    if(!(await stat(decodeURIComponent(new URL(dockerHost).pathname))).isSocket())throw new Error('Docker socket unavailable');
    await command('docker',['info','--format','{{.ServerVersion}}']);
    report.docker={endpoint:'local Unix socket',network:'none',image};
    if (mode==='backup') {
      progress('backup-preflight');
      // Reserve both output names before establishing a remote connection.
      const reservation=await open(archive,'wx',0o600);await reservation.close();
      const caPath=process.env.BRSTEEL_BACKUP_CA;
      const config=backupConnection(process.env.BRSTEEL_BACKUP_URL,await readFile(caPath,'utf8'));
      const recipient=(await command('age-keygen',['-y',identity])).trim();
      if (!/^age1[0-9a-z]+$/.test(recipient)) throw new Error('Invalid recipient');
      pool=new Pool(config);pool.on('error',()=>{});
      const client=await pool.connect();sourceClient=client;
      try {
        const info=(await client.query("select current_user, session_user,current_database() db,r.rolsuper,r.rolbypassrls from pg_roles r where rolname=current_user")).rows[0];
        if(info.current_user!=='brsteel_backup_probe'||info.session_user!==info.current_user||info.db!=='postgres'||info.rolsuper||info.rolbypassrls)
          throw new Error('Unexpected backup principal');
        await client.query("begin isolation level repeatable read read only; set local idle_in_transaction_session_timeout='5min'");
        const copy=(await client.query('select active_run,ready,source_project,captured_at::text,completed_at::text from brsteel_import.state where singleton')).rows[0];
        if (!copy?.ready||copy.active_run!==hash||copy.source_project!==sourceProject||!copy.captured_at||!copy.completed_at) throw new Error('Copy mismatch');
        const snapshot=(await client.query('select pg_export_snapshot() snapshot')).rows[0].snapshot;
        expected=await manifest(q=>client.query(q));
        // Controller provides a privileged, aggregate-only manifest from the same stable copy.
        const baseline=JSON.parse(await readFile(process.env.BRSTEEL_BACKUP_PRIVILEGED_MANIFEST,'utf8'));
        assertSameManifest(baseline,expected);
        await writeFile(manifestPath,JSON.stringify({hash,copy,manifest:expected},null,2)+'\n',{flag:'wx',mode:0o600});
        proxy=await makeProxy(config.host,config.port);
        const pgBin=process.env.BRSTEEL_BACKUP_PG_BIN||'/opt/homebrew/opt/libpq@17/bin';
        const version=(await command(join(pgBin,'pg_dump'),['--version'])).trim();
        if(!/^pg_dump \(PostgreSQL\) 17\./.test(version))throw new Error('PostgreSQL 17 dump client required');
        const env={PATH:process.env.PATH,PGHOST:config.host,PGHOSTADDR:'127.0.0.1',PGPORT:String(proxy.port),PGUSER:config.user,
          PGPASSWORD:config.password,PGDATABASE:'postgres',PGSSLMODE:'verify-full',PGSSLROOTCERT:caPath,PGCONNECT_TIMEOUT:'10',
          PGOPTIONS:'-c statement_timeout=120000 -c lock_timeout=10000 -c default_transaction_read_only=on'};
        progress('encrypted-dump');const start=performance.now();let plainBytes=0;
        const pg=child(join(pgBin,'pg_dump'),['--format=custom','--compress=gzip:6','--schema=brsteel_ops','--schema=brsteel_import',
          '--strict-names','--enable-row-security',`--snapshot=${snapshot}`],{env});pg.p.stdin.end();
        const age=child('age',['--encrypt','--recipient',recipient]);
        const meter=new Transform({transform(b,e,cb){plainBytes+=b.length;cb(null,b);}});
        try { await Promise.all([pipeline(pg.p.stdout,meter,age.p.stdin),pipeline(age.p.stdout,createWriteStream(archive+'.partial',{flags:'wx',mode:0o600})),pg.done,age.done]); }
        catch {pg.p.kill();age.p.kill();await Promise.allSettled([pg.done,age.done]);throw new Error('Encrypted dump failed');}
        await rename(archive+'.partial',archive);
        report.backup={durationMs:performance.now()-start,pgDumpVersion:version,compressedBytes:plainBytes,
          encryptedBytes:(await stat(archive)).size,tcp:{...proxy.counts},copy};
        await proxy.close();proxy=null;
        await client.query('commit');
      } finally { await client.query('rollback').catch(()=>{});client.release();sourceClient=null;await pool.end();pool=null; }
    } else {
      const saved=JSON.parse(await readFile(manifestPath,'utf8'));
      if(saved.hash!==hash)throw new Error('Copy hash mismatch');expected=saved.manifest;
    }
    progress('isolated-restore');const recoveryStart=performance.now();
    const bootstrap="mkdir -p /measure/data; chown -R postgres:postgres /measure; gosu postgres initdb -D /measure/data --username=postgres --auth-local=trust --auth-host=reject >/dev/null; exec gosu postgres postgres -D /measure/data -k /tmp -c listen_addresses='' -c shared_buffers=32MB -c max_connections=10";
    created=true;
    await command('docker',['run','--detach','--name',container,'--label','brsteel.purpose=backup-restore','--network','none',
      '--memory','512m','--memory-swap','512m','--cpus','1','--volume','/measure','--entrypoint','bash',image,'-ec',bootstrap]);
    let ready=false;
    for(let i=0;i<60;i++) {
      if(interrupted)throw new Error('Interrupted');
      if(spawnSync('docker',['--host',dockerHost,'exec',container,'pg_isready','-h','/tmp','-U','postgres'],{stdio:'ignore',timeout:10000,env:dockerEnv}).status===0){ready=true;break;}
      await new Promise(r=>setTimeout(r,500));
    }
    if(!ready)throw new Error('Local database unavailable');
    for(const name of ['anon','authenticated','brsteel_ops_reader','brsteel_ops_importer','brsteel_ops_backup'])
      await localQuery(`create role ${name} nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls`);
    // An altered authenticated ciphertext must fail and leave no partial schemas in a single-transaction restore.
    const bad=join(dir,'tampered.age');const bytes=await readFile(archive);bytes[Math.floor(bytes.length/2)]^=1;
    await writeFile(bad,bytes,{flag:'wx',mode:0o600});
    try {
      let refused=false;try{await restore(bad,identity);}catch{refused=true;}
      const remaining=(await localQuery("select count(*)::int count from pg_namespace where nspname in ('brsteel_ops','brsteel_import')")).rows[0].count;
      if(!refused||remaining!==0)throw new Error('Tamper protection or rollback failed');
      report.tamper={rejected:true,partialSchemas:remaining};
    }finally{await unlink(bad);}
    const restoreStart=performance.now();await restore(archive,identity);report.restoreMs=performance.now()-restoreStart;
    progress('content-and-permission-verification');
    const actual=await manifest(localQuery);assertSameManifest(expected,actual);
    report.content={tables:actual.tables,totalRows:actual.tables.reduce((n,t)=>n+t.rows,0),catalogMatched:true,
      rlsTables:actual.catalog.tables.filter(t=>t[2]).length,foreignKeys:actual.catalog.constraints.filter(c=>c[3]==='f').length,indexes:actual.catalog.indexes.length};
    const privileges=(await localQuery(`select
      not has_schema_privilege('anon','brsteel_ops','USAGE') and not has_schema_privilege('authenticated','brsteel_ops','USAGE') as api_denied,
      has_table_privilege('brsteel_ops_backup','brsteel_import.runs','SELECT') as backup_reads_runs,
      not has_table_privilege('brsteel_ops_backup','brsteel_ops.sales_orders','UPDATE') as backup_write_denied`)).rows[0];
    if(Object.values(privileges).some(v=>v!==true))throw new Error('Restored permissions mismatch');report.privileges=privileges;
    const backupRead=await command('docker',['exec','-i',container,'psql','-h','/tmp','-U','postgres','-d','postgres','-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],
      'set role brsteel_ops_backup; select count(*) from brsteel_ops.sales_orders;');
    if(Number(backupRead.trim())!==actual.tables.find(t=>t.name==='brsteel_ops.sales_orders').rows)throw new Error('Backup role cannot read restored rows');
    let writeRejected=false;
    try{await localQuery('begin; set local role brsteel_ops_backup; update brsteel_ops.sales_orders set source_deleted=true where false; rollback');}
    catch{writeRejected=true;}
    if(!writeRejected)throw new Error('Restored backup role allows UPDATE');report.privileges.actualBackupWriteRejected=true;
    report.recoveryDurationMs=performance.now()-recoveryStart;
    const digest=createHash('sha256');for await(const chunk of createReadStream(archive))digest.update(chunk);report.archiveSha256=digest.digest('hex');
    report.status='complete';
  }catch(error){report.status='failed';report.failedStage=stage;throw error;}
  finally {
    stage='cleanup';
    try {
      for(const p of children)p.kill();
      if(proxy){await proxy.close();proxy=null;}if(pool){await pool.end();pool=null;}
      if(created){
        const exists=spawnSync('docker',['--host',dockerHost,'container','inspect',container],{stdio:'ignore',timeout:10000,env:dockerEnv}).status===0;
        if(exists)await command('docker',['rm','--force','--volumes',container]);
        const remaining=await command('docker',['ps','--all','--quiet','--filter',`name=^/${container}$`]);
        if(remaining.trim())throw new Error('Container cleanup incomplete');
        created=false;report.cleanup.containerRemoved=true;
      }
      await unlink(archive+'.partial').catch(e=>{if(e.code!=='ENOENT')throw e;});
    }catch(error){
      report.status='failed';report.cleanup.failed=true;throw error;
    }finally{
      report.finishedAt=new Date().toISOString();await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});
    }
  }
  console.log(JSON.stringify(report));
}
run().catch(()=>{console.error(JSON.stringify({status:'failed',stage,message:'Backup rehearsal failed; inspect aggregate report. No remote restore was attempted.'}));process.exitCode=1;});
