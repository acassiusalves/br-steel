import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupConnection, assertSameManifest, privateLocation, localDockerEndpoint, copyHash } from '../../scripts/lib/operational-backup.mjs';

const valid='postgresql://brsteel_backup_probe.mlumbvxpaqfzpdjnvzxc:secret@aws-0-sa-east-1.pooler.supabase.com:5432/postgres';
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
    valid.replace('mlumbvxpaqfzpdjnvzxc','anotherproject'), valid+'?sslmode=disable', valid+'#fragment',
    valid.replace('aws-0-sa-east-1.pooler.supabase.com','127.0.0.1'), valid.replace(':secret','')]) {
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
