import type { Firestore } from 'firebase-admin/firestore';
import type { Pool } from 'pg';
import { parseCoreWriteMode } from '../operations/switch-values';
import { applyReturn, planReturn, readSwitches, returnErrorMessage, verifyReturn, withImporterSnapshot,
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

/** The gRPC status Firestore returns when `create` finds the document already there. */
const ALREADY_EXISTS = 6;

/**
 * Shared with whoever handles signals around the run. The handler sets `aborted`; the run reports
 * whether it created the window (`opened`) and whether the source has already gone back
 * (`sourceDeleted`), which tells the handler what it may reopen and how long to wait first.
 */
export type ReturnRunControl = { aborted: boolean; opened: boolean; sourceDeleted: boolean };

/**
 * The whole return in one window. The pre-flight writes nothing, and every PostgreSQL read assumes the
 * importer role inside a transaction (`withImporterSnapshot`). The window opens by *creating* the
 * maintenance record, so a window someone else opened after the pre-flight aborts the return and is
 * left alone; from then on, the core is reopened in a `finally`. The source goes back to Firestore only
 * after a verification with zero divergences, and only in a transaction that finds the core still
 * blocked and the run not interrupted. A divergence, a failure or an interruption leaves the environment
 * serving from PostgreSQL, where nothing is lost, and the return is resolved by running it again.
 */
export async function runReturn({ pool, db, wait, log, control = { aborted: false, opened: false, sourceDeleted: false } }: {
  pool: Pool; db: Firestore; wait: (seconds: number) => Promise<void>; log: (line: string) => void;
  control?: ReturnRunControl;
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
    const copy = await withImporterSnapshot(pool, async client => (await client.query('select ready from brsteel_import.state')).rows[0]);
    if (copy?.ready !== true) return abort('a cópia não está pronta (ready=false).');
    log('  ok  cópia pronta');
    plan = await planReturn(pool, db);
  } catch (error) {
    return abort(`o pré-voo falhou. ${returnErrorMessage(error)}`);
  }
  log(`  plano: ${plan.changes.length} mudança(s)`);
  for (const line of [...describeCounts(plan.counts), ...describeChanges(plan.changes)]) log(`    ${line}`);
  log('PRÉ-VOO APROVADO — a partir daqui as escritas do núcleo são afetadas');

  const record = (mode: 'draining' | 'blocked') => ({ mode, updatedAt: new Date().toISOString() });
  let opened = true;
  try {
    try {
      await modeRef.create(record('draining'));
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code !== ALREADY_EXISTS) throw error;
      opened = false;
      return abort('appConfig/coreWriteMode foi criado por outra execução depois do pré-voo.');
    }
    control.opened = true;
    log('1/5 draining — aguardando as chamadas em trânsito (20 s)');
    await wait(20);
    await modeRef.set(record('blocked'));
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
    // A core reopened by hand during the apply would have let writes reach PostgreSQL after the mirror,
    // so the switch reads the record in the same transaction that deletes the source.
    const refused = await db.runTransaction(async transaction => {
      if (control.aborted) return 'retorno interrompido antes da troca da fonte';
      const mode = parseCoreWriteMode((await transaction.get(modeRef)).data()?.mode);
      if (mode !== 'blocked') return `o núcleo não está mais bloqueado na hora da troca (modo ${mode})`;
      transaction.delete(sourceRef);
      return null;
    });
    if (refused) {
      const reason = `${refused}; a fonte continua postgres.`;
      log(`5/5 ERRO: ${reason}`);
      return { status: 'failed', reason };
    }
    control.sourceDeleted = true;
    log('5/5 DIVERGÊNCIA ZERO — operationalSource removido; o núcleo segue bloqueado enquanto o cache do seletor expira (10 s)');
    await wait(10);
    return { status: 'returned', plan: applied };
  } catch (error) {
    const reason = returnErrorMessage(error);
    log(`ERRO: ${reason}`);
    return { status: 'failed', reason };
  } finally {
    // Unless another window owns the record, the pre-flight saw none: deleting it restores the state
    // found, even when the outcome of the create itself is unknown.
    if (opened) {
      try {
        await modeRef.delete();
        log('REABERTO: coreWriteMode removido — o núcleo aceita escritas de novo');
      } catch (error) {
        log(`FALHA AO REABRIR: ${returnErrorMessage(error)} Apague appConfig/coreWriteMode à mão.`);
      }
    }
  }
}
