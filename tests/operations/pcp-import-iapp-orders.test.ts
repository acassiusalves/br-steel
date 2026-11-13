import { describe, expect, it } from 'vitest';
import { buildOrdersSql, iappDate, normalizeOrders, type IappOrdersExport } from '../../scripts/pcp-import-iapp-orders';

const base = (): IappOrdersExport => ({
  capturedAt: '2026-11-13T15:00:00Z', openIds: [10, 11],
  orders: [
    { iappId: 10, number: '0009664', phase: 'Check Q/Q Corte', status: 'PRODUZINDO', sku: 'TMPCLH430360', description: 'TAMPA', quantity: 5,
      priority: null, plannedStart: '12/11/2026 13:58', plannedEnd: '12/11/2026 14:28',
      steps: [{ operation: 'Check Q/Q Corte', status: 'EM EXECUÇÃO' }, { operation: 'Dobrar', status: 'ABERTO' }, { operation: 'Dobrar', status: 'ABERTO' }] },
    { iappId: 11, number: '0009665', phase: 'Corte', status: 'A PRODUZIR', sku: 'PARTE1', description: null, quantity: 2,
      priority: 'Pedido urgente', plannedStart: null, plannedEnd: null, steps: [{ operation: 'Cortar', status: 'ABERTO' }] },
  ],
});

describe('carga das OPs do iApp', () => {
  it('converte situação, tipo, prioridade, datas e tira OS repetida', () => {
    const { orders } = normalizeOrders(base());
    expect(orders[0]).toMatchObject({ status: 'produzindo', kind: 'semanal', priority: 'estoque', phase: 'Check Q/Q Corte',
      plannedStart: '2026-11-12T13:58:00-03:00', steps: [{ operation: 'Check Q/Q Corte', status: 'em_execucao' }, { operation: 'Dobrar', status: 'aberto' }] });
    // "A Produzir" não tem fase; a OP só de corte é do tipo corte.
    expect(orders[1]).toMatchObject({ status: 'a_produzir', phase: null, kind: 'corte', priority: 'urgente' });
    expect(iappDate('01/02/2026 07:45')).toBe('2026-02-01T07:45:00-03:00');
  });
  it('recusa exportação inconsistente', () => {
    const repetida = base(); repetida.orders[1].iappId = 10;
    expect(() => normalizeOrders(repetida)).toThrow(/repetida/);
    const fora = base(); fora.openIds = [10];
    expect(() => normalizeOrders(fora)).toThrow(/fora da lista/);
    const semQtde = base(); semQtde.orders[0].quantity = 0;
    expect(() => normalizeOrders(semQtde)).toThrow(/quantidade/);
    const status = base(); (status.orders[0] as { status: string }).status = 'X';
    expect(() => normalizeOrders(status)).toThrow(/situação/);
  });
  it('gera SQL transacional que não toca OP já mexida no BR Steel e registra auditoria', () => {
    const sql = buildOrdersSql(base());
    expect(sql.startsWith('begin;')).toBe(true);
    expect(sql.trim().endsWith('commit;')).toBe(true);
    expect(sql).toContain('if v_touched then continue; end if;');
    expect(sql).toContain("'pcp.importIappOrders'");
    for (const ataque of ['x$iapp$; drop table y; --', 'x$do$; drop table y; --', '$$']) {
      const hostil = base(); hostil.orders[0].description = ataque;
      expect(() => buildOrdersSql(hostil)).toThrow(/delimitador/);
    }
    // Os delimitadores mudam a cada execução.
    expect(buildOrdersSql(base()).split('\n')[1]).not.toBe(sql.split('\n')[1]);
  });
});
