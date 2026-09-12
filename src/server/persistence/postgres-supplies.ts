import 'server-only';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { SupplyRead } from '@/types/supply';
import { documentIdSchema, OperationError, result } from '@/server/operations/common';
import type { SuppliesReadRepository, SupplyMovementRead } from './supplies-contract';
import { movementDateBounds } from './supplies-read-projection';
import { withOperationalSnapshot } from './postgres-read';

function documentCursor(cursor?: string) {
  if (!cursor) return undefined;
  try { return documentIdSchema.parse(Buffer.from(cursor, 'base64url').toString('utf8')); }
  catch { throw new OperationError('INVALID_CURSOR', 'Paginação inválida.'); }
}
// ECMAScript String.trim whitespace, including Unicode spaces and the byte-order mark.
const nameWhitespace = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';

/** Candidate adapter preserving the existing named supply and movement payload contracts. */
export function createPostgresSuppliesRepository(pool: Pool): SuppliesReadRepository {
  return {
    async list(input) {
      const cursor = documentCursor(input.cursor);
      return withOperationalSnapshot(pool, async client => {
        // Filter names only after selecting the scanned document page, so omitted rows still advance it.
        const rows = (await client.query(`with scanned as (
          select source_id,payload from brsteel_ops.supplies
          where not source_deleted and ($1::text is null or source_id>$1) order by source_id limit $2
        ) select source_id,case when jsonb_typeof(payload->'nome')='string' and btrim(payload->>'nome',$3)<>''
          then payload || jsonb_build_object('id',source_id) else null end as data from scanned order by source_id`,
        [cursor ?? null, input.limit + 1, nameWhitespace])).rows;
        const page = rows.slice(0, input.limit);
        const nextCursor = rows.length > input.limit ? Buffer.from(page.at(-1)!.source_id).toString('base64url') : null;
        const supplies = page.flatMap(row => row.data === null ? [] : [row.data as SupplyRead]);
        const warnings = supplies.length < page.length
          ? ['Registros sem nome de insumo foram omitidos.' + (nextCursor ? ' Continue pela próxima página para consultar os demais registros.' : '')] : [];
        return result(supplies, 'postgres', warnings, nextCursor);
      });
    },
    async listMovements(input) {
      const dated = Boolean(input.from || input.to);
      let cursor: { id: string; createdAt?: string } | undefined;
      if (dated && input.cursor) {
        try { cursor = z.object({ createdAt: z.string().datetime(), id: documentIdSchema }).strict().parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))); }
        catch { throw new OperationError('INVALID_CURSOR', 'Paginação inválida.'); }
      } else {
        const id = documentCursor(input.cursor);
        if (id) cursor = { id };
      }
      const bounds = movementDateBounds(input);
      return withOperationalSnapshot(pool, async client => {
        const values: unknown[] = [input.supplyId];
        const param = (value: unknown) => { values.push(value); return `$${values.length}`; };
        const filters = ['not source_deleted', 'supply_id=$1', "payload->'supplyId'=to_jsonb($1::text)"];
        const date = "(payload->>'createdAt') collate \"C\"";
        if (dated) filters.push("jsonb_typeof(payload->'createdAt')='string'");
        if (bounds.from) filters.push(`${date}>=${param(bounds.from)}`);
        if (bounds.to) filters.push(`${date}<${param(bounds.to)}`);
        if (cursor) filters.push(dated ? `(${date},source_id)>(${param(cursor.createdAt)},${param(cursor.id)})` : `source_id>${param(cursor.id)}`);
        const rows = (await client.query(`select source_id,payload || jsonb_build_object('id',source_id) as data
          from brsteel_ops.inventory_movements where ${filters.join(' and ')}
          order by ${dated ? `${date},` : ''}source_id limit ${param(input.limit + 1)}`, values)).rows;
        const page = rows.slice(0, input.limit), last = page.at(-1);
        const nextCursor = rows.length > input.limit ? Buffer.from(dated
          ? JSON.stringify({ createdAt: last!.data.createdAt, id: last!.source_id }) : last!.source_id).toString('base64url') : null;
        return result(page.map(row => row.data as SupplyMovementRead), 'postgres', [], nextCursor);
      });
    },
  };
}
