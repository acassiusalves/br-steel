/**
 * CLI do corte de fonte: `reconcile`, `compare` e `report`.
 *
 * Não decide nada. Reconciliar exige que o núcleo esteja `blocked`, e o próprio módulo recusa caso
 * contrário — uma varredura paginada com escritores ativos descreveria um instante que nunca existiu.
 *
 *   BRSTEEL_CUTOVER_DATABASE_URL=... npx tsx scripts/operational-cutover.ts compare
 *
 * Imprime apenas contagens, divergências e o modo vigente. Nunca payloads, credenciais ou dados de
 * cliente: o relatório circula, o conteúdo não.
 */
import { Pool } from 'pg';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { compareSources, reconcileFromFirestore } from '../src/server/migration/operational-reconcile';
import { readCoreWriteMode } from '../src/server/operations/maintenance';

const COMMANDS = ['reconcile', 'compare', 'report'] as const;
type Command = (typeof COMMANDS)[number];

async function main() {
  const command = process.argv[2] as Command | undefined;
  if (!command || !COMMANDS.includes(command)) {
    console.error(`Uso: operational-cutover.ts <${COMMANDS.join('|')}>`);
    process.exit(1);
  }
  const connectionString = process.env.BRSTEEL_CUTOVER_DATABASE_URL;
  const sourceProject = process.env.BRSTEEL_CUTOVER_SOURCE_PROJECT;
  if (!connectionString || !sourceProject) {
    console.error('Defina BRSTEEL_CUTOVER_DATABASE_URL e BRSTEEL_CUTOVER_SOURCE_PROJECT.');
    process.exit(1);
  }

  if (!getApps().length) initializeApp({ projectId: sourceProject });
  const db = getFirestore();
  const pool = new Pool({ connectionString, max: 2 });
  try {
    const mode = await readCoreWriteMode();
    console.log(`modo do núcleo: ${mode}`);
    if (command === 'report') return;

    if (command === 'reconcile') {
      const result = await reconcileFromFirestore(pool, db, sourceProject);
      // A repetição de um snapshot já aplicado não devolve contagem de itens: é no-op, não uma carga.
      if (!('items' in result)) {
        console.log(`reconciliação: snapshot ${result.hash.slice(0, 12)} já aplicado; nada a fazer`);
        return;
      }
      console.log(`reconciliação: ${result.records} registros, ${result.items} itens, hash ${result.hash.slice(0, 12)}`);
      return;
    }

    const { divergences, counts } = await compareSources(pool, db, sourceProject);
    for (const [collection, row] of Object.entries(counts)) {
      console.log(`  ${collection.padEnd(22)} origem ${row.source} | cópia ${row.copy} | nativas ${row.native}`);
    }
    if (!divergences.length) {
      console.log('\nDivergência zero.');
      return;
    }
    console.error(`\n${divergences.length} divergência(s):`);
    for (const item of divergences.slice(0, 50)) console.error(`  ${item.collection}/${item.id}: ${item.kind}`);
    if (divergences.length > 50) console.error(`  ... e mais ${divergences.length - 50}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  // Nunca imprimir o erro cru: pode carregar consulta, payload ou credencial.
  console.error(error instanceof Error ? error.message : 'Falha no corte.');
  process.exit(1);
});
