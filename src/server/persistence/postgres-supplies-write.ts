import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { OperationError, result } from '@/server/operations/common';
import { NATIVE_RUN_ID, contentHash } from '@/server/migration/operational-snapshot';
import type { MovementInput, SuppliesWriteRepository, SupplyFields } from './supplies-write-contract';
import { validateLimits } from './supplies-write-contract';
import { recordWriteAudit, type WriteActor } from './write-audit';
import { withOperationalWrite } from './postgres-write';

const skuKey = (sku: string) => createHash('sha256').update(sku).digest('hex');
/** Monotonic and in the nanosecond scale the snapshot versions use, so ordering stays comparable. */
const nativeVersion = () => String(BigInt(Date.now()) * BigInt(1000000));
const notFound = () => new OperationError('NOT_FOUND', 'Insumo não encontrado.', 404);
const duplicate = () => new OperationError('DUPLICATE_SKU', 'Já existe um insumo com este SKU.', 409);

type Doc = Record<string, unknown>;

const writeSupply = (client: PoolClient, id: string, payload: Doc) => client.query(
  `insert into brsteel_ops.supplies (source_id, payload, source_version, source_hash, import_run_id, source_deleted, lookup_sku)
   values ($1, $2, $3, $4, $5, false, $6)
   on conflict (source_id) do update set payload = excluded.payload, source_version = excluded.source_version,
     source_hash = excluded.source_hash, lookup_sku = excluded.lookup_sku, source_deleted = false`,
  [id, JSON.stringify(payload), nativeVersion(), contentHash(payload), NATIVE_RUN_ID, String(payload.codigo || id)]);

const writeRow = (client: PoolClient, table: 'supply_codes' | 'inventory_movements', id: string, payload: Doc) => client.query(
  `insert into brsteel_ops.${table} (source_id, payload, source_version, source_hash, import_run_id)
   values ($1, $2, $3, $4, $5)
   on conflict (source_id) do update set payload = excluded.payload, source_version = excluded.source_version,
     source_hash = excluded.source_hash, source_deleted = false`,
  [id, JSON.stringify(payload), nativeVersion(), contentHash(payload), NATIVE_RUN_ID]);

/** Locks the row so a concurrent movement serializes instead of reading a stale balance. */
async function lockSupply(client: PoolClient, id: string): Promise<Doc> {
  const row = (await client.query(
    'select payload from brsteel_ops.supplies where source_id = $1 and not source_deleted for update', [id])).rows[0];
  if (!row) throw notFound();
  return row.payload as Doc;
}

