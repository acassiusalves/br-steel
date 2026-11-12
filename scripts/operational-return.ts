/**
 * CLI do retorno PostgreSQL → Firestore: `plan`, `apply` e `verify`.
 *
 *   BRSTEEL_RETURN_TARGET_PROJECT=... BRSTEEL_CUTOVER_DATABASE_URL=... \
 *   BRSTEEL_CUTOVER_CA_FILE=... npm run cutover:return-tool -- plan
 *
 * `plan` e `verify` só leem. `apply` grava no Firestore do projeto de destino, e o próprio módulo
 * recusa a menos que esse Firestore tenha `appConfig/operationalSource = postgres` e
 * `appConfig/coreWriteMode = blocked`: a ferramenta nunca grava no Firestore que é a fonte viva.
 *
 * Não decide nada. Abrir e fechar a janela é de `operational-return-run.ts`; aqui, quem chama `apply`
 * já bloqueou o núcleo e decide sozinho quando trocar a fonte.
 *
 * Imprime apenas contagens, ids e tipos de mudança. Nunca payloads, credenciais ou dados de cliente.
 */
import { applyReturn, planReturn, returnErrorMessage, verifyReturn } from '../src/server/migration/operational-return';
import { describeChanges, describeCounts } from '../src/server/migration/operational-return-run';
import { RETURN_EMULATOR_REFUSAL, RETURN_ENV_HINT, describeReturnTarget, openReturnTarget } from './lib/return-target';

const COMMANDS = { plan: planReturn, apply: applyReturn, verify: verifyReturn };
type Command = keyof typeof COMMANDS;

async function main() {
  const command = process.argv[2];
  if (!command || !Object.keys(COMMANDS).includes(command)) {
    console.error(`Uso: operational-return.ts <${Object.keys(COMMANDS).join('|')}>`);
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
  try {
    await describeReturnTarget(target, line => console.log(line));
    const plan = await COMMANDS[command as Command](target.pool, target.db);
    console.log('');
    for (const line of describeCounts(plan.counts)) console.log(`  ${line}`);

    if (!plan.changes.length) {
      console.log(command === 'verify' ? '\nDivergência zero.' : '\nNenhuma mudança.');
      return;
    }
    if (command === 'verify') {
      console.error(`\n${plan.changes.length} divergência(s):`);
      for (const line of describeChanges(plan.changes)) console.error(`  ${line}`);
      process.exitCode = 1;
      return;
    }
    console.log(`\n${plan.changes.length} mudança(s)${command === 'apply' ? ' aplicada(s)' : ''}:`);
    for (const line of describeChanges(plan.changes)) console.log(`  ${line}`);
  } finally {
    await target.close();
  }
}

main().catch(error => {
  // Só as mensagens do próprio retorno passam: um erro do driver ou do SDK pode carregar consulta ou dado.
  console.error(returnErrorMessage(error));
  process.exit(1);
});
