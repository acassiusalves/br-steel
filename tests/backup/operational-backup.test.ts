import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupConnection, assertSameManifest, privateLocation, localDockerEndpoint, copyHash, catalogSql, manifest, restoredManifest, tableManifestSql, tables } from '../../scripts/lib/operational-backup.mjs';

const valid='postgresql://brsteel_backup_probe.mmewkphsrnttkzvpyddv:secret@aws-1-sa-east-1.pooler.supabase.com:5432/postgres';
test('Docker restore rejects remote daemons and pins an absolute local socket',()=>{
  assert.equal(localDockerEndpoint('unix:///Users/test/.colima/docker.sock'),'unix:///Users/test/.colima/docker.sock');
  for(const value of ['ssh://server','tcp://127.0.0.1:2375','unix://relative.sock','unix:///tmp/a.sock?remote=true'])
    assert.throws(()=>localDockerEndpoint(value));
});
test('copy identity requires exactly a lowercase SHA256',()=>{
  assert.equal(copyHash('a'.repeat(64)),'a'.repeat(64));
  for(const h of ['',null,undefined,'A'.repeat(64),'a'.repeat(63),'a'.repeat(65),'g'.repeat(64)])assert.throws(()=>copyHash(h));
});
test('accepts only the dedicated backup identity on the verified session endpoint', () => {
  assert.equal(backupConnection(valid, 'CERT').ssl.rejectUnauthorized, true);
  for (const value of [valid.replace('5432','6543'), valid.replace('backup_probe','pilot_importer'),
    valid.replace('mmewkphsrnttkzvpyddv','anotherproject'), valid+'?sslmode=disable', valid+'#fragment',
    valid.replace('aws-1-sa-east-1.pooler.supabase.com','127.0.0.1'), valid.replace(':secret','')]) {
    assert.throws(()=>backupConnection(value,'CERT'));
  }
  assert.throws(()=>backupConnection(valid,''));
});
test('comparison catches lost data, a changed row, weakened permissions and missing constraints', () => {
  const source={tables:[{name:'orders',rows:2,sha256:'abc'}],catalog:{policies:['reader'],constraints:['fk'],grants:['select']}};
  assert.doesNotThrow(()=>assertSameManifest(source,structuredClone(source)));
  const mutations: Array<(x: typeof source)=>void>=[x=>x.tables[0].rows--, x=>x.tables[0].sha256='changed', x=>x.catalog.grants.push('update'), x=>x.catalog.constraints.pop()];
  for (const mutate of mutations) {
    const changed=structuredClone(source); mutate(changed); assert.throws(()=>assertSameManifest(source,changed));
  }
});
test('private locations reject public permissions, repository contents and symlinks', async () => {
  const base=await mkdtemp(join(tmpdir(),'brsteel-backup-test-'));
  try {
    const folder=join(base,'output'), key=join(base,'identity');
    await mkdir(folder,{mode:0o700}); await writeFile(key,'private',{mode:0o600});
    await privateLocation(folder,'directory',process.cwd());
    await privateLocation(key,'file',process.cwd());
    const nested=join(folder,'keys');await mkdir(nested,{mode:0o700});
    const nestedKey=join(nested,'identity');await writeFile(nestedKey,'private',{mode:0o600});
    await assert.rejects(privateLocation(nestedKey,'file',folder));
    await chmod(key,0o644); await assert.rejects(privateLocation(key,'file',process.cwd()));
    await symlink(folder,join(base,'link')); await assert.rejects(privateLocation(join(base,'link'),'directory',process.cwd()));
    await assert.rejects(privateLocation(process.cwd(),'directory',process.cwd()));
    const root=join(base,'repo'),disguised=join(root,'..backup');
    await mkdir(root,{mode:0o700});await mkdir(disguised,{mode:0o700});
    await assert.rejects(privateLocation(disguised,'directory',root));
  } finally { await rm(base,{recursive:true,force:true}); }
});

const coverageTable = 'brsteel_pcp.sales_invoice_sync_state';
const previousTables = tables.filter(name => name !== coverageTable);

function savedManifest(names: readonly string[]) {
  return {
    tables: names.map(name => ({ name, rows: 2, sha256: 'a'.repeat(64) })),
    catalog: {
      tables: names.map(name => [...name.split('.'), true, false, ['postgres=arwdDxt/postgres']]),
      constraints: Array.from({ length: 55 }, (_, id) => ['brsteel_pcp', 'sales_invoices', `fk-${id}`, 'f']),
      policies: [['brsteel_pcp', 'sales_invoices', 'backup_reader', 'PERMISSIVE', ['brsteel_ops_backup'], 'SELECT']],
    },
  };
}

function restoredQuery(backup: ReturnType<typeof savedManifest>) {
  return async (sql: string) => {
    if (sql.startsWith('set ')) return { rows: [] };
    if (sql === catalogSql) return { rows: [{ catalog: backup.catalog }] };
    const row = backup.tables.find(({ name }) => tableManifestSql(name) === sql);
    assert.ok(row, 'only known tables may be queried');
    return { rows: [{ rows: row.rows, sha256: row.sha256 }] };
  };
}

test('new backups require the complete current table list, including fiscal coverage', async () => {
  const current = savedManifest(tables);
  assert.deepEqual(await manifest(restoredQuery(current)), current);
  await assert.rejects(manifest(restoredQuery(savedManifest(previousTables))), /Unexpected operational catalog/);
  current.catalog.tables[0][1] = 'foreign_runs';
  await assert.rejects(manifest(restoredQuery(current)), /Unexpected operational catalog/);
  assert.throws(() => tableManifestSql('brsteel_import.foreign_runs'), /Unexpected table/);
});

test('restore verifies the saved 40-table or current manifest without weakening comparisons', async () => {
  assert.equal(previousTables.length, 40);
  const previous = savedManifest(previousTables);
  const current = savedManifest(tables);
  assert.deepEqual(await restoredManifest(restoredQuery(previous), previous), previous);
  assert.deepEqual(await restoredManifest(restoredQuery(current), current), current);
  await assert.rejects(restoredManifest(restoredQuery(previous), current), /Unexpected operational catalog/);
  await assert.rejects(restoredManifest(restoredQuery(current), previous), /Unexpected operational catalog/);

  const reordered = structuredClone(previous);
  reordered.tables.reverse();
  await assert.rejects(restoredManifest(restoredQuery(previous), reordered), /Unexpected.*manifest/i);

  const wrongTable = structuredClone(previous);
  wrongTable.tables[0].name = 'brsteel_import.foreign_runs';
  await assert.rejects(restoredManifest(restoredQuery(previous), wrongTable), /Unexpected.*manifest/i);

  const changed = structuredClone(previous);
  changed.tables[0].sha256 = 'b'.repeat(64);
  await assert.rejects(restoredManifest(restoredQuery(changed), previous), /Restored manifest differs/);
  changed.tables[0].sha256 = 'a'.repeat(64);
  changed.catalog.policies[0][5] = 'ALL';
  await assert.rejects(restoredManifest(restoredQuery(changed), previous), /Restored manifest differs/);
  changed.catalog.tables[0][2] = false;
  await assert.rejects(restoredManifest(restoredQuery(changed), changed), /Unexpected operational catalog/);
  changed.catalog.tables[0][2] = true;
  changed.catalog.constraints.pop();
  await assert.rejects(restoredManifest(restoredQuery(changed), changed), /Unexpected operational catalog/);
});
