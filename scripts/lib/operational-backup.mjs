import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const project='mlumbvxpaqfzpdjnvzxc';
export const sourceProject='marketflow-9h4tg';
export const tables = ['brsteel_import.runs','brsteel_import.state',
  ...['inventory_movements','production_columns','production_comments','production_counters',
    'production_lot_items','production_lots','sales_order_items','sales_orders','stock_observations','supplies','supply_codes'].map(n=>'brsteel_ops.'+n)];

export function backupConnection(value, ca) {
  const u=new URL(value);
  if (!['postgres:','postgresql:'].includes(u.protocol) || u.hostname!=='aws-0-sa-east-1.pooler.supabase.com'
    || u.port!=='5432' || u.pathname!=='/postgres' || u.search || u.hash || !u.password || !ca?.trim()
    || decodeURIComponent(u.username)!==`brsteel_backup_probe.${project}`) throw new Error('Invalid backup connection');
  return {host:u.hostname,port:5432,user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:'postgres',ssl:{rejectUnauthorized:true,ca},max:1,connectionTimeoutMillis:10000,
    statement_timeout:120000,application_name:'brsteel-backup-drill'};
}

export function assertSameManifest(a,b) {
  if (!isDeepStrictEqual(a,b)) throw new Error('Restored manifest differs');
}

export function localDockerEndpoint(value) {
  if(!/^unix:\/\/\/[^?#]+$/.test(value))throw new Error('Local Docker Unix socket required');
  return value;
}

export function copyHash(value) {
  if(!/^[a-f0-9]{64}$/.test(value??''))throw new Error('Expected copy hash');
  return value;
}

export async function privateLocation(path,kind,repo) {
  if (!isAbsolute(path)) throw new Error('Absolute private location required');
  const info=await lstat(path),actual=await realpath(path),root=await realpath(repo);
  const inside=relative(root,actual);
  if (info.isSymbolicLink() || !inside || (!(inside==='..'||inside.startsWith('..'+sep)) && !isAbsolute(inside))
    || (info.mode & 0o077) || (kind==='file' ? !info.isFile() : !info.isDirectory())
    || info.uid!==process.getuid()) throw new Error('Private location required outside repository');
  return actual;
}

const scope="('brsteel_ops','brsteel_import')";
export const catalogSql=`select jsonb_build_object(
  'tables',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,
    (select jsonb_agg(x::text order by x::text) from unnest(c.relacl) x)) order by n.nspname,c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${scope} and c.relkind='r'),
  'schemas',(select jsonb_agg(jsonb_build_array(nspname,(select jsonb_agg(x::text order by x::text) from unnest(nspacl) x)) order by nspname)
    from pg_namespace where nspname in ${scope}),
  'columns',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,a.attname,format_type(a.atttypid,a.atttypmod),
    a.attnotnull,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),co.collname) order by n.nspname,c.relname,a.attnum)
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum left join pg_collation co on co.oid=a.attcollation
    where n.nspname in ${scope} and c.relkind='r' and a.attnum>0 and not a.attisdropped),
  'constraints',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid)) order by n.nspname,c.relname,k.conname)
    from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${scope}),
  'indexes',(select jsonb_agg(jsonb_build_array(schemaname,tablename,indexname,indexdef) order by schemaname,tablename,indexname)
    from pg_indexes where schemaname in ${scope}),
  'policies',(select jsonb_agg(jsonb_build_array(schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check) order by schemaname,tablename,policyname)
    from pg_policies where schemaname in ${scope}),
  'defaultAcl',(select jsonb_agg(jsonb_build_array(r.rolname,n.nspname,d.defaclobjtype,
    (select jsonb_agg(x::text order by x::text) from unnest(d.defaclacl) x)) order by r.rolname,n.nspname,d.defaclobjtype)
    from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace join pg_roles r on r.oid=d.defaclrole where n.nspname in ${scope})
) as catalog`;

// Full row hashes include payload, generated projections, references and import metadata.
// Sorting fixed-length hashes preserves duplicates and avoids relying on locale/primary-key types.
export function tableManifestSql(table) {
  if (!tables.includes(table)) throw new Error('Unexpected table');
  return `select count(*)::int as rows,encode(sha256(convert_to(coalesce(string_agg(h,'' order by h collate "C"),''),'UTF8')),'hex') as sha256
    from (select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h from ${table} t) hashed`;
}

export async function manifest(query) {
  await query("set timezone='UTC'; set extra_float_digits=3; set search_path=pg_catalog");
  const catalog=(await query(catalogSql)).rows[0].catalog;
  if (catalog.tables?.length!==13 || catalog.tables.some(t=>!t[2]) || catalog.constraints.filter(c=>c[3]==='f').length!==18)
    throw new Error('Unexpected operational catalog');
  const rows=[];
  for (const name of tables) rows.push({name,...(await query(tableManifestSql(name))).rows[0]});
  return {tables:rows,catalog};
}
