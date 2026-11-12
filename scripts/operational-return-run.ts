/**
 * Retorno PostgreSQL → Firestore numa janela só: pré-voo, `draining`, `blocked`, apply, verify e, com
 * divergência zero, a fonte de volta ao Firestore.
 *
 *   BRSTEEL_RETURN_TARGET_PROJECT=... BRSTEEL_CUTOVER_DATABASE_URL=... \
 *   BRSTEEL_CUTOVER_CA_FILE=... npm run cutover:return -- --confirm
 *
 * **Grava `appConfig/coreWriteMode` e apaga `appConfig/operationalSource` no Firestore do projeto de
 * destino.** De `draining` até `REABERTO`, os dois modos se comportam igual: as operações do núcleo
 * respondem 503, e as entregas do webhook do Bling vão para a fila e recebem 200 sem ser aplicadas, com
 * o dreno suspenso. `draining` só dá tempo às chamadas que já tinham passado pela checagem das
 * operações, que cada instância guarda por até 5 s; o webhook lê o modo a cada entrega. Depois da
 * janela, o cron de dreno aplica as entregas enfileiradas na fonte que estiver ativa. Leituras seguem
 * normais: nada se perde, tudo chega atrasado.
 *
 * A sequência mora em `runReturn`. Este arquivo prepara o destino, confere a identidade no PostgreSQL
 * como o ensaio do corte e reabre o núcleo num Ctrl-C, só se esta execução abriu a janela e, depois da
 * troca da fonte, só passados 10 s. Não cobre `SIGKILL`: nesse caso, apague `appConfig/coreWriteMode` à mão.
 */
import { returnErrorMessage } from '../src/server/migration/operational-return';
import { runReturn, type ReturnRunControl } from '../src/server/migration/operational-return-run';
import { RETURN_EMULATOR_REFUSAL, RETURN_ENV_HINT, describeReturnTarget, openReturnTarget,
  returnIdentityRefusal } from './lib/return-target';

const log = (line: string) => console.log(`${new Date().toISOString()}  ${line}`);
const wait = (seconds: number) => new Promise<void>(resolve => setTimeout(resolve, seconds * 1000));

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.error('Este comando bloqueia as escritas do núcleo no ambiente de destino. Repita com --confirm.');
    process.exit(1);
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.error(RETURN_EMULATOR_REFUSAL);
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
    const refusal = await returnIdentityRefusal(target.pool);
    if (refusal) {
      log(`ABORTADO: ${refusal}`);
      log('Nada foi gravado.');
      process.exitCode = 1;
      return;
    }
    log('  ok  identidade: o próprio login, sem superusuário, membro de brsteel_ops_importer');
    await describeReturnTarget(target, line => log(`  ${line}`));

    const control: ReturnRunControl = { aborted: false, opened: false, sourceDeleted: false };
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      // `once`: a second Ctrl-C falls back to the default and ends the process at once.
      process.once(signal, () => {
        // Known limit: a batch the apply already sent may still land after the core reopens. The apply
        // is idempotent, and the source stays postgres unless the verify had already passed.
        log(`sinal ${signal}`);
        control.aborted = true;
        const reopen = async () => {
          // Only a window this run created is reopened; a record written by anyone else stays.
          if (!control.opened) return;
          // After the switch the core stays blocked until every instance has dropped the cached source.
          if (control.sourceDeleted) {
            log('a fonte já foi trocada: aguardando o cache do seletor (10 s) antes de reabrir');
            await wait(10);
          }
          await modeRef.delete();
          log('REABERTO: coreWriteMode removido — o núcleo aceita escritas de novo');
        };
        void reopen()
          .catch((error: unknown) => log(`FALHA AO REABRIR: ${returnErrorMessage(error)} Apague appConfig/coreWriteMode à mão.`))
          .then(() => process.exit(1));
      });
    }

    const outcome = await runReturn({ pool: target.pool, db: target.db, wait, log, control });
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
