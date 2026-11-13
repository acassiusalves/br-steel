import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { OperationError } from '@/server/operations/common';
import type { SupportTicket, TicketPerson, TicketReopen } from '@/types/support-tickets';
import type { SupportTicketRepository } from './support-tickets-contract';
import { recordWriteAudit } from './write-audit';
import { withOperationalWrite } from './postgres-write';

type Row = Record<string, unknown>;
const COLUMNS = `id, ticket_number, created_by_uid, created_by, category, description, status, source, fingerprint, context,
  domain_context, logs, breadcrumbs, reopen_history, reopen_count, updated_by, created_at, updated_at, resolved_at`;

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value ? String(value) : null);
const person = (value: unknown, uid = ''): TicketPerson => {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return { uid: typeof v.uid === 'string' ? v.uid : uid, email: typeof v.email === 'string' ? v.email : null,
    name: typeof v.name === 'string' ? v.name : null, role: typeof v.role === 'string' ? v.role : null };
};

export function ticketFromRow(r: Row): SupportTicket {
  return {
    id: String(r.id), ticketNumber: Number(r.ticket_number), createdByUid: String(r.created_by_uid),
    user: person(r.created_by, String(r.created_by_uid)), category: r.category as SupportTicket['category'],
    description: String(r.description), status: r.status as SupportTicket['status'], source: String(r.source),
    fingerprint: String(r.fingerprint), context: (r.context ?? {}) as Record<string, unknown>,
    domainContext: (r.domain_context ?? {}) as Record<string, unknown>, logs: (r.logs ?? []) as SupportTicket['logs'],
    breadcrumbs: (r.breadcrumbs ?? []) as SupportTicket['breadcrumbs'], reopenHistory: (r.reopen_history ?? []) as TicketReopen[],
    reopenCount: Number(r.reopen_count ?? 0), updatedBy: r.updated_by ? person(r.updated_by) : null,
    createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!, resolvedAt: iso(r.resolved_at),
  };
}

async function lockTicket(client: PoolClient, id: string): Promise<Row> {
  const row = (await client.query(`select ${COLUMNS} from brsteel_support.tickets where id = $1 for update`, [id])).rows[0];
  if (!row) throw new OperationError('NOT_FOUND', 'Reporte não encontrado.', 404);
  return row;
}

export function createPostgresSupportTicketRepository(pool: Pool): SupportTicketRepository {
  return {
    async list(createdByUid, limit) {
      const rows = (await pool.query(
        `select ${COLUMNS} from brsteel_support.tickets where ($1::text is null or created_by_uid = $1)
         order by created_at desc, ticket_number desc limit $2`, [createdByUid, limit])).rows;
      return rows.map(ticketFromRow);
    },

    async create(input, rateLimit, actor) {
      return withOperationalWrite(pool, async client => {
        if (rateLimit) {
          const recent = Number((await client.query(
            `select count(*)::int as n from brsteel_support.tickets
             where created_by_uid = $1 and created_at > now() - make_interval(secs => $2)`,
            [input.createdBy.uid, rateLimit.windowSeconds])).rows[0].n);
          if (recent >= rateLimit.max) {
            throw new OperationError('RATE_LIMITED', 'Muitos reportes enviados em pouco tempo. Aguarde alguns minutos e tente novamente.', 429);
          }
        }
        const row = (await client.query(
          `insert into brsteel_support.tickets (created_by_uid, created_by, category, description, fingerprint, context,
             domain_context, logs, breadcrumbs)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id, ticket_number, fingerprint, category`,
          [input.createdBy.uid, JSON.stringify(input.createdBy), input.category, input.description, input.fingerprint,
            JSON.stringify(input.context), JSON.stringify(input.domainContext), JSON.stringify(input.logs),
            JSON.stringify(input.breadcrumbs)])).rows[0];
        await recordWriteAudit(client, { operation: 'support.createTicket', actor, target: { collection: 'support_tickets', id: String(row.id) } });
        return { id: String(row.id), ticketNumber: Number(row.ticket_number), fingerprint: String(row.fingerprint), category: row.category };
      });
    },

    async setStatus(id, status, updatedBy, actor) {
      return withOperationalWrite(pool, async client => {
        await lockTicket(client, id);
        const row = (await client.query(
          `update brsteel_support.tickets set status = $2, updated_by = $3 where id = $1 returning ${COLUMNS}`,
          [id, status, JSON.stringify(updatedBy)])).rows[0];
        await recordWriteAudit(client, { operation: 'support.updateTicketStatus', actor, target: { collection: 'support_tickets', id } });
        return ticketFromRow(row);
      });
    },

    async reopen(id, details, reopenedBy, actor) {
      return withOperationalWrite(pool, async client => {
        const current = await lockTicket(client, id);
        if (current.created_by_uid !== reopenedBy.uid) throw new OperationError('FORBIDDEN', 'Apenas o autor pode reabrir este chamado.', 403);
        if (current.status !== 'resolved') throw new OperationError('NOT_RESOLVED', 'Somente chamados resolvidos podem ser reabertos.', 409);
        const entry: TicketReopen = { details, reopenedAt: new Date().toISOString(), reopenedBy };
        const row = (await client.query(
          `update brsteel_support.tickets set status = 'pending', reopen_history = reopen_history || jsonb_build_array($2::jsonb),
             reopen_count = reopen_count + 1, updated_by = $3 where id = $1 returning ${COLUMNS}`,
          [id, JSON.stringify(entry), JSON.stringify(reopenedBy)])).rows[0];
        await recordWriteAudit(client, { operation: 'support.reopenTicket', actor, target: { collection: 'support_tickets', id } });
        return ticketFromRow(row);
      });
    },
  };
}