export function createPostgresSuppliesWriteRepository(pool: Pool): SuppliesWriteRepository {
  return {
    async findBySku(sku: string) {
      return (await pool.query(`select source_id from brsteel_ops.supplies
        where lookup_sku = $1 and not source_deleted order by source_id limit 2`, [sku])).rows.map(row => row.source_id);
    },

    async create(input: SupplyFields, actor: WriteActor) {
      const id = randomUUID();
      return withOperationalWrite(pool, async client => {
        // supply_codes.supply_id is a generated column with a foreign key, so the supply must exist first.
        // A duplicate rolls the whole transaction back, so writing before claiming leaves nothing behind.
        await writeSupply(client, id, { ...input, estoqueAtual: 0, createdAt: new Date().toISOString(), createdBy: actor.userId });
        const existing = await client.query(
          `select 1 from brsteel_ops.supplies where lookup_sku = $1 and source_id <> $2 and not source_deleted limit 1`,
          [input.codigo, id]);
        if (existing.rowCount) throw duplicate();
        // Uniqueness is claimed by the insert itself; a prior read would not hold under concurrency.
        const claimed = await client.query(
          `insert into brsteel_ops.supply_codes (source_id, payload, source_version, source_hash, import_run_id)
           values ($1, $2, $3, $4, $5) on conflict (source_id) do nothing`,
          [skuKey(input.codigo), JSON.stringify({ supplyId: id }), nativeVersion(),
            contentHash({ supplyId: id }), NATIVE_RUN_ID]);
        if (!claimed.rowCount) throw duplicate();
        await recordWriteAudit(client, { operation: 'supplies.create', actor, target: { collection: 'supplies', id } });
        return result({ id }, 'postgres');
      });
    },

    async update(id: string, input: Partial<SupplyFields>, actor: WriteActor) {
      return withOperationalWrite(pool, async client => {
        const existing = await lockSupply(client, id);
        validateLimits({ ...existing, ...input });
        if (input.codigo && input.codigo !== existing.codigo) {
          const held = (await client.query(
            `select payload->>'supplyId' as supply from brsteel_ops.supply_codes where source_id = $1`,
            [skuKey(input.codigo)])).rows[0];
          if (held && held.supply !== id) throw duplicate();
          const matches = await client.query(
            `select 1 from brsteel_ops.supplies where lookup_sku = $1 and source_id <> $2 and not source_deleted limit 1`,
            [input.codigo, id]);
          if (matches.rowCount) throw duplicate();
          if (existing.codigo) {
            await client.query('delete from brsteel_ops.supply_codes where source_id = $1', [skuKey(String(existing.codigo))]);
          }
          await writeRow(client, 'supply_codes', skuKey(input.codigo), { supplyId: id });
        }
        await writeSupply(client, id, { ...existing, ...input, updatedAt: new Date().toISOString(), updatedBy: actor.userId });
        await recordWriteAudit(client, { operation: 'supplies.update', actor, target: { collection: 'supplies', id } });
        return result({ id }, 'postgres');
      });
    },

    async remove(id: string, actor: WriteActor) {
      return withOperationalWrite(pool, async client => {
        const existing = await lockSupply(client, id);
        const history = await client.query(
          `select 1 from brsteel_ops.inventory_movements where payload->>'supplyId' = $1 and not source_deleted limit 1`, [id]);
        if (history.rowCount || (existing.estoqueAtual ?? 0) !== 0) {
          throw new OperationError('SUPPLY_IN_USE', 'Não é possível excluir um insumo com saldo ou histórico de movimentações.', 409);
        }
        // The key row carries a foreign key to the supply, so it has to go first.
        if (existing.codigo) {
          await client.query('delete from brsteel_ops.supply_codes where source_id = $1', [skuKey(String(existing.codigo))]);
        }
        await client.query('delete from brsteel_ops.supplies where source_id = $1', [id]);
        await recordWriteAudit(client, { operation: 'supplies.remove', actor, target: { collection: 'supplies', id } });
        return result({ id }, 'postgres');
      });
    },

    async recordMovement(input: MovementInput, actor: WriteActor) {
      const id = randomUUID();
      return withOperationalWrite(pool, async client => {
        const supply = await lockSupply(client, input.supplyId);
        const current = supply.estoqueAtual ?? 0;
        if (typeof current !== 'number' || !Number.isFinite(current)) {
          throw new OperationError('INVALID_BALANCE', 'Saldo cadastrado inválido.');
        }
        const balance = current + (input.type === 'entrada' ? input.quantity : -input.quantity);
        if (!Number.isFinite(balance) || Math.abs(balance) > 1e12) {
          throw new OperationError('INVALID_BALANCE', 'Saldo fora do limite permitido.');
        }
        const createdAt = new Date().toISOString();
        await writeSupply(client, input.supplyId, { ...supply, estoqueAtual: balance, updatedAt: createdAt, updatedBy: actor.userId });
        await writeRow(client, 'inventory_movements', id,
          { ...input, createdAt, createdBy: actor.userId, source: actor.source, balanceAfter: balance });
        await recordWriteAudit(client, { operation: 'supplies.recordMovement', actor,
          target: { collection: 'inventoryMovements', id } });
        return result({ id, newStock: balance }, 'postgres', balance < 0
          ? [`O saldo deste insumo ficou negativo (${balance}).`] : []);
      });
    },
  };
}
