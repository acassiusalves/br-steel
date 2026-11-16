import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { OperationError, result } from '@/server/operations/common';
import {
  DONE, TODO, closeError, columnOf, currentQuantity, finishError, moveError, nextColumn, pauseError, priorityError, queueOrder, startError,
  type KanbanActor, type KanbanOrder, type KanbanTeam,
} from '@/lib/pcp/kanban-rules';
import type { OrderKind } from '@/lib/pcp/op-generator';
import { businessMinutes, type WorkPeriod } from '@/lib/pcp/business-time';
import type { Board, BoardActor, BoardCard, FinishInput, KanbanRepository } from './pcp-kanban-contract';
import { normalizeBadge } from '@/server/access/badges';
import { recordWriteAudit } from './write-audit';
import { withOperationalWrite } from './postgres-write';

type Row = Record<string, unknown>;
type Queryable = Pool | PoolClient;

const refuse = (message: string | null) => { if (message) throw new OperationError('INVALID_INPUT', message); };
const iso = (value: unknown) => (value ? (value as Date).toISOString() : null);

/** Tudo o que as regras precisam saber sobre equipes, funcionários e o usuário logado. */
async function loadPeople(db: Queryable, actor: BoardActor) {
  const workers = (await db.query('select id, name, badge, active, user_id from brsteel_pcp.workers')).rows as Row[];
  const members = (await db.query('select team_id, worker_id from brsteel_pcp.work_team_members')).rows as Row[];
  const teamOps = (await db.query('select team_id, operation_id from brsteel_pcp.work_team_operations')).rows as Row[];
  const teams: KanbanTeam[] = ((await db.query("select id, leader_id from brsteel_pcp.work_teams where status = 'aberto'")).rows as Row[])
    .map(t => ({ leaderId: (t.leader_id as string) ?? null,
      memberIds: members.filter(m => m.team_id === t.id).map(m => String(m.worker_id)),
      operationIds: teamOps.filter(o => o.team_id === t.id).map(o => String(o.operation_id)) }));
  const workerOps = new Map<string, string[]>();
  for (const r of (await db.query('select worker_id, operation_id from brsteel_pcp.worker_operations')).rows as Row[]) {
    workerOps.set(String(r.worker_id), [...(workerOps.get(String(r.worker_id)) ?? []), String(r.operation_id)]);
  }
  const me = workers.find(w => w.user_id === actor.userId && w.active);
  const kanbanActor: KanbanActor = { isAdmin: actor.isAdmin, workerId: me ? String(me.id) : null };
  return { workers, teams, workerOps, kanbanActor, me };
}

/** Lê a OP com suas OS no formato das regras. `lock` trava a OP para a gravação. */
async function loadOrder(db: Queryable, orderId: string, lock: boolean): Promise<KanbanOrder & { id: string }> {
  const order = (await db.query(`select id, status, phase_id, quantity,
      (select coalesce(sum(quantity), 0) from brsteel_pcp.production_order_losses l where l.order_id = o.id) loss_total
    from brsteel_pcp.production_orders o where id = $1${lock ? ' for update' : ''}`, [orderId])).rows[0] as Row | undefined;
  if (!order) throw new OperationError('NOT_FOUND', 'OP não encontrada.', 404);
  const steps = (await db.query(`select t.id, t.operation_id, op.phase_id, t.position, t.status, t.worker_id, t.predecessor_step_id,
      exists (select 1 from brsteel_pcp.production_order_step_pauses p where p.step_id = t.id and p.resumed_at is null) paused
    from brsteel_pcp.production_order_steps t join brsteel_pcp.production_operations op on op.id = t.operation_id
    where t.order_id = $1 order by t.position`, [orderId])).rows as Row[];
  return {
    id: orderId, status: order.status as KanbanOrder['status'], phaseId: (order.phase_id as string) ?? null,
    quantity: Number(order.quantity), lossTotal: Number(order.loss_total),
    steps: steps.map(s => ({ id: String(s.id), operationId: String(s.operation_id), phaseId: String(s.phase_id), position: Number(s.position),
      status: s.status as KanbanOrder['steps'][number]['status'], workerId: (s.worker_id as string) ?? null,
      predecessorId: (s.predecessor_step_id as string) ?? null, paused: Boolean(s.paused) })),
  };
}

