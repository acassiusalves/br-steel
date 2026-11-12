/**
 * Retorno PostgreSQL → Firestore numa janela só: pré-voo, `draining`, `blocked`, apply, verify e, com
 * divergência zero, a fonte de volta ao Firestore.
 *
 *   BRSTEEL_RETURN_TARGET_PROJECT=... BRSTEEL_CUTOVER_DATABASE_URL=... \
 *   BRSTEEL_CUTOVER_CA_FILE=... npm run cutover:return -- --confirm
 *
 * **Grava `appConfig/coreWriteMode` e apaga `appConfig/operationalSource` no Firestore do projeto de
 * destino.** Entre `draining` e `REABERTO`, toda escrita do núcleo responde 503 e o dreno de webhooks
 * fica suspenso. Leituras seguem normais e as entregas continuam enfileiradas: nada se perde, tudo
 * chega atrasado.
 *
 * A sequência mora em `runReturn`. Este arquivo prepara o destino, confere a identidade no PostgreSQL
 * como o ensaio do corte e garante a reabertura num Ctrl-C. Não cobre `SIGKILL`: nesse caso, apague
 * `appConfig/coreWriteMode` à mão.
 */
import { returnErrorMessage } from '../src/server/migration/operational-return';
import { runReturn } from '../src/server/migration/operational-return-run';
import { RETURN_ENV_HINT, describeReturnTarget, openReturnTarget } from './lib/return-target';

const log = (line: string) => console.log(`${new Date().toISOString()}  ${line}`);
const wait = (seconds: number) => new Promise<void>(resolve => setTimeout(resolve, seconds * 1000));

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.error('Este comando bloqueia as escritas do núcleo no ambiente de destino. Repita com --confirm.');
    process.exit(1);
  }
  const connectionString = process.env.BRSTEEL_CUTOVER_DATABASE_URL;
  const project = process.env.BRSTEEL_RETURN_TARGET_PROJECT;
  if (!connectionString || !project) {
    console.error(RETURN_ENV_HINT);
    process.exit(1);
  }

  const target = openReturnTarget(connectionString, project);
  const modeRef = target.db.collection('appConfig').doc('coreWriteMode');
  try {
    log('=== DESTINO ===');
    await describeReturnTarget(target, line => log(`  ${line}`));
    const id = (await target.pool.query(`select current_user actor, session_user login,
      (select rolsuper from pg_roles where rolname = current_user) superuser`)).rows[0];
    if (id.actor !== id.login || id.superuser) {
      log(`ABORTADO: identidade inesperada no PostgreSQL (${id.actor}/${id.login}, superuser=${id.superuser})`);
      log('Nada foi gravado.');
      process.exitCode = 1;
      return;
    }
    log(`  ok  identidade ${id.actor}, superuser=false`);

    // A record that already exists makes runReturn abort; a Ctrl-C must not delete it either.
    const preexisting = (await modeRef.get()).exists;
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        log(`sinal ${signal}`);
        const reopen = preexisting ? Promise.resolve() : modeRef.delete().then(
          () => log('REABERTO: coreWriteMode removido — o núcleo aceita escritas de novo'),
          (error: unknown) => log(`FALHA AO REABRIR: ${returnErrorMessage(error)} Apague appConfig/coreWriteMode à mão.`));
        void reopen.then(() => process.exit(1));
      });
    }

    const outcome = await runReturn({ pool: target.pool, db: target.db, wait, log });
    log(`=== FIM: ${outcome.status} ===`);
    if (outcome.status !== 'returned') process.exitCode = 1;
  } finally {
    await target.close();
  }
}

main().catch(error => {
  // Só as mensagens do próprio retorno passam: um erro do driver ou do SDK pode carregar consulta ou dado.
  console.error(returnErrorMessage(error));
  process.exit(1);
});
