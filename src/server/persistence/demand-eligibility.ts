import 'server-only';
import type { SaleOrder } from '@/types/sale-order';

/**
 * Situações do Bling que representam pedido cancelado.
 *
 * O id 12 ("Cancelado") foi verificado nos dados reais de produção. Para estender a lista, consulte o
 * mapa de situações que o webhook carrega em src/app/api/webhook/bling/route.ts:163 e acrescente o id
 * junto de um caso de teste — nunca por suposição sobre o significado do número.
 *
 * Esta constante é usada tanto aqui quanto na query SQL de demanda de produção em
 * postgres-production-demand.ts — a query interpola o valor desta constante, portanto não há
 * necessidade de manter o SQL sincronizado manualmente.
 */
export const CANCELLED_ORDER_STATUS: ReadonlySet<number> = new Set([12]);

/**
 * Constrói o fragmento SQL de exclusão de situações canceladas.
 * Interpola a constante CANCELLED_ORDER_STATUS para garantir que a query sempre reflete
 * o predicado de cancelamento definido neste módulo.
 *
 * @throws Error se CANCELLED_ORDER_STATUS estiver vazio (SQL não aceita 'not in ()')
 */
export function buildCancelledStatusSqlFragment(): string {
  if (CANCELLED_ORDER_STATUS.size === 0) {
    throw new Error('CANCELLED_ORDER_STATUS não pode estar vazio para construir o fragmento SQL');
  }
  const statusList = Array.from(CANCELLED_ORDER_STATUS)
    .map(id => `'${id}'::jsonb`)
    .join(',');
  return `not in (${statusList})`;
}

/**
 * Um pedido conta como consumo de estoque?
 *
 * O mesmo predicado governa a agregação ao vivo e o rollup semanal. Se os dois divergirem, o sparkline
 * e a coluna "Qtd. Total Vendida" mostram números diferentes para o mesmo SKU no mesmo instante.
 *
 * Nota fiscal emitida é o sinal de baixa do estoque, que é a premissa do modelo de reposição. Um
 * cancelamento não é: um pedido cancelado que chegou a ter NF inflaria a média que comanda a produção.
 * Situação ausente é dado incompleto e conta — descartar subestimaria a demanda.
 */
export function countsAsConsumption(order: Pick<SaleOrder, 'notaFiscal' | 'situacao'>): boolean {
  if (!order.notaFiscal?.id) return false;
  const status = order.situacao?.id;
  return !(typeof status === 'number' && CANCELLED_ORDER_STATUS.has(status));
}
