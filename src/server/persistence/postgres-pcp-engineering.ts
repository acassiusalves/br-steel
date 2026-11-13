import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { OperationError, result } from '@/server/operations/common';
import { predecessorError, teamMembersError, workPeriodsError } from '@/lib/pcp/engineering-rules';
import type {
  EngineeringRepository, EngineeringSnapshot, Holiday, LineInput, OperationInput, TeamInput, WorkerInput, WorkPeriodRow,
} from './pcp-engineering-contract';
import { recordWriteAudit, type WriteActor } from './write-audit';
import { withOperationalWrite } from './postgres-write';

type Row = Record<string, unknown>;

const missing = (what: string) => new OperationError('NOT_FOUND', `${what} não encontrado(a).`, 404);
const refuse = (message: string | null) => { if (message) throw new OperationError('INVALID_INPUT', message); };

/**
 * Traduz as violações de restrição em recusas legíveis. O texto do driver nunca sai daqui: ele pode
 * trazer valores da linha.
 */
function mapConstraint(error: unknown): never {
  const { code, constraint } = error as { code?: string; constraint?: string };
  if (code === '23505') {
    const field = constraint?.includes('badge') ? 'crachá' : constraint?.includes('code') ? 'código'
      : constraint?.includes('user_id') ? 'usuário' : 'nome';
    throw new OperationError('DUPLICATE', `Já existe um cadastro com este ${field}.`, 409);
  }
  if (code === '23503') throw new OperationError('IN_USE', 'O cadastro está em uso ou referencia um registro inexistente.', 409);
  throw error;
}

const write = <T>(pool: Pool, run: (client: PoolClient) => Promise<T>) =>
  withOperationalWrite(pool, run).catch(mapConstraint);

const hhmm = (value: unknown) => String(value).slice(0, 5);

