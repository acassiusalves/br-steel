import { writeFile } from 'node:fs/promises';

export function safePilotErrorCode(error:unknown) {
  const code=(error as {code?:unknown})?.code;
  return typeof code==='string' && /^[A-Z0-9_]{2,40}$/.test(code) ? code : undefined;
}

/** Completed imports are monotonic: an old snapshot cannot be reactivated by the importer. */
export async function withStableCopy<T>(expectedHash:string,
  readState:()=>Promise<{ready:boolean;active_run:string}|undefined>,run:()=>Promise<T>):Promise<T> {
  const check=async()=>{
    const state=await readState();
    if(!state?.ready || state.active_run!==expectedHash) throw new Error('Measured snapshot changed or is not ready');
  };
  await check();
  const result=await run();
  await check();
  return result;
}

/** Reserve first, and only update a file created by this invocation. Never persist raw errors. */
export async function recordPilotReport<T>(path:string,command:string,run:()=>Promise<T>):Promise<T> {
  const startedAt=new Date().toISOString();
  await writeFile(path,JSON.stringify({status:'started',command,startedAt}),{mode:0o600,flag:'wx'});
  try {
    const result=await run();
    await writeFile(path,JSON.stringify(result,null,2),{mode:0o600});
    return result;
  } catch(error) {
    await writeFile(path,JSON.stringify({status:'failed',command,startedAt,finishedAt:new Date().toISOString(),code:safePilotErrorCode(error)},null,2),{mode:0o600});
    throw error;
  }
}
