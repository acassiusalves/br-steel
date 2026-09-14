import 'server-only';
import { z } from 'zod';
import type { AccessContext } from '@/server/access/types';
import { HISTORY_WEEKS } from '@/lib/iso-week';
import { readWeeklyHistory } from '@/server/persistence/firestore-sku-weekly-demand';
import { documentIdSchema, requireOperation, result } from './common';

const input = z.object({
  sku: documentIdSchema,
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
