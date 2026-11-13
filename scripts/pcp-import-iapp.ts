/**
 * Carga inicial dos cadastros de engenharia do PCP a partir de uma exportação do iApp.
 *
 * Uso:
 *   BRSTEEL_PCP_IMPORT_URL=postgresql://... node --import tsx scripts/pcp-import-iapp.ts \
 *     --file /caminho/privado/cadastros.json --confirm-host <host do banco>
 *
 * - O arquivo traz nomes de funcionários: fica fora do repositório (que é público).
 * - `--confirm-host` precisa repetir o host da URL. Assim o destino é sempre explícito.
 * - É idempotente: casa os registros pelo `iapp_id` e regrava o expediente. Roda numa transação só.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { predecessorError, teamMembersError, workPeriodsError } from '../src/lib/pcp/engineering-rules';

type Export = {
  line: { iappId: number; name: string; monthlyCapacity: number; phases: string[] };
  operations: { iappId: number; code: string; name: string; phase: string; position: number; predecessorIappId: number | null;
    defaultWorkerIappId: number | null; location: 'interno' | 'externo'; classification: string | null }[];
  workers: { iappId: number; name: string; badge: string; kind: string; active: boolean; operationIappIds: number[] }[];
  teams: { iappId: number; name: string; status: 'aberto' | 'inativo' | 'fechado'; shift: 'manha' | 'tarde' | 'noite' | 'integral';
    leaderIappId: number | null; operations: string[]; members: { workerIappId: number; leaderIappId: number | null }[] }[];
  workPeriods: { weekday: number; startsAt: string; endsAt: string }[];
};

const { values } = parseArgs({ options: { file: { type: 'string' }, 'confirm-host': { type: 'string' } } });
const url = process.env.BRSTEEL_PCP_IMPORT_URL;
if (!values.file || !values['confirm-host'] || !url) {
  console.error('Informe --file, --confirm-host e a variável BRSTEEL_PCP_IMPORT_URL.');
  process.exit(2);
}
const target = new URL(url);
if (target.hostname !== values['confirm-host']) {
  console.error(`O host da URL (${target.hostname}) não confere com --confirm-host. Nada foi gravado.`);
  process.exit(2);
}
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(target.hostname);
const data = JSON.parse(readFileSync(values.file, 'utf8')) as Export;

const fail = (message: string | null) => { if (message) throw new Error(message); };

async function run() {
  const client = new pg.Client({ connectionString: url, ...(loopback ? {} : { ssl: { rejectUnauthorized: true } }) });
  await client.connect();
  try {
    await client.query('begin');
    const upsert = async (sql: string, params: unknown[]) => String((await client.query(sql, params)).rows[0].id);

    const lineId = await upsert(
      `insert into brsteel_pcp.production_lines (iapp_id, name, monthly_capacity) values ($1, $2, $3)
       on conflict (iapp_id) do update set name = excluded.name, monthly_capacity = excluded.monthly_capacity, updated_at = now()
       returning id`, [data.line.iappId, data.line.name, data.line.monthlyCapacity]);
    const phaseIds = new Map<string, string>();
    for (const [position, name] of data.line.phases.entries()) {
      phaseIds.set(name, await upsert(
        `insert into brsteel_pcp.production_phases (line_id, name, position) values ($1, $2, $3)
         on conflict (line_id, name) do update set position = excluded.position, updated_at = now() returning id`,
        [lineId, name, position]));
    }

    const workerIds = new Map<number, string>();
    for (const w of data.workers) {
      workerIds.set(w.iappId, await upsert(
        `insert into brsteel_pcp.workers (iapp_id, name, badge, kind, active) values ($1, $2, $3, $4, $5)
         on conflict (iapp_id) do update set name = excluded.name, badge = excluded.badge, kind = excluded.kind,
           active = excluded.active, updated_at = now() returning id`, [w.iappId, w.name, w.badge, w.kind, w.active]));
    }

    // Primeiro as operações sem predecessora; depois as ligações, já validadas contra ciclos.
    const operationIds = new Map<number, string>();
    for (const op of data.operations) {
      const phaseId = phaseIds.get(op.phase);
      if (!phaseId) throw new Error(`Fase desconhecida: ${op.phase}`);
      operationIds.set(op.iappId, await upsert(
        `insert into brsteel_pcp.production_operations (iapp_id, code, name, phase_id, position, location, classification, default_worker_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (iapp_id) do update set code = excluded.code, name = excluded.name, phase_id = excluded.phase_id,
           position = excluded.position, location = excluded.location, classification = excluded.classification,
           default_worker_id = excluded.default_worker_id, predecessor_id = null, updated_at = now() returning id`,
        [op.iappId, op.code, op.name, phaseId, op.position, op.location, op.classification,
          op.defaultWorkerIappId ? workerIds.get(op.defaultWorkerIappId) ?? null : null]));
    }
    const nodes = data.operations.map(op => ({ id: operationIds.get(op.iappId)!, lineId, predecessorId: null as string | null }));
    for (const op of data.operations) {
      if (!op.predecessorIappId) continue;
      const id = operationIds.get(op.iappId)!, predecessorId = operationIds.get(op.predecessorIappId) ?? null;
      fail(predecessorError(id, lineId, predecessorId, nodes));
      nodes.find(n => n.id === id)!.predecessorId = predecessorId;
      await client.query('update brsteel_pcp.production_operations set predecessor_id = $2 where id = $1', [id, predecessorId]);
    }

    const byName = new Map(data.operations.map(op => [op.name, operationIds.get(op.iappId)!]));
    for (const w of data.workers) {
      const id = workerIds.get(w.iappId)!;
      await client.query('delete from brsteel_pcp.worker_operations where worker_id = $1', [id]);
      for (const opIappId of w.operationIappIds) {
        const operationId = operationIds.get(opIappId);
        if (operationId) await client.query('insert into brsteel_pcp.worker_operations (worker_id, operation_id) values ($1, $2)', [id, operationId]);
      }
    }

    const active = new Set(data.workers.filter(w => w.active).map(w => workerIds.get(w.iappId)!));
    const known = new Set(workerIds.values());
    for (const t of data.teams) {
      const members = t.members.map(m => ({ workerId: workerIds.get(m.workerIappId)!, leaderId: m.leaderIappId ? workerIds.get(m.leaderIappId) ?? null : null }));
      const leaderId = t.leaderIappId ? workerIds.get(t.leaderIappId) ?? null : null;
      fail(teamMembersError(members, leaderId, active, known));
      const teamId = await upsert(
        `insert into brsteel_pcp.work_teams (iapp_id, name, status, shift, leader_id) values ($1, $2, $3, $4, $5)
         on conflict (iapp_id) do update set name = excluded.name, status = excluded.status, shift = excluded.shift,
           leader_id = excluded.leader_id, updated_at = now() returning id`, [t.iappId, t.name, t.status, t.shift, leaderId]);
      await client.query('delete from brsteel_pcp.work_team_members where team_id = $1', [teamId]);
      for (const m of members) {
        await client.query('insert into brsteel_pcp.work_team_members (team_id, worker_id, leader_id) values ($1, $2, $3)', [teamId, m.workerId, m.leaderId]);
      }
      await client.query('delete from brsteel_pcp.work_team_operations where team_id = $1', [teamId]);
      for (const name of t.operations) {
        const operationId = byName.get(name);
        if (operationId) await client.query('insert into brsteel_pcp.work_team_operations (team_id, operation_id) values ($1, $2)', [teamId, operationId]);
      }
    }

    fail(workPeriodsError(data.workPeriods));
    await client.query('delete from brsteel_pcp.work_periods');
    for (const p of data.workPeriods) {
      await client.query('insert into brsteel_pcp.work_periods (weekday, starts_at, ends_at) values ($1, $2, $3)', [p.weekday, p.startsAt, p.endsAt]);
    }

    await client.query(
      `insert into brsteel_write.audit (id, operation, user_id, source, target_collection, target_id)
       values (gen_random_uuid()::text, 'pcp.importIapp', 'script', 'web', 'pcp', $1)`, [data.line.name]);
    await client.query('commit');
    console.log(JSON.stringify({ phases: phaseIds.size, operations: operationIds.size, workers: workerIds.size, teams: data.teams.length,
      workPeriods: data.workPeriods.length }));
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    // A mensagem do driver pode trazer valores; mostramos só o código e o texto próprio.
    const code = (error as { code?: string }).code;
    console.error(code ? `Falha no banco (${code}). Nada foi gravado.` : `${(error as Error).message} Nada foi gravado.`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void run();
