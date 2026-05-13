/**
 * Imprime um access_token fresco da conta primária do ML.
 * Uso: npx tsx scripts/print-ml-token.ts
 * Refresca automaticamente via getMlToken() se o token atual expirou.
 */

import 'dotenv/config';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Redireciona console.log para stderr para que apenas o token final
// apareça em stdout (facilita captura via shell).
const _origLog = console.log;
console.log = (...args: unknown[]) => console.error(...args);

async function main() {
  const { getMlToken } = await import('../src/services/mercadolivre');
  const token = await getMlToken();
  _origLog.call(console, token);
}

main().catch((e) => {
  console.error('FALHOU:', e?.message || e);
  process.exit(1);
});