export function createPostgresEngineeringRepository(pool: Pool): EngineeringRepository {
  const audit = (client: PoolClient, operation: string, actor: WriteActor, collection: string, id: string) =>
    recordWriteAudit(client, { operation, actor, target: { collection, id } });

  return {
    async read() {
      // Uma conexão, consultas em sequência: o pool é pequeno e compartilhado com o núcleo, e a leitura
      // em paralelo ocupava todas as conexões e fazia outras requisições esperarem até o tempo limite.
      const statements = [
        'select id, name, monthly_capacity, active from brsteel_pcp.production_lines order by name',
        'select id, line_id, name, position from brsteel_pcp.production_phases order by line_id, position',
        `select o.*, p.line_id from brsteel_pcp.production_operations o
          join brsteel_pcp.production_phases p on p.id = o.phase_id order by p.position, o.position, o.name`,
        'select id, name, status, shift, leader_id from brsteel_pcp.work_teams order by name',
        'select team_id, operation_id from brsteel_pcp.work_team_operations',
        'select id, name, badge, kind, active, user_id from brsteel_pcp.workers order by name',
        'select worker_id, operation_id from brsteel_pcp.worker_operations',
        'select weekday, starts_at, ends_at from brsteel_pcp.work_periods order by weekday, starts_at',
        'select day::text as day, name from brsteel_pcp.holidays order by day',
        'select team_id, worker_id, leader_id from brsteel_pcp.work_team_members',
        'select id, name, active from brsteel_pcp.loss_reasons order by name',
      ];
      const client = await pool.connect();
      const rows: { rows: Row[] }[] = [];
      try {
        // Transação só de leitura e repetível: as 11 consultas veem o mesmo estado.
        await client.query('begin isolation level repeatable read read only');
        for (const sql of statements) rows.push(await client.query(sql));
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      const [lines, phases, operations, teams, teamOps, workers, workerOps, periods, holidays, members, reasons] = rows;
      const group = (rows: Row[], key: string, value: string) => rows.reduce((map, r) => {
        const list = map.get(String(r[key])) ?? []; list.push(String(r[value])); return map.set(String(r[key]), list);
      }, new Map<string, string[]>());
      const teamOperationIds = group(teamOps.rows, 'team_id', 'operation_id');
      const workerOperationIds = group(workerOps.rows, 'worker_id', 'operation_id');
      const snapshot: EngineeringSnapshot = {
        lines: lines.rows.map((l: Row) => ({
          id: String(l.id), name: String(l.name), monthlyCapacity: Number(l.monthly_capacity), active: Boolean(l.active),
          phases: phases.rows.filter((p: Row) => p.line_id === l.id)
            .map((p: Row) => ({ id: String(p.id), name: String(p.name), position: Number(p.position) })),
        })),
        operations: operations.rows.map((o: Row) => ({
          id: String(o.id), code: String(o.code), name: String(o.name), lineId: String(o.line_id), phaseId: String(o.phase_id),
          position: Number(o.position), predecessorId: (o.predecessor_id as string) ?? null,
          location: o.location as 'interno' | 'externo', classification: (o.classification as string) ?? null,
          defaultWorkerId: (o.default_worker_id as string) ?? null, active: Boolean(o.active), extras: (o.extras as Row) ?? {},
        })),
        teams: teams.rows.map((t: Row) => ({
          id: String(t.id), name: String(t.name), status: t.status as 'aberto', shift: t.shift as 'integral',
          leaderId: (t.leader_id as string) ?? null, operationIds: teamOperationIds.get(String(t.id)) ?? [],
          members: members.rows.filter((m: Row) => m.team_id === t.id)
            .map((m: Row) => ({ workerId: String(m.worker_id), leaderId: (m.leader_id as string) ?? null })),
        })),
        workers: workers.rows.map((w: Row) => ({
          id: String(w.id), name: String(w.name), badge: String(w.badge), kind: String(w.kind), active: Boolean(w.active),
          userId: (w.user_id as string) ?? null, operationIds: workerOperationIds.get(String(w.id)) ?? [],
        })),
        workPeriods: periods.rows.map((p: Row) => ({ weekday: Number(p.weekday), startsAt: hhmm(p.starts_at), endsAt: hhmm(p.ends_at) })),
        holidays: holidays.rows.map((h: Row) => ({ day: String(h.day), name: String(h.name) })),
        lossReasons: reasons.rows.map((r: Row) => ({ id: String(r.id), name: String(r.name), active: Boolean(r.active) })),
      };
      return result(snapshot, 'postgres');
    },

    async saveLine(id: string | null, input: LineInput, actor: WriteActor) {
      return write(pool, async client => {
        let lineId = id;
        if (lineId) {
          const updated = await client.query(
            `update brsteel_pcp.production_lines set name = $2, monthly_capacity = $3, active = $4, updated_at = now()
             where id = $1 returning id`, [lineId, input.name, input.monthlyCapacity, input.active]);
          if (!updated.rowCount) throw missing('Linha');
        } else {
          lineId = (await client.query(
            `insert into brsteel_pcp.production_lines (name, monthly_capacity, active) values ($1, $2, $3) returning id`,
            [input.name, input.monthlyCapacity, input.active])).rows[0].id as string;
        }
        const existing = new Set((await client.query(
          'select id from brsteel_pcp.production_phases where line_id = $1 for update', [lineId])).rows.map((r: Row) => String(r.id)));
        const kept = new Set<string>();
        // A unicidade de (linha, posição) é verificada no commit, então a reordenação não colide no meio.
        for (const [position, phase] of input.phases.entries()) {
          if (phase.id) {
            if (!existing.has(phase.id)) throw missing('Fase');
            kept.add(phase.id);
            await client.query('update brsteel_pcp.production_phases set name = $2, position = $3, updated_at = now() where id = $1',
              [phase.id, phase.name, position]);
          } else {
            await client.query('insert into brsteel_pcp.production_phases (line_id, name, position) values ($1, $2, $3)',
              [lineId, phase.name, position]);
          }
        }
        const removed = [...existing].filter(phaseId => !kept.has(phaseId));
        if (removed.length) await client.query('delete from brsteel_pcp.production_phases where id = any($1)', [removed]);
        await audit(client, id ? 'pcp.updateLine' : 'pcp.createLine', actor, 'pcp.lines', lineId);
        return result({ id: lineId }, 'postgres');
      });
    },

    async saveOperation(id: string | null, input: OperationInput, actor: WriteActor) {
      return write(pool, async client => {
        // Travar todas as operações serializa edições concorrentes que poderiam fechar um ciclo juntas.
        const nodes = (await client.query(
          `select o.id, o.predecessor_id, p.line_id from brsteel_pcp.production_operations o
           join brsteel_pcp.production_phases p on p.id = o.phase_id for update of o`)).rows
          .map((r: Row) => ({ id: String(r.id), lineId: String(r.line_id), predecessorId: (r.predecessor_id as string) ?? null }));
        if (id && !nodes.some(node => node.id === id)) throw missing('Operação');
        const phase = (await client.query('select line_id from brsteel_pcp.production_phases where id = $1', [input.phaseId])).rows[0];
        if (!phase) throw missing('Fase');
        const operationId = id ?? (await client.query('select gen_random_uuid() as id')).rows[0].id as string;
        refuse(predecessorError(operationId, String(phase.line_id), input.predecessorId, nodes));
        const values = [operationId, input.code, input.name, input.phaseId, input.position, input.predecessorId,
          input.location, input.classification, input.defaultWorkerId, input.active];
        if (id) {
          await client.query(
            `update brsteel_pcp.production_operations set code = $2, name = $3, phase_id = $4, position = $5, predecessor_id = $6,
               location = $7, classification = $8, default_worker_id = $9, active = $10, updated_at = now() where id = $1`, values);
        } else {
          await client.query(
            `insert into brsteel_pcp.production_operations
               (id, code, name, phase_id, position, predecessor_id, location, classification, default_worker_id, active)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, values);
        }
        await audit(client, id ? 'pcp.updateOperation' : 'pcp.createOperation', actor, 'pcp.operations', operationId);
        return result({ id: operationId }, 'postgres');
      });
    },

    async saveTeam(id: string | null, input: TeamInput, actor: WriteActor) {
      return write(pool, async client => {
        const workers = (await client.query('select id, active from brsteel_pcp.workers for share')).rows as Row[];
        refuse(teamMembersError(input.members, input.leaderId,
          new Set(workers.filter(w => w.active).map(w => String(w.id))), new Set(workers.map(w => String(w.id)))));
        let teamId = id;
        if (teamId) {
          const updated = await client.query(
            `update brsteel_pcp.work_teams set name = $2, status = $3, shift = $4, leader_id = $5, updated_at = now()
             where id = $1 returning id`, [teamId, input.name, input.status, input.shift, input.leaderId]);
          if (!updated.rowCount) throw missing('Equipe');
        } else {
          teamId = (await client.query(
            'insert into brsteel_pcp.work_teams (name, status, shift, leader_id) values ($1, $2, $3, $4) returning id',
            [input.name, input.status, input.shift, input.leaderId])).rows[0].id as string;
        }
        // As chaves do organograma são verificadas no commit, então a lista pode ser regravada inteira.
        await client.query('delete from brsteel_pcp.work_team_members where team_id = $1', [teamId]);
        for (const member of input.members) {
          await client.query('insert into brsteel_pcp.work_team_members (team_id, worker_id, leader_id) values ($1, $2, $3)',
            [teamId, member.workerId, member.leaderId]);
        }
        await client.query('delete from brsteel_pcp.work_team_operations where team_id = $1', [teamId]);
        if (input.operationIds.length) {
          await client.query(
            'insert into brsteel_pcp.work_team_operations (team_id, operation_id) select $1, unnest($2::uuid[])',
            [teamId, input.operationIds]);
        }
        await audit(client, id ? 'pcp.updateTeam' : 'pcp.createTeam', actor, 'pcp.teams', teamId);
        return result({ id: teamId }, 'postgres');
      });
    },

    async saveWorker(id: string | null, input: WorkerInput, actor: WriteActor) {
      return write(pool, async client => {
        const workerId = id ?? (await client.query('select gen_random_uuid() as id')).rows[0].id as string;
        if (id) {
          const current = (await client.query('select active from brsteel_pcp.workers where id = $1 for update', [id])).rows[0];
          if (!current) throw missing('Funcionário');
          if (current.active && !input.active) {
            // Um líder ou superior inativo deixaria o organograma apontando para quem não pode aprovar.
            const leads = await client.query(
              `select 1 from brsteel_pcp.work_teams where leader_id = $1
               union all select 1 from brsteel_pcp.work_team_members where leader_id = $1 limit 1`, [id]);
            if (leads.rowCount) refuse('Troque este funcionário como líder ou superior antes de inativá-lo.');
          }
          await client.query(
            `update brsteel_pcp.workers set name = $2, badge = $3, kind = $4, active = $5, user_id = $6, updated_at = now() where id = $1`,
            [workerId, input.name, input.badge, input.kind, input.active, input.userId]);
        } else {
          await client.query(
            'insert into brsteel_pcp.workers (id, name, badge, kind, active, user_id) values ($1, $2, $3, $4, $5, $6)',
            [workerId, input.name, input.badge, input.kind, input.active, input.userId]);
        }
        await client.query('delete from brsteel_pcp.worker_operations where worker_id = $1', [workerId]);
        if (input.operationIds.length) {
          await client.query(
            'insert into brsteel_pcp.worker_operations (worker_id, operation_id) select $1, unnest($2::uuid[])',
            [workerId, input.operationIds]);
        }
        await audit(client, id ? 'pcp.updateWorker' : 'pcp.createWorker', actor, 'pcp.workers', workerId);
        return result({ id: workerId }, 'postgres');
      });
    },

    async replaceWorkPeriods(periods: WorkPeriodRow[], actor: WriteActor) {
      refuse(workPeriodsError(periods));
      return write(pool, async client => {
        await client.query('delete from brsteel_pcp.work_periods');
        for (const period of periods) {
          await client.query('insert into brsteel_pcp.work_periods (weekday, starts_at, ends_at) values ($1, $2, $3)',
            [period.weekday, period.startsAt, period.endsAt]);
        }
        await audit(client, 'pcp.replaceWorkPeriods', actor, 'pcp.workPeriods', 'all');
        return result(null, 'postgres');
      });
    },

    async saveHoliday(input: Holiday, actor: WriteActor) {
      return write(pool, async client => {
        await client.query(
          'insert into brsteel_pcp.holidays (day, name) values ($1, $2) on conflict (day) do update set name = excluded.name',
          [input.day, input.name]);
        await audit(client, 'pcp.saveHoliday', actor, 'pcp.holidays', input.day);
        return result(null, 'postgres');
      });
    },

    async deleteHoliday(day: string, actor: WriteActor) {
      return write(pool, async client => {
        if (!(await client.query('delete from brsteel_pcp.holidays where day = $1', [day])).rowCount) throw missing('Feriado');
        await audit(client, 'pcp.deleteHoliday', actor, 'pcp.holidays', day);
        return result(null, 'postgres');
      });
    },

    async saveLossReason(id: string | null, input: { name: string; active: boolean }, actor: WriteActor) {
      return write(pool, async client => {
        let reasonId = id;
        if (reasonId) {
          const updated = await client.query('update brsteel_pcp.loss_reasons set name = $2, active = $3 where id = $1 returning id',
            [reasonId, input.name, input.active]);
          if (!updated.rowCount) throw missing('Motivo');
        } else {
          reasonId = (await client.query('insert into brsteel_pcp.loss_reasons (name, active) values ($1, $2) returning id',
            [input.name, input.active])).rows[0].id as string;
        }
        await audit(client, id ? 'pcp.updateLossReason' : 'pcp.createLossReason', actor, 'pcp.lossReasons', reasonId);
        return result({ id: reasonId }, 'postgres');
      });
    },
  };
}
