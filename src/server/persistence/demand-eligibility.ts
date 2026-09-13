import 'server-only';
import type { SaleOrder } from '@/types/sale-order';

/**
 * Situações do Bling que representam pedido cancelado.
 *
 * O id 12 ("Cancelado") foi verificado nos dados reais de produção. Para estender a lista, consulte o
 * mapa de situações que o webhook carrega em src/app/api/webhook/bling/route.ts:163 e acrescente o id
 * junto de um caso de teste — nunca por suposição sobre o significado do número.
 */
export const CANCELLED_ORDER_STATUS: ReadonlySet<number> = new Set([12]);

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
