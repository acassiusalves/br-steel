/**
 * Reconstrói o rollup semanal de demanda a partir dos pedidos já salvos.
 *
 * Roda uma vez, localmente, com as credenciais de administrador do ambiente. Não é cron por decisão:
 * o histórico completo passa de 12 mil pedidos, e um passe único encostaria no teto de 300s da função.
 *
 * firestore-sku-weekly-demand.ts começa com `import 'server-only'`, que é um no-op só dentro do build
 * do Next (condition `react-server`); fora dele o pacote lança na importação. Por isso a invocação usa
 * `node --conditions=react-server --import tsx`, não `npx tsx` puro — mesmo padrão do script `cutover`
 * em package.json, que importa a mesma árvore de módulos server-only. O alias evita que quem roda
 * isto à mão no dia do deploy precise lembrar das flags:
 *
 *   npm run backfill:sku-weekly-demand              # janela padrão (104 semanas)
 *   npm run backfill:sku-weekly-demand -- 2025-W01  # a partir de uma semana específica
 *
 * Retomável: o checkpoint avança semana a semana, então uma interrupção continua de onde parou.
 */
import { adminDb } from '../src/lib/firebase-admin';
import { closedWeeksSince, previousWeek } from '../src/lib/iso-week';
import { ROLLUP_CHECKPOINT, rollUpWeek } from '../src/server/persistence/firestore-sku-weekly-demand';

async function main() {
  const requested = process.argv[2];
  const checkpoint = adminDb.collection('appConfig').doc(ROLLUP_CHECKPOINT);
  const stored = (await checkpoint.get()).data()?.lastClosedWeek;
  // `closedWeeksSince` é exclusivo no início, então uma semana pedida entra pela sua antecessora.
  const after = requested ? previousWeek(requested) : (typeof stored === 'string' ? stored : null);
  const weeks = closedWeeksSince(after);

  if (!weeks.length) {
    console.log('Nada pendente: o rollup já está na semana corrente.');
    return;
  }
  console.log(`Consolidando ${weeks.length} semanas, de ${weeks[0]} a ${weeks.at(-1)}.`);

  let total = 0;
  for (const [index, week] of weeks.entries()) {
    const { skus } = await rollUpWeek(week);
    total += skus;
    await checkpoint.set({ lastClosedWeek: week, updatedAt: new Date().toISOString() }, { merge: true });
    console.log(`  [${index + 1}/${weeks.length}] ${week}: ${skus} SKUs`);
  }
  console.log(`Concluído. ${total} buckets escritos em ${weeks.length} semanas.`);
}

main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
