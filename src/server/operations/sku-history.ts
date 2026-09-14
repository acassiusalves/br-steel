import 'server-only';
import { z } from 'zod';
import type { AccessContext } from '@/server/access/types';
import { HISTORY_WEEKS } from '@/lib/iso-week';
import { readWeeklyHistory } from '@/server/persistence/firestore-sku-weekly-demand';
import { requireOperation, result } from './common';

/**
 * `sku` não usa `documentIdSchema`: esta operação só faz `Map.get` no resultado de
 * `readWeeklyHistory`, nunca constrói um caminho de documento Firestore com o valor, então a razão de
 * `documentIdSchema` recusar `/` não se aplica aqui. `readWeeklyHistory` já chaveia pelo SKU
 * verdadeiro, não pelo id de documento saneado (`firestore-sku-weekly-demand.ts`), e um SKU com `/`
 * (`CHAPA/10`) é dado real — tests/mcp/audit.test.ts tem um caso de regressão dedicado a ele. Mesma
 * convenção de `consultar_estoque_produtos`.
 */
const input = z.object({
  sku: z.string().min(1).max(200),
  semanas: z.coerce.number().int().min(1).max(HISTORY_WEEKS).default(26),
}).strict();

/**
 * Série semanal de demanda de um SKU.
 *
 * Só semanas fechadas: a semana corrente é parcial e viaja junto das linhas de demanda, onde há o
 * contexto do período consultado para decidir se ela existe.
 */
export async function skuHistory(context: AccessContext, raw: unknown) {
  requireOperation(context, 'producao:read', '/producao');
  const { sku, semanas } = input.parse(raw);
  const points = (await readWeeklyHistory(semanas)).get(sku) ?? [];
  return result(points, 'firestore', points.length ? [] : [
    'Não há histórico consolidado para este SKU. O rollup cobre apenas semanas fechadas; um SKU novo ou sem venda faturada fica vazio, o que não indica falha.',
  ]);
}
