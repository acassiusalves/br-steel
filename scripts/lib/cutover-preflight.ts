import type { Pool } from 'pg';
import { TABLES } from '../../src/server/migration/operational-snapshot';

export const HISTORY_MIGRATION = '20261111120000_operational_history.sql';

/** Tabelas da cópia ausentes em `brsteel_ops`: o ensaio recusa abrir a janela se houver alguma. */
export async function missingOperationalTables(pool: Pick<Pool, 'query'>, tables: readonly string[] = Object.values(TABLES)) {
  const present = (await pool.query(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'brsteel_ops' and c.relkind = 'r' and c.relname = any($1)`, [[...tables]])).rows.map(row => String(row.relname));
  return tables.filter(table => !present.includes(table));
}
