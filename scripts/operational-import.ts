import { readFile, writeFile, stat } from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createLocalImportPool, importSnapshot, verifySnapshot } from '../src/server/migration/operational-import';
import { exportOperationalSnapshot } from '../src/server/migration/operational-export';

async function main() {
  const [command,path,...extra]=process.argv.slice(2);
  if (!['export-local','import-local','verify-local'].includes(command) || !path || extra.length) {
    throw new Error('Usage: operational-import.ts export-local|import-local|verify-local /absolute/snapshot.json');
  }
  if (!path.startsWith('/')) throw new Error('Absolute snapshot path required');
  if (command==='export-local') {
    if (process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8188') throw new Error('Local Firestore emulator required');
    const app=initializeApp({ projectId:'demo-brsteel-auth' },'operational-export');
    try {
      const snapshot=await exportOperationalSnapshot(getFirestore(app),'demo-brsteel-auth');
      await writeFile(path,JSON.stringify(snapshot),{ encoding:'utf8',mode:0o600,flag:'wx' });
      console.log(JSON.stringify({ exported:snapshot.records.length,sourceProject:snapshot.sourceProject }));
    } finally { await deleteApp(app); }
    return;
  }
  if ((await stat(path)).size>128*1024*1024) throw new Error('Snapshot exceeds the local 128 MiB limit');
  const raw: unknown=JSON.parse(await readFile(path,'utf8'));
  const pool=createLocalImportPool(process.env.BRSTEEL_PG_LOCAL_URL ?? '');
  try { console.log(JSON.stringify(command==='import-local' ? await importSnapshot(pool,raw) : await verifySnapshot(pool,raw))); }
  finally { await pool.end(); }
}
main().catch(() => {
  // Validation may include document IDs or database DETAIL containing payloads; never log raw exceptions.
  console.error('Local operation failed. Check the snapshot, emulator and local database configuration; no production operation was requested.');
  process.exitCode=1;
});
