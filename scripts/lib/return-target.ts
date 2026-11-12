import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { Pool } from 'pg';
import { ReturnError, withImporterSnapshot } from '../../src/server/migration/operational-return';
import { createCutoverPool } from './cutover-pool';

/**
 * O preparo comum aos dois CLIs do retorno PostgreSQL → Firestore.
 *
 * O app do Firebase é **nomeado** e recebe o projeto explícito. O destino nunca vem do projeto padrão
 * das credenciais: o retorno grava no Firestore, e gravar no projeto errado seria escrever na fonte viva
 * de outro ambiente. Os módulos de `src/server/migration` recebem `db` e `pool` daqui e não importam
 * nada que inicialize o app padrão.
 */
export type ReturnTarget = { project: string; db: Firestore; pool: Pool; close: () => Promise<void> };

export const RETURN_ENV_HINT = 'Defina BRSTEEL_CUTOVER_DATABASE_URL e BRSTEEL_RETURN_TARGET_PROJECT.'
  + ' Para o destino hospedado, defina também BRSTEEL_CUTOVER_CA_FILE.';

/** Com o emulador configurado, o SDK leria e gravaria nele em vez do projeto de destino. */
export const RETURN_EMULATOR_REFUSAL = 'FIRESTORE_EMULATOR_HOST está definido: o retorno leria e gravaria no emulador,'
  + ' não no projeto de destino. Remova a variável e repita.';

export function openReturnTarget(connectionString: string, project: string): ReturnTarget {
  let pool: Pool;
  try {
    pool = createCutoverPool(connectionString);
  } catch {
    // A URL inválida ou o certificado ilegível não podem ecoar a URL, que carrega a senha.
    throw new ReturnError('Não foi possível preparar a conexão com o PostgreSQL. Confira BRSTEEL_CUTOVER_DATABASE_URL'
      + ' (login do importador, sem query string) e, para o destino hospedado, BRSTEEL_CUTOVER_CA_FILE.');
  }
  // Uma conexão ociosa que cai (um reinício do pooler) emite no pool. Sem ouvinte, o Node encerraria o
  // processo na hora e pularia o `finally` que reabre o núcleo. A consulta em andamento ainda falha normalmente.
  pool.on('error', () => undefined);
  const app = initializeApp({ projectId: project, credential: applicationDefault() }, 'operational-return');
  return {
    project, db: getFirestore(app), pool,
    close: async () => {
      await pool.end().catch(() => undefined);
      await deleteApp(app).catch(() => undefined);
    },
  };
}

/**
 * A recusa do retorno inteiro, ou `null`. A sessão precisa ser o próprio login, sem superusuário, e
 * membro de `brsteel_ops_importer`: as leituras assumem esse papel numa transação.
 */
export async function returnIdentityRefusal(pool: Pool): Promise<string | null> {
  const id = (await pool.query(`select current_user actor, session_user login,
    (select rolsuper from pg_roles where rolname = current_user) superuser,
    pg_has_role(current_user, 'brsteel_ops_importer', 'member') importer`)).rows[0];
  if (id.actor !== id.login || id.superuser) {
    return `identidade inesperada no PostgreSQL (${id.actor}/${id.login}, superuser=${id.superuser}).`;
  }
  if (!id.importer) return `o login ${id.login} não é membro de brsteel_ops_importer. Use o login do importador.`;
  return null;
}

/** O projeto de destino e a origem da cópia. Quando diferem, o retorno é um ensaio sobre outro Firebase. */
export async function describeReturnTarget(target: ReturnTarget, print: (line: string) => void) {
  const copy = await withImporterSnapshot(target.pool, async client =>
    (await client.query('select source_project from brsteel_import.state')).rows[0]);
  print(`projeto de destino: ${target.project}`);
  print(`origem da cópia: ${copy?.source_project ?? 'nenhuma cópia'}`);
  if (copy?.source_project !== target.project) print('destino diferente da origem da cópia: ensaio');
}
