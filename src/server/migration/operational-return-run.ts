import type { Firestore } from 'firebase-admin/firestore';
import type { Pool } from 'pg';
import { applyReturn, planReturn, readSwitches, returnErrorMessage, verifyReturn,
  type ReturnChange, type ReturnCounts, type ReturnPlan } from './operational-return';

export type ReturnRunOutcome = {
  status: 'aborted' | 'returned' | 'divergent' | 'failed';
  reason?: string;
  plan?: ReturnPlan;
  divergences?: ReturnChange[];
};

const LISTED_CHANGES = 50;

/** One line per collection, with both sides and what the return changes there. */
export function describeCounts(counts: ReturnCounts): string[] {
  return Object.entries(counts).map(([collection, row]) => `${collection.padEnd(20)} postgres ${row.postgres}`
    + ` | firestore ${row.firestore} | criar ${row.create} | atualizar ${row.update} | apagar ${row.delete}`);
}

/** At most fifty changes, by collection, id and kind: never a payload. */
export function describeChanges(changes: ReturnChange[]): string[] {
  const lines = changes.slice(0, LISTED_CHANGES).map(change => `${change.collection}/${change.id}: ${change.kind}`);
  if (changes.length > LISTED_CHANGES) lines.push(`... e mais ${changes.length - LISTED_CHANGES}`);
  return lines;
}

/**
 * The whole return in one window. The pre-flight writes nothing; from `draining` on, the core is
 * reopened in a `finally`. The source goes back to Firestore only after a verification with zero
 * divergences, so a divergence or a failure leaves the environment serving from PostgreSQL, where
 * nothing is lost, and the return is resolved by running it again.
 */
export async function runReturn({ pool, db, wait, log }: {
  pool: Pool; db: Firestore; wait: (seconds: number) => Promise<void>; log: (line: string) => void;
}): Promise<ReturnRunOutcome> {
  const config = db.collection('appConfig');
  const sourceRef = config.doc('operationalSource'), modeRef = config.doc('coreWriteMode');
  const abort = (reason: string): ReturnRunOutcome => {
    log(`ABORTADO: ${reason}`);
    log('Nada foi gravado.');
    return { status: 'aborted', reason };
  };

  log('=== PRÉ-VOO (nenhuma gravação) ===');
  let plan: ReturnPlan;
  try {
    const { source } = await readSwitches(db);
    if (source !== 'postgres') return abort(`a fonte ativa é ${source}; o retorno parte de um ambiente servido pelo PostgreSQL.`);
    log('  ok  fonte ativa postgres');
    // `readSwitches` reads an absent record as `open`; only its absence proves no other window is open.
    if ((await modeRef.get()).exists) {
      return abort('appConfig/coreWriteMode já existe; uma execução anterior pode ter deixado o núcleo travado.');
    }
    log('  ok  coreWriteMode ausente');
    const copy = (await pool.query('select ready from brsteel_import.state')).rows[0];
    if (copy?.ready !== true) return abort('a cópia não está pronta (ready=false).');
    log('  ok  cópia pronta');
    plan = await planReturn(pool, db);
  } catch (error) {
    return abort(`o pré-voo falhou. ${returnErrorMessage(error)}`);
  }
  log(`  plano: ${plan.changes.length} mudança(s)`);
  for (const line of [...describeCounts(plan.counts), ...describeChanges(plan.changes)]) log(`    ${line}`);
  log('PRÉ-VOO APROVADO — a partir daqui as escritas do núcleo são afetadas');

  const setMode = (mode: 'draining' | 'blocked') => modeRef.set({ mode, updatedAt: new Date().toISOString() });
  try {
    await setMode('draining');
    log('1/5 draining — aguardando as chamadas em trânsito (20 s)');
    await wait(20);
    await setMode('blocked');
    log('2/5 blocked — escritas do núcleo recusadas a partir de agora (10 s)');
    await wait(10);

    log('3/5 apply — espelhando o PostgreSQL no Firestore...');
    const applied = await applyReturn(pool, db);
    log(`    ${applied.changes.length} mudança(s) aplicada(s)`);
    for (const line of describeCounts(applied.counts)) log(`    ${line}`);

    log('4/5 verify — exigindo divergência zero...');
    const verified = await verifyReturn(pool, db);
    for (const line of describeCounts(verified.counts)) log(`    ${line}`);
    if (verified.changes.length) {
      log(`5/5 ${verified.changes.length} DIVERGÊNCIA(S) — a fonte continua postgres:`);
      for (const line of describeChanges(verified.changes)) log(`      ${line}`);
      return { status: 'divergent', plan: applied, divergences: verified.changes };
    }
    await sourceRef.delete();
    log('5/5 DIVERGÊNCIA ZERO — operationalSource removido; o núcleo segue bloqueado enquanto o cache do seletor expira (10 s)');
    await wait(10);
    return { status: 'returned', plan: applied };
  } catch (error) {
    const reason = returnErrorMessage(error);
    log(`ERRO: ${reason}`);
    return { status: 'failed', reason };
  } finally {
    // The pre-flight saw no record, so deleting it restores the state found, whatever got written.
    try {
      await modeRef.delete();
      log('REABERTO: coreWriteMode removido — o núcleo aceita escritas de novo');
    } catch (error) {
      log(`FALHA AO REABRIR: ${returnErrorMessage(error)} Apague appConfig/coreWriteMode à mão.`);
    }
  }
}
