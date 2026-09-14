import { expect, it } from 'vitest';
import { countsAsConsumption, CANCELLED_ORDER_STATUS } from '@/server/persistence/demand-eligibility';
import { demandSql } from '@/server/persistence/postgres-production-demand';

const order = (over: Record<string, unknown> = {}) =>
  ({ notaFiscal: { id: 500 }, situacao: { id: 9, nome: 'Atendido', valor: 1 }, ...over }) as never;

it('counts an invoiced order that was not cancelled', () => {
  expect(countsAsConsumption(order())).toBe(true);
});

it('does not count an order without an invoice', () => {
  expect(countsAsConsumption(order({ notaFiscal: undefined }))).toBe(false);
  expect(countsAsConsumption(order({ notaFiscal: {} }))).toBe(false);
});

it('does not count a cancelled order even when the invoice was issued', () => {
  // Situação 12 = "Cancelado", verificada nos dados reais de produção.
  expect(countsAsConsumption(order({ situacao: { id: 12, nome: 'Cancelado', valor: 2 } }))).toBe(false);
});

it('counts an order whose status is missing rather than dropping it', () => {
  // Ausência de situação é dado incompleto, não cancelamento. Descartar subestimaria a demanda.
  expect(countsAsConsumption(order({ situacao: undefined }))).toBe(true);
});

it('generated SQL in postgres-production-demand.ts excludes every id in CANCELLED_ORDER_STATUS', () => {
  // Este teste lê `demandSql`, a query já montada e exportada por postgres-production-demand.ts —
  // a mesma string usada em client.query() em tempo de execução — em vez de comparar
  // buildCancelledStatusSqlFragment() com a própria constante que ele consome (o que seria
  // autorreferente: ambos vêm de demand-eligibility.ts e nunca tocam a SQL de fato executada).
  // Extrai a cláusula "not in (...)" aplicada a situacao,id na query real e confirma que ela
  // exclui exatamente os ids de CANCELLED_ORDER_STATUS — nem a mais, nem a menos. Se essa linha da
  // SQL fosse revertida para um valor hardcoded divergente da constante, este teste falharia.
  const situacaoClause = demandSql.match(/coalesce\(o\.payload#>'\{situacao,id\}','null'::jsonb\)\s*(not in \([^)]*\))/);
  expect(situacaoClause).not.toBeNull();
  const exclusionFragment = situacaoClause![1];

  const excludedIds = new Set(Array.from(exclusionFragment.matchAll(/'(\d+)'::jsonb/g), match => Number(match[1])));
  expect(excludedIds).toEqual(new Set(CANCELLED_ORDER_STATUS));
});
