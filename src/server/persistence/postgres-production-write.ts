import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { OperationError, result, serialize } from '@/server/operations/common';
import { NATIVE_RUN_ID, contentHash } from '@/server/migration/operational-snapshot';
import type { ColumnInput, LotInput, LotUpdate, OrderInput, ProductionWriteRepository, WriteIdentity } from './production-write-contract';
import { recordWriteAudit, type WriteActor } from './write-audit';
import { withOperationalWrite } from './postgres-write';

type Doc = Record<string, unknown>;
type Table = 'production_columns' | 'production_lots' | 'production_lot_items' | 'production_comments' | 'production_counters';

const nativeVersion = () => String(BigInt(Date.now()) * BigInt(1000000));
const missing = () => new OperationError('NOT_FOUND', 'Registro não encontrado.', 404);
const now = () => new Date().toISOString();

const writeRow = (client: PoolClient, table: Table, id: string, payload: Doc) => client.query(
  `insert into brsteel_ops.${table} (source_id, payload, source_version, source_hash, import_run_id)
   values ($1, $2, $3, $4, $5)
   on conflict (source_id) do update set payload = excluded.payload, source_version = excluded.source_version,
     source_hash = excluded.source_hash, source_deleted = false`,
  [id, JSON.stringify(serialize(payload)), nativeVersion(), contentHash(serialize(payload)), NATIVE_RUN_ID]);

async function lockRow(client: PoolClient, table: Table, id: string): Promise<Doc> {
  const row = (await client.query(
    `select payload from brsteel_ops.${table} where source_id = $1 and not source_deleted for update`, [id])).rows[0];
  if (!row) throw missing();
  return row.payload as Doc;
}

