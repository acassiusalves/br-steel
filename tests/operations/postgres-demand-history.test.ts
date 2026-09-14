import { expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { createPostgresProductionDemandRepository } from '@/server/persistence/postgres-production-demand';

/**
 * O cliente SQL é a fronteira externa; o helper de transação e a montagem da resposta rodam de
 * verdade. Mesmo padrão de `database()` em tests/mcp/postgres-pilot.test.ts.
 */
function database(rows: Record<string, unknown>[], hasStock = true) {
  const client = {
    async query(sql: string) {
      if (sql.includes('brsteel_import.state')) return { rows: [{ ready: true }] };
      if (sql.startsWith('with valid_items')) return { rows };
      if (sql.includes('select exists')) return { rows: [{ found: hasStock }] };
      return { rows: [] };
    },
    release: vi.fn(),
  };
  return { connect: async () => client } as unknown as Pool;
}

const row = { sku: 'CBA600', description: 'Cuba', description_present: true,
  order_count: 2, quantity: 14, stock_read: { saldoVirtualTotal: 3, virtualAsOf: '2026-09-12T10:00:00Z' },
  minimum: 1, maximum: 9 };
const range = { from: '2026-09-01', to: '2026-09-07' };

it('says what its empty weekly history does not mean, instead of passing it off as a real series', async () => {
  const response = await createPostgresProductionDemandRepository(database([row])).read(range);
  expect(response.data[0].history).toEqual([]);
  const warnings = response.warnings.join(' ');
  // Depois do corte de fonte o MCP responde por aqui enquanto a tela e consultar_historico_sku
  // continuam servindo a série real: sem aviso, as duas respostas se contradizem em silêncio e o
  // vazio fica indistinguível de "este SKU não vendeu".
  expect(warnings).toMatch(/série semanal/i);
  expect(warnings).toMatch(/não indica/i);
});

it('does not warn about a history nobody received', async () => {
  const response = await createPostgresProductionDemandRepository(database([])).read(range);
  expect(response.data).toEqual([]);
  expect(response.warnings.some(warning => /série semanal/i.test(warning))).toBe(false);
});
