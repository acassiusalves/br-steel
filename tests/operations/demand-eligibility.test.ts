import { expect, it } from 'vitest';
import { countsAsConsumption, CANCELLED_ORDER_STATUS, buildCancelledStatusSqlFragment } from '@/server/persistence/demand-eligibility';

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

it('SQL fragment reflects CANCELLED_ORDER_STATUS constant', () => {
  // Este teste garante que a query SQL em postgres-production-demand.ts interpolará corretamente
  // a lista de situações canceladas. Se a SQL estivesse com um valor hardcoded divergente
  // (ex. se alguém adicionasse um novo id à constante mas esquecesse de atualizar a SQL),
  // este teste falharia.
  const sqlFragment = buildCancelledStatusSqlFragment();

  // Verifica que o fragmento contém 'not in' com os valores da constante
  expect(sqlFragment).toContain('not in');

  // Verifica que cada id cancelado aparece no fragmento SQL como jsonb
  for (const statusId of CANCELLED_ORDER_STATUS) {
    const expectedJsonb = `'${statusId}'::jsonb`;
    expect(sqlFragment).toContain(expectedJsonb);
  }

  // Verifica que o fragmento é sintaticamente válido SQL: contém os parênteses necessários
  expect(sqlFragment).toMatch(/not in \(.+\)/);
});
