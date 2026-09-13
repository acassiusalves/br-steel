import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withStableCopy, recordPilotReport } from '@/server/migration/operational-pilot-evidence';

it('rejects benchmark results if an import finishes or starts during the samples', async () => {
  for (const next of [{ready:true,active_run:'B'},{ready:false,active_run:'A'}]) {
    let state={ready:true,active_run:'A'};
    await expect(withStableCopy('A',async()=>state,async()=>{state=next;return ['mixed readings'];})).rejects.toThrow(/changed/);
  }
  await expect(withStableCopy('A',async()=>({ready:true,active_run:'A'}),async()=>42)).resolves.toBe(42);
});

it('records failures without exception details and never overwrites an existing report', async () => {
  const directory=await mkdtemp(join(tmpdir(),'pilot-report-test-')),path=join(directory,'report.json');
  try {
    const failure=Object.assign(new Error('SECRET-ROW-PAYLOAD'),{code:'08006'});
    await expect(recordPilotReport(path,'verify',async()=>{throw failure;})).rejects.toBe(failure);
    const text=await readFile(path,'utf8'),report=JSON.parse(text);
    expect(report.status).toBe('failed');expect(report.code).toBe('08006');
    expect(report.finishedAt).toMatch(/^\d{4}-/);expect(text).not.toContain('SECRET-ROW-PAYLOAD');
    await expect(recordPilotReport(path,'import',async()=>({status:'complete'}))).rejects.toThrow();
    expect(await readFile(path,'utf8')).toBe(text);
  } finally {await rm(directory,{recursive:true,force:true});}
});