async function event(client: PoolClient, row: { orderId: string; stepId?: string | null; kind: 'move' | 'start' | 'finish' | 'loss' | 'pause' | 'resume' | 'close' | 'priority';
  from?: string | null; to?: string | null; workerId?: string | null; userId: string; payload?: object }) {
  await client.query(`insert into brsteel_pcp.production_order_events (order_id, step_id, kind, from_column, to_column, worker_id, user_id, payload)
    values ($1, $2, $3, $4, $5, $6, $7, $8)`, [row.orderId, row.stepId ?? null, row.kind, row.from ?? null, row.to ?? null,
    row.workerId ?? null, row.userId, JSON.stringify(row.payload ?? {})]);
}

export function createPostgresKanbanRepository(pool: Pool): KanbanRepository {
  return {
    async board(actor: BoardActor) {
      const client = await pool.connect();
      try {
        await client.query('begin isolation level repeatable read read only');
        const phases = (await client.query(`select p.id, p.name, p.asks_badge from brsteel_pcp.production_phases p
          join brsteel_pcp.production_lines l on l.id = p.line_id where l.active order by l.name, p.position`)).rows as Row[];
        // Quadro do dia a dia: o que está em produção e os últimos concluídos.
        const orders = (await client.query(`select * from (
            select o.id, o.number, o.iapp_number, o.kind, o.sku, o.description, o.quantity, o.status, o.phase_id, o.created_at, o.updated_at,
              o.priority, o.origin, o.bling_order_number, (select m.number from brsteel_pcp.production_orders m where m.id = o.parent_order_id) parent_number,
              (select coalesce(sum(quantity), 0) from brsteel_pcp.production_order_losses l where l.order_id = o.id) loss_total
            from brsteel_pcp.production_orders o where o.status in ('a_produzir', 'produzindo')
            union all
            select * from (select o.id, o.number, o.iapp_number, o.kind, o.sku, o.description, o.quantity, o.status, o.phase_id, o.created_at, o.updated_at,
              o.priority, o.origin, o.bling_order_number, (select m.number from brsteel_pcp.production_orders m where m.id = o.parent_order_id) parent_number,
              (select coalesce(sum(quantity), 0) from brsteel_pcp.production_order_losses l where l.order_id = o.id) loss_total
              from brsteel_pcp.production_orders o where o.status = 'concluido' order by o.updated_at desc limit 50) done
          ) cards order by number`)).rows as Row[];
        const ids = orders.map(o => o.id);
        const steps = (await client.query(`select t.id, t.order_id, t.operation_id, op.name as operation_name, op.phase_id, t.position, t.status,
            t.worker_id, w.name as worker_name, t.started_at, t.finished_at, t.notes, t.predecessor_step_id, t.imported
          from brsteel_pcp.production_order_steps t join brsteel_pcp.production_operations op on op.id = t.operation_id
          left join brsteel_pcp.workers w on w.id = t.worker_id where t.order_id = any($1) order by t.position`, [ids])).rows as Row[];
        const losses = (await client.query(`select l.order_id, l.quantity, r.name as reason, l.notes, l.created_at
          from brsteel_pcp.production_order_losses l join brsteel_pcp.loss_reasons r on r.id = l.reason_id
          where l.order_id = any($1) order by l.created_at`, [ids])).rows as Row[];
        const pauses = (await client.query(`select step_id, paused_at, resumed_at from brsteel_pcp.production_order_step_pauses
          where order_id = any($1) order by paused_at`, [ids])).rows as Row[];
        const reasons = (await client.query('select id, name from brsteel_pcp.loss_reasons where active order by name')).rows as Row[];
        const periods: WorkPeriod[] = ((await client.query('select weekday, starts_at, ends_at from brsteel_pcp.work_periods')).rows as Row[])
          .map(p => ({ weekday: Number(p.weekday), startsAt: String(p.starts_at).slice(0, 5), endsAt: String(p.ends_at).slice(0, 5) }));
        const holidays = new Set(((await client.query('select day::text as day from brsteel_pcp.holidays')).rows as Row[]).map(h => String(h.day)));
        const people = await loadPeople(client, actor);
        await client.query('commit');

        const workerName = new Map(people.workers.map(w => [String(w.id), String(w.name)]));
        const now = new Date();
        const minutes = (from: unknown, to: unknown) => (from ? businessMinutes(from as Date, (to as Date) ?? now, periods, holidays) : null);
        const cards: BoardCard[] = orders.map(o => {
          const orderSteps = steps.filter(s => s.order_id === o.id);
          const state: KanbanOrder = {
            status: o.status as KanbanOrder['status'], phaseId: (o.phase_id as string) ?? null, quantity: Number(o.quantity), lossTotal: Number(o.loss_total),
            steps: orderSteps.map(s => ({ id: String(s.id), operationId: String(s.operation_id), phaseId: String(s.phase_id), position: Number(s.position),
              status: s.status as KanbanOrder['steps'][number]['status'], workerId: (s.worker_id as string) ?? null, predecessorId: (s.predecessor_step_id as string) ?? null,
              paused: pauses.some(p => p.step_id === s.id && !p.resumed_at) })),
          };
          const target = nextColumn(state);
          const startable = state.steps.find(s => s.phaseId === state.phaseId && s.status === 'aberto');
          const eligible = startable ? people.workers.filter(w => !startError(state, startable.id, String(w.id),
            people.workerOps.get(String(w.id)) ?? [], Boolean(w.active), people.kanbanActor, people.teams)) : [];
          const running = state.steps.find(s => s.status === 'em_execucao');
          const boardSteps = orderSteps.map((s, i) => {
            const stepPauses = pauses.filter(p => p.step_id === s.id);
            // Pausa aberta conta até o fim da OS (finalizada pausada) ou até agora.
            const pausedMinutes = stepPauses.reduce((n, p) => n + (minutes(p.paused_at, p.resumed_at ?? s.finished_at ?? null) ?? 0), 0);
            const run = minutes(s.started_at, s.finished_at ?? null);
            const open = s.status === 'em_execucao' ? stepPauses.find(p => !p.resumed_at) : undefined;
            return { id: String(s.id), operationName: String(s.operation_name), phaseId: String(s.phase_id), position: Number(s.position),
              status: s.status as BoardCard['steps'][number]['status'], workerName: s.worker_id ? workerName.get(String(s.worker_id)) ?? null : null,
              startedAt: iso(s.started_at), finishedAt: iso(s.finished_at), notes: (s.notes as string) ?? null,
              // A espera vai do fim da OS anterior até o início desta; se ela ainda não começou, até agora.
              waitMinutes: i > 0 && orderSteps[i - 1].finished_at ? minutes(orderSteps[i - 1].finished_at, s.started_at ?? null) : null,
              runMinutes: run === null ? null : Math.max(0, run - pausedMinutes), pausedMinutes, pausedSince: open ? iso(open.paused_at) : null,
              imported: Boolean(s.imported) };
          });
          return {
            id: String(o.id), number: Number(o.number), iappNumber: (o.iapp_number as string) ?? null,
            urgent: o.priority === 'urgente', origin: o.origin as BoardCard['origin'], salesOrderNumber: (o.bling_order_number as string) ?? null,
            parentNumber: o.parent_number == null ? null : Number(o.parent_number), kind: o.kind as OrderKind, sku: String(o.sku), description: (o.description as string) ?? null,
            quantity: state.quantity, currentQuantity: currentQuantity(state), column: columnOf(state), createdAt: iso(o.created_at)!,
            steps: boardSteps,
            totals: { runMinutes: boardSteps.reduce((n, t) => n + (t.runMinutes ?? 0), 0), waitMinutes: boardSteps.reduce((n, t) => n + (t.waitMinutes ?? 0) + t.pausedMinutes, 0) },
            losses: losses.filter(l => l.order_id === o.id).map(l => ({ quantity: Number(l.quantity), reason: String(l.reason), notes: (l.notes as string) ?? null, createdAt: iso(l.created_at)! })),
            allowed: {
              moveTo: target && !moveError(state, target, people.kanbanActor, people.teams) ? target : null,
              start: startable && eligible.length ? { stepId: startable.id, workers: eligible.map(w => ({ id: String(w.id), name: String(w.name) })) } : null,
              finishStepId: running && !finishError(state, running.id, people.kanbanActor, people.teams, 0) ? running.id : null,
              pauseStepId: running && !pauseError(state, running.id, true, people.kanbanActor, people.teams) ? running.id : null,
              resumeStepId: running && !pauseError(state, running.id, false, people.kanbanActor, people.teams) ? running.id : null,
              close: !closeError(state, people.kanbanActor),
              setUrgent: !priorityError(state, people.kanbanActor),
            },
          };
        });
        const board: Board = {
          columns: [{ key: TODO, name: 'A produzir', asksBadge: false },
            ...phases.map(p => ({ key: String(p.id), name: String(p.name), asksBadge: Boolean(p.asks_badge) })), { key: DONE, name: 'Concluído', asksBadge: false }],
          cards: cards.sort(queueOrder), lossReasons: reasons.map(r => ({ id: String(r.id), name: String(r.name) })),
          actorWorker: people.me ? { id: String(people.me.id), name: String(people.me.name) } : null,
        };
        return result(board, 'postgres');
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async move(orderId: string, target: string, actor: BoardActor, badge?: string | null) {
      return withOperationalWrite(pool, async client => {
        const order = await loadOrder(client, orderId, true);
        const people = await loadPeople(client, actor);
        refuse(moveError(order, target, people.kanbanActor, people.teams));
        const asksBadge = target !== DONE && Boolean((await client.query(
          'select asks_badge from brsteel_pcp.production_phases where id = $1', [target])).rows[0]?.asks_badge);
        // Na coluna de operação, o card só entra com quem vai executar: o líder bipa o crachá e a OS começa.
        let executor: { workerId: string; stepId: string } | null = null;
        if (asksBadge) {
          if (!badge?.trim()) refuse('Bipe ou digite o crachá de quem vai executar.');
          const code = normalizeBadge(badge);
          // Mesma normalização do cadastro e do login. Antes da migration do formato, um código repetido em
          // maiúsculas e minúsculas ainda pode existir: nesse caso, recusa em vez de escolher uma pessoa por acaso.
          const matches = code ? people.workers.filter(w => normalizeBadge(String(w.badge)) === code) : [];
          if (matches.length > 1) refuse('Este crachá está repetido no cadastro de funcionários. Corrija na Engenharia antes de bipar.');
          const worker = matches[0];
          if (!worker) refuse('Crachá não encontrado.');
          const moved: KanbanOrder = { ...order, status: 'produzindo', phaseId: target };
          const step = moved.steps.find(s => s.phaseId === target && s.status === 'aberto');
          if (!step) refuse('Não há OS para iniciar nesta coluna.');
          refuse(startError(moved, step!.id, String(worker!.id), people.workerOps.get(String(worker!.id)) ?? [], Boolean(worker!.active),
            people.kanbanActor, people.teams, true));
          executor = { workerId: String(worker!.id), stepId: step!.id };
        }
        const from = columnOf(order);
        if (target === DONE) {
          await client.query(`update brsteel_pcp.production_orders set status = 'concluido', phase_id = null, updated_at = now() where id = $1`, [orderId]);
        } else {
          await client.query(`update brsteel_pcp.production_orders set status = 'produzindo', phase_id = $2, updated_at = now() where id = $1`, [orderId, target]);
        }
        await event(client, { orderId, kind: 'move', from, to: target, workerId: people.kanbanActor.workerId, userId: actor.userId });
        await recordWriteAudit(client, { operation: 'pcp.moveOrder', actor, target: { collection: 'pcp.orders', id: orderId } });
        if (executor) {
          await client.query(`update brsteel_pcp.production_order_steps set status = 'em_execucao', worker_id = $2, started_at = now() where id = $1`,
            [executor.stepId, executor.workerId]);
          await event(client, { orderId, stepId: executor.stepId, kind: 'start', workerId: executor.workerId, userId: actor.userId, payload: { badge: true } });
          await recordWriteAudit(client, { operation: 'pcp.startStep', actor, target: { collection: 'pcp.orderSteps', id: executor.stepId } });
        }
        return result(null, 'postgres');
      });
    },

    async start(orderId: string, stepId: string, workerId: string, actor: BoardActor) {
      return withOperationalWrite(pool, async client => {
        const order = await loadOrder(client, orderId, true);
        const people = await loadPeople(client, actor);
        const worker = people.workers.find(w => String(w.id) === workerId);
        if (!worker) throw new OperationError('NOT_FOUND', 'Funcionário não encontrado.', 404);
        refuse(startError(order, stepId, workerId, people.workerOps.get(workerId) ?? [], Boolean(worker.active), people.kanbanActor, people.teams));
        await client.query(`update brsteel_pcp.production_order_steps set status = 'em_execucao', worker_id = $2, started_at = now() where id = $1`, [stepId, workerId]);
        await client.query(`update brsteel_pcp.production_orders set status = 'produzindo', updated_at = now() where id = $1`, [orderId]);
        await event(client, { orderId, stepId, kind: 'start', workerId, userId: actor.userId });
        await recordWriteAudit(client, { operation: 'pcp.startStep', actor, target: { collection: 'pcp.orderSteps', id: stepId } });
        return result(null, 'postgres');
      });
    },

    async finish(orderId: string, stepId: string, input: FinishInput, actor: BoardActor) {
      return withOperationalWrite(pool, async client => {
        const order = await loadOrder(client, orderId, true);
        const people = await loadPeople(client, actor);
        refuse(finishError(order, stepId, people.kanbanActor, people.teams, input.lossQuantity));
        if (input.lossQuantity > 0) {
          if (!input.lossReasonId) refuse('Informe o motivo da perda.');
          const reason = (await client.query('select 1 from brsteel_pcp.loss_reasons where id = $1 and active', [input.lossReasonId])).rowCount;
          if (!reason) refuse('Motivo de perda não encontrado.');
        }
        const workerId = order.steps.find(s => s.id === stepId)!.workerId;
        // Finalizar uma OS pausada fecha a pausa no mesmo instante.
        await client.query(`update brsteel_pcp.production_order_step_pauses set resumed_at = now(), resumed_by = $2
          where step_id = $1 and resumed_at is null`, [stepId, actor.userId]);
        await client.query(`update brsteel_pcp.production_order_steps set status = 'executada', finished_at = now(), notes = $2 where id = $1`,
          [stepId, input.notes]);
        await event(client, { orderId, stepId, kind: 'finish', workerId, userId: actor.userId, payload: input.notes ? { notes: input.notes } : {} });
        if (input.lossQuantity > 0) {
          await client.query(`insert into brsteel_pcp.production_order_losses (order_id, step_id, quantity, reason_id, notes, created_by)
            values ($1, $2, $3, $4, $5, $6)`, [orderId, stepId, input.lossQuantity, input.lossReasonId, input.notes, actor.userId]);
          await event(client, { orderId, stepId, kind: 'loss', workerId, userId: actor.userId, payload: { quantity: input.lossQuantity, reasonId: input.lossReasonId } });
        }
        await client.query('update brsteel_pcp.production_orders set updated_at = now() where id = $1', [orderId]);
        await recordWriteAudit(client, { operation: 'pcp.finishStep', actor, target: { collection: 'pcp.orderSteps', id: stepId } });
        return result(null, 'postgres');
      });
    },

    async pause(orderId: string, stepId: string, actor: BoardActor) {
      return withOperationalWrite(pool, async client => {
        const order = await loadOrder(client, orderId, true);
        const people = await loadPeople(client, actor);
        refuse(pauseError(order, stepId, true, people.kanbanActor, people.teams));
        await client.query(`insert into brsteel_pcp.production_order_step_pauses (order_id, step_id, paused_by) values ($1, $2, $3)`,
          [orderId, stepId, actor.userId]);
        await event(client, { orderId, stepId, kind: 'pause', workerId: order.steps.find(s => s.id === stepId)!.workerId, userId: actor.userId });
        await recordWriteAudit(client, { operation: 'pcp.pauseStep', actor, target: { collection: 'pcp.orderSteps', id: stepId } });
        return result(null, 'postgres');
      });
    },

    async resume(orderId: string, stepId: string, actor: BoardActor) {
      return withOperationalWrite(pool, async client => {
        const order = await loadOrder(client, orderId, true);
        const people = await loadPeople(client, actor);
        refuse(pauseError(order, stepId, false, people.kanbanActor, people.teams));
        await client.query(`update brsteel_pcp.production_order_step_pauses set resumed_at = now(), resumed_by = $2
          where step_id = $1 and resumed_at is null`, [stepId, actor.userId]);
        await event(client, { orderId, stepId, kind: 'resume', workerId: order.steps.find(s => s.id === stepId)!.workerId, userId: actor.userId });
        await recordWriteAudit(client, { operation: 'pcp.resumeStep', actor, target: { collection: 'pcp.orderSteps', id: stepId } });
        return result(null, 'postgres');
      });
    },

    async close(orderId: string, actor: BoardActor) {
      return withOperationalWrite(pool, async client => {
        const order = await loadOrder(client, orderId, true);
        const people = await loadPeople(client, actor);
        refuse(closeError(order, people.kanbanActor));
        // As OPs filhas (partes para o corte) saem junto, desde que nenhuma tenha começado.
        const children = ((await client.query(`select id from brsteel_pcp.production_orders where parent_order_id = $1
          and status not in ('encerrado') order by number for update`, [orderId])).rows as Row[]).map(r => String(r.id));
        for (const childId of children) {
          if (closeError(await loadOrder(client, childId, false), people.kanbanActor)) refuse('Uma OP filha desta OP já começou: ela não pode ser excluída.');
        }
        for (const id of [orderId, ...children]) {
          await client.query(`update brsteel_pcp.production_orders set status = 'encerrado', updated_at = now() where id = $1`, [id]);
          await event(client, { orderId: id, kind: 'close', from: TODO, workerId: people.kanbanActor.workerId, userId: actor.userId,
            payload: id === orderId ? {} : { parentOrderId: orderId } });
          await recordWriteAudit(client, { operation: 'pcp.closeOrder', actor, target: { collection: 'pcp.orders', id } });
        }
        return result(null, 'postgres');
      });
    },

    async setPriority(orderId: string, urgent: boolean, actor: BoardActor) {
      return withOperationalWrite(pool, async client => {
        const order = await loadOrder(client, orderId, true);
        const people = await loadPeople(client, actor);
        refuse(priorityError(order, people.kanbanActor));
        const to = urgent ? 'urgente' : 'estoque';
        // As partes para o corte acompanham a OP mãe.
        const targets = (await client.query(`select id, priority from brsteel_pcp.production_orders
          where (id = $1 or parent_order_id = $1) and status in ('a_produzir', 'produzindo') order by number for update`, [orderId])).rows as Row[];
        for (const target of targets.filter(t => t.priority !== to)) {
          await client.query('update brsteel_pcp.production_orders set priority = $2, updated_at = now() where id = $1', [target.id, to]);
          await event(client, { orderId: String(target.id), kind: 'priority', workerId: people.kanbanActor.workerId, userId: actor.userId,
            payload: { from: target.priority, to, ...(target.id === orderId ? {} : { parentOrderId: orderId }) } });
          await recordWriteAudit(client, { operation: 'pcp.setOrderPriority', actor, target: { collection: 'pcp.orders', id: String(target.id) } });
        }
        return result(null, 'postgres');
      });
    },
  };
}