export function createPostgresProductionWriteRepository(pool: Pool): ProductionWriteRepository {
  const audit = (client: PoolClient, operation: string, actor: WriteActor, collection: string, id: string) =>
    recordWriteAudit(client, { operation, actor, target: { collection, id } });

  return {
    async createColumn(input: ColumnInput, actor: WriteActor) {
      const id = randomUUID();
      return withOperationalWrite(pool, async client => {
        await writeRow(client, 'production_columns', id, { ...input, createdAt: now(), updatedAt: now() });
        await audit(client, 'production.createColumn', actor, 'productionColumns', id);
        return result({ id }, 'postgres');
      });
    },

    async updateColumn(id: string, input: Partial<ColumnInput>, actor: WriteActor) {
      return withOperationalWrite(pool, async client => {
        const existing = await lockRow(client, 'production_columns', id);
        await writeRow(client, 'production_columns', id, { ...existing, ...input, updatedAt: now() });
        await audit(client, 'production.updateColumn', actor, 'productionColumns', id);
        return result(null, 'postgres');
      });
    },

    async deleteColumn(id: string, actor: WriteActor) {
      return withOperationalWrite(pool, async client => {
        await lockRow(client, 'production_columns', id);
        const lots = await client.query(
          'select 1 from brsteel_ops.production_lots where column_id = $1 and not source_deleted limit 1', [id]);
        if (lots.rowCount) throw new OperationError('COLUMN_NOT_EMPTY', 'Mova os lotes antes de excluir a coluna.');
        await client.query('delete from brsteel_ops.production_columns where source_id = $1', [id]);
        await audit(client, 'production.deleteColumn', actor, 'productionColumns', id);
        return result(null, 'postgres');
      });
    },

    async reorderColumns(input: OrderInput[], actor: WriteActor) {
      return withOperationalWrite(pool, async client => {
        for (const entry of input) {
          const existing = await lockRow(client, 'production_columns', entry.id);
          await writeRow(client, 'production_columns', entry.id, { ...existing, order: entry.order, updatedAt: now() });
        }
        await audit(client, 'production.reorderColumns', actor, 'productionColumns', input.map(x => x.id).join(','));
        return result(null, 'postgres');
      });
    },

    async seedDefaultColumns(actor: WriteActor) {
      return withOperationalWrite(pool, async client => {
        // The lock row serializes concurrent seeds exactly like the Firestore metadata document.
        await writeRow(client, 'production_counters', 'production-columns', { initializedAt: now() });
        await client.query(
          `select 1 from brsteel_ops.production_counters where source_id = 'production-columns' for update`);
        const columns = await client.query(
          'select 1 from brsteel_ops.production_columns where not source_deleted limit 1');
        if (columns.rowCount) return result(null, 'postgres');
        const at = now();
        for (const [order, name] of ['Fila', 'Em Produção', 'Concluído'].entries()) {
          await writeRow(client, 'production_columns', `default-${order}`,
            { name, order, color: ['#6b7280', '#f59e0b', '#22c55e'][order], createdAt: at, updatedAt: at });
        }
        await audit(client, 'production.seedDefaultColumns', actor, 'productionColumns', 'defaults');
        return result(null, 'postgres');
      });
    },

    async createLot(input: LotInput, identities: { author: WriteIdentity; assignedTo: WriteIdentity | null }, actor: WriteActor) {
      const id = randomUUID(), year = new Date().getUTCFullYear();
      return withOperationalWrite(pool, async client => {
        // Locking the column serializes concurrent appends, as touching it does in Firestore.
        await lockRow(client, 'production_columns', input.columnId);
        const assignedTo = identities.assignedTo ? { ...identities.assignedTo, assignedAt: now() } : null;

        const linkedOrderIds = [...new Set(input.items.map(item => String(item.sourceOrderId)))];
        const orders = new Map((await client.query(
          `select source_id, payload from brsteel_ops.sales_orders where source_id = any($1) and not source_deleted`,
          [linkedOrderIds])).rows.map(row => [row.source_id as string, row.payload as Doc]));
        const requested = new Map<string, number>();
        const items = input.items.map(item => {
          const sale = orders.get(String(item.sourceOrderId));
          if (!sale) throw missing();
          const matches = (Array.isArray(sale.itens) ? sale.itens : []).filter((s: Doc) => s.codigo === item.sku);
          if (!matches.length) throw new OperationError('INVALID_ITEM', 'SKU não pertence ao pedido.');
          const key = `${item.sourceOrderId}:${item.sku}`;
          const quantity = (requested.get(key) || 0) + item.quantity; requested.set(key, quantity);
          if (quantity > matches.reduce((sum: number, s: Doc) => sum + Number(s.quantidade || 0), 0)) {
            throw new OperationError('INVALID_QUANTITY', 'Quantidade excede o pedido.');
          }
          return { lotId: id, sku: item.sku, quantity: item.quantity, productName: String(matches[0].descricao || item.sku),
            unit: String(matches[0].unidade || 'UN'), sourceOrderId: item.sourceOrderId,
            sourceOrderNumber: String(sale.numero || sale.id), customerName: '' };
        });

        const counterId = `production-lots-${year}`;
        const existed = (await client.query(
          `select payload from brsteel_ops.production_counters where source_id = $1 for update`, [counterId])).rows[0];
        // Mirrors the Firestore bootstrap: without a counter every lot is scanned for a legacy number.
        const scanned = (await client.query(existed
          ? `select payload from brsteel_ops.production_lots where column_id = $1 and not source_deleted`
          : `select payload from brsteel_ops.production_lots where not source_deleted`,
          existed ? [input.columnId] : [])).rows.map(row => row.payload as Doc);
        let sequence = Number((existed?.payload as Doc | undefined)?.sequence || 0);
        let maxOrder = -1;
        const pattern = new RegExp(`^LOT-${year}-(\\d+)$`);
        for (const lot of scanned) {
          const match = String(lot.lotNumber || '').match(pattern);
          if (match) sequence = Math.max(sequence, Number(match[1]));
          if (lot.columnId === input.columnId) maxOrder = Math.max(maxOrder, Number(lot.columnOrder || 0));
        }
        sequence++;
        const lotNumber = `LOT-${year}-${String(sequence).padStart(4, '0')}`, at = now();
        await writeRow(client, 'production_counters', counterId, { sequence });

        await writeRow(client, 'production_lots', id, {
          title: input.title, description: input.description || null, priority: input.priority,
          columnId: input.columnId, columnOrder: maxOrder + 1, dueDate: input.dueDate || null, assignedTo,
          createdBy: identities.author, linkedOrderIds, totalItems: items.reduce((sum, i) => sum + i.quantity, 0),
          totalSkus: new Set(items.map(i => i.sku)).size, lotNumber, createdAt: at, updatedAt: at,
        });
        for (const item of items) await writeRow(client, 'production_lot_items', randomUUID(), { ...item, createdAt: at });
        await audit(client, 'production.createLot', actor, 'productionLots', id);
        return result({ id, lotNumber }, 'postgres');
      });
    },

    async updateLot(id: string, input: LotUpdate, assigned: WriteIdentity | null | undefined, actor: WriteActor) {
      return withOperationalWrite(pool, async client => {
        const existing = await lockRow(client, 'production_lots', id);
        const columnId = input.columnId || String(existing.columnId);
        const column = await lockRow(client, 'production_columns', columnId);
        const at = now();
        const assignedTo = assigned ? { ...assigned, assignedAt: at } : assigned;
        await writeRow(client, 'production_columns', columnId, { ...column, updatedAt: at });
        await writeRow(client, 'production_lots', id,
          { ...existing, ...input, ...(assignedTo !== undefined ? { assignedTo } : {}), updatedAt: at });
        await audit(client, 'production.updateLot', actor, 'productionLots', id);
        return result(null, 'postgres');
      });
    },

    async reorderLotsInColumn(columnId: string, input: OrderInput[], actor: WriteActor) {
      return withOperationalWrite(pool, async client => {
        await lockRow(client, 'production_columns', columnId);
        for (const entry of input) {
          const lot = await lockRow(client, 'production_lots', entry.id);
          if (lot.columnId !== columnId) throw new OperationError('INVALID_COLUMN', 'Lote não pertence à coluna.');
          await writeRow(client, 'production_lots', entry.id, { ...lot, columnOrder: entry.order, updatedAt: now() });
        }
        await audit(client, 'production.reorderLots', actor, 'productionLots', input.map(x => x.id).join(','));
        return result(null, 'postgres');
      });
    },

    async deleteLot(id: string, actor: WriteActor) {
      return withOperationalWrite(pool, async client => {
        await lockRow(client, 'production_lots', id);
        const associated = (await client.query(
          `select (select count(*) from brsteel_ops.production_lot_items where lot_id = $1 and not source_deleted)
                + (select count(*) from brsteel_ops.production_comments where lot_id = $1 and not source_deleted) as total`,
          [id])).rows[0].total;
        if (Number(associated) > 498) {
          throw new OperationError('TOO_LARGE', 'Exclua comentários antes de remover este lote; limite de 498 registros associados.');
        }
        // Children carry foreign keys to the lot, so they go first.
        await client.query('delete from brsteel_ops.production_lot_items where lot_id = $1', [id]);
        await client.query('delete from brsteel_ops.production_comments where lot_id = $1', [id]);
        await client.query('delete from brsteel_ops.production_lots where source_id = $1', [id]);
        await audit(client, 'production.deleteLot', actor, 'productionLots', id);
        return result(null, 'postgres');
      });
    },

    async createComment(input: { lotId: string; content: string }, author: WriteIdentity, actor: WriteActor) {
      const id = randomUUID();
      return withOperationalWrite(pool, async client => {
        const lot = await lockRow(client, 'production_lots', input.lotId);
        const at = now();
        await writeRow(client, 'production_lots', input.lotId, { ...lot, updatedAt: at });
        await writeRow(client, 'production_comments', id, { lotId: input.lotId, content: input.content, author, createdAt: at });
        await audit(client, 'production.createComment', actor, 'productionComments', id);
        return result({ id }, 'postgres');
      });
    },

    async changeComment(id: string, content: string | undefined, options: { isAdmin: boolean }, actor: WriteActor) {
      return withOperationalWrite(pool, async client => {
        const comment = await lockRow(client, 'production_comments', id);
        await lockRow(client, 'production_lots', String(comment.lotId));
        const owner = (comment.author as Doc | undefined)?.userId;
        if (owner !== actor.userId && !options.isAdmin) {
          throw new OperationError('FORBIDDEN', 'Somente o autor pode alterar o comentário.', 403);
        }
        if (content === undefined) await client.query('delete from brsteel_ops.production_comments where source_id = $1', [id]);
        else await writeRow(client, 'production_comments', id, { ...comment, content, updatedAt: now() });
        await audit(client, 'production.changeComment', actor, 'productionComments', id);
        return result(null, 'postgres');
      });
    },
  };
}
