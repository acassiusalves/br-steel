import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { createLocalImportPool } from '../../src/server/migration/operational-import';
import { createHostedPilotPool } from '../../src/server/migration/operational-hosted';

/**
 * O pool do corte precisa ser um alvo de importação **reconhecido**, não um `pg.Pool` qualquer.
 *
 * `checkImportTarget` consulta um registro de pools criados pelas fábricas; um pool cru cai no ramo
 * local e exige o banco `brsteel_ops_local`. Contra o destino hospedado isso falhava com
 * `Local import target required` — e falhava **depois** de o núcleo já estar bloqueado, porque
 * `compare` não passa por esse caminho e não denunciava o problema antes.
 *
 * O destino hospedado exige o login `brsteel_pilot_importer` e o certificado raiz: a fábrica recusa
 * query string justamente para que o TLS venha daqui, nunca da URL.
 *
 * Vive em `scripts/lib` porque o CLI do corte e o ensaio precisam da **mesma** seleção. Importar de
 * `operational-cutover.ts` executaria o `main()` daquele arquivo.
 */
export function createCutoverPool(connectionString: string): Pool {
  const { hostname } = new URL(connectionString);
  if (['127.0.0.1', '[::1]', 'localhost'].includes(hostname)) return createLocalImportPool(connectionString);
  const caFile = process.env.BRSTEEL_CUTOVER_CA_FILE;
  if (!caFile) throw new Error('Destino hospedado exige BRSTEEL_CUTOVER_CA_FILE com o certificado raiz.');
  return createHostedPilotPool(connectionString, 'importer', readFileSync(caFile, 'utf8'));
}
