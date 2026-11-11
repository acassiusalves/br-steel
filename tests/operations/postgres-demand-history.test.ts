import { expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { createPostgresProductionDemandRepository } from '@/server/persistence/postgres-production-demand';

/**
 * O cliente SQL é a fronteira externa; o helper de transação e a montagem da resposta rodam de
 * verdade. Mesmo padrão de `database()` em tests/mcp/postgres-pilot.test.ts.
 */
function database(rows: Record<string, unknown>[], hasStock = true, weekly: Record<string, unknown>[] = []) {
  const client = {
    async query(sql: string) {
      if (sql.includes('brsteel_import.state')) return { rows: [{ ready: true }] };
      if (sql.startsWith('with valid_items')) return { rows };
      if (sql.includes('sku_weekly_demand')) return { rows: weekly };
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

it('serves the stored closed weeks and no longer claims the series is missing from this source', async () => {
  const weekly = [{ source_id: 'CBA600~abcdef123456', payload: { sku: 'CBA600', weeks: { '2026-W35': { units: 3, orders: 1 }, '2026-W34': { units: 5, orders: 2 } } } }];
  const response = await createPostgresProductionDemandRepository(database([row], true, weekly)).read(range);
  expect(response.data[0].history).toEqual([{ week: '2026-W34', units: 5, orders: 2 }, { week: '2026-W35', units: 3, orders: 1 }]);
  expect(response.warnings.some(warning => /série semanal/i.test(warning))).toBe(false);
});

it('does not warn about a history nobody received', async () => {
  const response = await createPostgresProductionDemandRepository(database([])).read(range);
  expect(response.data).toEqual([]);
  expect(response.warnings.some(warning => /série semanal/i.test(warning))).toBe(false);
});
