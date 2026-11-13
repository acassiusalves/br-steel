/**
 * Carga inicial dos cadastros de engenharia do PCP a partir de uma exportação do iApp.
 *
 * O script valida a exportação com as mesmas regras da aplicação e gera um SQL único, transacional e
 * idempotente (casa os registros pelo `iapp_id`). Duas formas de aplicar:
 *
 *   # 1. Gerar o arquivo e aplicar pelo Supabase CLI vinculado ao projeto (sem senha do banco):
 *   node --import tsx scripts/pcp-import-iapp.ts --file /privado/cadastros.json --emit-sql /privado/carga.sql
 *   supabase db query --workdir <dir vinculado> --linked -f /privado/carga.sql
 *
 *   # 2. Aplicar direto por uma URL (banco local da suíte, por exemplo):
 *   BRSTEEL_PCP_IMPORT_URL=postgresql://... node --import tsx scripts/pcp-import-iapp.ts \
 *     --file /privado/cadastros.json --confirm-host <host do banco>
 *
 * A exportação e o SQL gerado trazem nomes de funcionários: ficam fora do repositório, que é público.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { predecessorError, sheetError, teamMembersError, workPeriodsError } from '../src/lib/pcp/engineering-rules';

export type IappEngineeringExport = {
  line: { iappId: number; name: string; monthlyCapacity: number; phases: string[] };
  operations: { iappId: number; code: string; name: string; phase: string; position: number; predecessorIappId: number | null;
    defaultWorkerIappId: number | null; location: 'interno' | 'externo'; classification: string | null }[];
  workers: { iappId: number; name: string; badge: string; kind: string; active: boolean; operationIappIds: number[] }[];
  teams: { iappId: number; name: string; status: 'aberto' | 'inativo' | 'fechado'; shift: 'manha' | 'tarde' | 'noite' | 'integral';
    leaderIappId: number | null; operations: string[]; members: { workerIappId: number; leaderIappId: number | null }[] }[];
  workPeriods: { weekday: number; startsAt: string; endsAt: string }[];
  /** Fichas técnicas. Opcional: a carga dos cadastros pode rodar antes das fichas. */
  sheets?: {
    iappId: number; code: string; sku: string; name: string; status: SheetStatus; baseQuantity: number;
    steps: { operationIappId: number; predecessorOperationIappId: number | null; plannedMinutes: number | null }[];
    components: { sku: string; name: string | null; quantity: number; operationIappId: number | null }[];
  }[];
};

const SHEET_STATUSES = ['aberto', 'aberto_avulso', 'bloqueado', 'suspenso', 'versao_revisada', 'fechado', 'amostra'] as const;
type SheetStatus = typeof SHEET_STATUSES[number];

const fail = (message: string | null) => { if (message) throw new Error(message); };
const lit = (value: string | null) => (value === null ? 'null' : `'${value.replaceAll("'", "''")}'`);
const int = (value: number | null) => {
  if (value === null) return 'null';
  if (!Number.isSafeInteger(value)) throw new Error(`Número inválido na exportação: ${value}`);
  return String(value);
};
const time = (value: string) => { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`Horário inválido: ${value}`); return lit(value); };
const enumOf = <T extends string>(value: T, allowed: readonly T[]) => { if (!allowed.includes(value)) throw new Error(`Valor inválido: ${value}`); return lit(value); };

/** Valida com as regras da aplicação, usando os IDs do iApp como identificadores. */
export function validateExport(data: IappEngineeringExport): void {
  const phases = new Set(data.line.phases);
  if (phases.size !== data.line.phases.length) throw new Error('Fases repetidas na exportação.');
  const opIds = new Set(data.operations.map(op => op.iappId));
  const workerIds = new Set(data.workers.map(w => String(w.iappId)));
  for (const op of data.operations) {
    if (!phases.has(op.phase)) throw new Error(`Fase desconhecida: ${op.phase}`);
    if (op.predecessorIappId && !opIds.has(op.predecessorIappId)) throw new Error(`Predecessora fora da exportação: ${op.predecessorIappId}`);
  }
  const nodes = data.operations.map(op => ({ id: String(op.iappId), lineId: 'linha', predecessorId: op.predecessorIappId ? String(op.predecessorIappId) : null }));
  for (const node of nodes) {
    fail(predecessorError(node.id, 'linha', node.predecessorId, nodes.map(n => (n.id === node.id ? { ...n, predecessorId: null } : n))));
  }
  const active = new Set(data.workers.filter(w => w.active).map(w => String(w.iappId)));
  for (const team of data.teams) {
    fail(teamMembersError(team.members.map(m => ({ workerId: String(m.workerIappId), leaderId: m.leaderIappId ? String(m.leaderIappId) : null })),
      team.leaderIappId ? String(team.leaderIappId) : null, active, workerIds));
  }
  fail(workPeriodsError(data.workPeriods));
  const opKeys = new Set([...opIds].map(String));
  const codes = new Set<string>();
  for (const sheet of data.sheets ?? []) {
    // O iApp tem fichas sem produto vinculado: sem SKU a ficha não serve para gerar OP e o banco recusa.
    if (!sheet.code?.trim() || !sheet.sku?.trim() || !sheet.name?.trim()) throw new Error(`Ficha sem código, SKU ou nome: ${sheet.code || sheet.iappId}`);
    if (codes.has(sheet.code)) throw new Error(`Ficha repetida: ${sheet.code}`);
    codes.add(sheet.code);
    const message = sheetError(
      sheet.steps.map(t => ({ operationId: String(t.operationIappId), predecessorOperationId: t.predecessorOperationIappId ? String(t.predecessorOperationIappId) : null })),
      sheet.components.map(c => ({ componentSku: c.sku, quantity: c.quantity, operationId: c.operationIappId ? String(c.operationIappId) : null })),
      opKeys);
    if (message) throw new Error(`Ficha ${sheet.code}: ${message}`);
  }
}

const num = (value: number | null) => {
  if (value === null) return 'null';
  if (!Number.isFinite(value) || value < 0) throw new Error(`Quantidade inválida na exportação: ${value}`);
  return String(value);
};

/** SQL único e idempotente. As referências entre tabelas são resolvidas pelo `iapp_id`. */
export function buildImportSql(data: IappEngineeringExport): string {
  validateExport(data);
  const s = 'brsteel_pcp';
  const line = int(data.line.iappId);
  const worker = (id: number | null) => (id === null ? 'null' : `(select id from ${s}.workers where iapp_id = ${int(id)})`);
  const operation = (id: number) => `(select id from ${s}.production_operations where iapp_id = ${int(id)})`;
  const team = (id: number) => `(select id from ${s}.work_teams where iapp_id = ${int(id)})`;
  const out: string[] = ['begin;'];

  out.push(`insert into ${s}.production_lines (iapp_id, name, monthly_capacity) values (${line}, ${lit(data.line.name)}, ${int(data.line.monthlyCapacity)})
  on conflict (iapp_id) do update set name = excluded.name, monthly_capacity = excluded.monthly_capacity, updated_at = now();`);
  data.line.phases.forEach((phase, position) => out.push(
    `insert into ${s}.production_phases (line_id, name, position) select id, ${lit(phase)}, ${position} from ${s}.production_lines where iapp_id = ${line}
  on conflict (line_id, name) do update set position = excluded.position, updated_at = now();`));

  for (const w of data.workers) {
    out.push(`insert into ${s}.workers (iapp_id, name, badge, kind, active) values (${int(w.iappId)}, ${lit(w.name)}, ${lit(w.badge)}, ${lit(w.kind)}, ${w.active})
  on conflict (iapp_id) do update set name = excluded.name, badge = excluded.badge, kind = excluded.kind, active = excluded.active, updated_at = now();`);
  }

  // Primeiro as operações sem predecessora; depois as ligações (a exportação já foi validada contra ciclos).
  for (const op of data.operations) {
    out.push(`insert into ${s}.production_operations (iapp_id, code, name, phase_id, position, location, classification, default_worker_id)
  select ${int(op.iappId)}, ${lit(op.code)}, ${lit(op.name)}, p.id, ${int(op.position)}, ${enumOf(op.location, ['interno', 'externo'] as const)}, ${lit(op.classification)}, ${worker(op.defaultWorkerIappId)}
  from ${s}.production_phases p join ${s}.production_lines l on l.id = p.line_id where l.iapp_id = ${line} and p.name = ${lit(op.phase)}
  on conflict (iapp_id) do update set code = excluded.code, name = excluded.name, phase_id = excluded.phase_id, position = excluded.position,
    location = excluded.location, classification = excluded.classification, default_worker_id = excluded.default_worker_id,
    predecessor_id = null, updated_at = now();`);
  }
  for (const op of data.operations.filter(o => o.predecessorIappId)) {
    out.push(`update ${s}.production_operations set predecessor_id = ${operation(op.predecessorIappId!)} where iapp_id = ${int(op.iappId)};`);
  }

  for (const w of data.workers) {
    out.push(`delete from ${s}.worker_operations where worker_id = ${worker(w.iappId)};`);
    for (const opId of w.operationIappIds.filter(id => data.operations.some(op => op.iappId === id))) {
      out.push(`insert into ${s}.worker_operations (worker_id, operation_id) values (${worker(w.iappId)}, ${operation(opId)});`);
    }
  }

  const byName = new Map(data.operations.map(op => [op.name, op.iappId]));
  for (const t of data.teams) {
    out.push(`insert into ${s}.work_teams (iapp_id, name, status, shift, leader_id)
  values (${int(t.iappId)}, ${lit(t.name)}, ${enumOf(t.status, ['aberto', 'inativo', 'fechado'] as const)}, ${enumOf(t.shift, ['manha', 'tarde', 'noite', 'integral'] as const)}, ${worker(t.leaderIappId)})
  on conflict (iapp_id) do update set name = excluded.name, status = excluded.status, shift = excluded.shift, leader_id = excluded.leader_id, updated_at = now();`);
    // As chaves do organograma são verificadas no commit, então a lista é regravada inteira.
    out.push(`delete from ${s}.work_team_members where team_id = ${team(t.iappId)};`);
    for (const m of t.members) {
      out.push(`insert into ${s}.work_team_members (team_id, worker_id, leader_id) values (${team(t.iappId)}, ${worker(m.workerIappId)}, ${worker(m.leaderIappId)});`);
    }
    out.push(`delete from ${s}.work_team_operations where team_id = ${team(t.iappId)};`);
    for (const name of t.operations.filter(n => byName.has(n))) {
      out.push(`insert into ${s}.work_team_operations (team_id, operation_id) values (${team(t.iappId)}, ${operation(byName.get(name)!)});`);
    }
  }

  out.push(`delete from ${s}.work_periods;`);
  for (const p of data.workPeriods) {
    out.push(`insert into ${s}.work_periods (weekday, starts_at, ends_at) values (${int(p.weekday)}, ${time(p.startsAt)}, ${time(p.endsAt)});`);
  }
  for (const sheet of data.sheets ?? []) {
    const id = int(sheet.iappId);
    const sheetRef = `(select id from ${s}.product_sheets where iapp_id = ${id})`;
    const step = (opId: number) => `(select t.id from ${s}.product_sheet_steps t where t.sheet_id = ${sheetRef} and t.operation_id = ${operation(opId)})`;
    out.push(`insert into ${s}.product_sheets (iapp_id, code, sku, name, status, base_quantity, line_id)
  values (${id}, ${lit(sheet.code)}, ${lit(sheet.sku)}, ${lit(sheet.name)}, ${enumOf(sheet.status, SHEET_STATUSES)}, ${num(sheet.baseQuantity)},
    (select id from ${s}.production_lines where iapp_id = ${line}))
  on conflict (iapp_id) do update set code = excluded.code, sku = excluded.sku, name = excluded.name, status = excluded.status,
    base_quantity = excluded.base_quantity, line_id = excluded.line_id, updated_at = now();`);
    out.push(`delete from ${s}.product_sheet_components where sheet_id = ${sheetRef};`);
    out.push(`delete from ${s}.product_sheet_steps where sheet_id = ${sheetRef};`);
    sheet.steps.forEach((t, position) => out.push(
      `insert into ${s}.product_sheet_steps (sheet_id, operation_id, position, planned_minutes) values (${sheetRef}, ${operation(t.operationIappId)}, ${position}, ${num(t.plannedMinutes)});`));
    for (const t of sheet.steps.filter(x => x.predecessorOperationIappId)) {
      out.push(`update ${s}.product_sheet_steps set predecessor_step_id = ${step(t.predecessorOperationIappId!)} where id = ${step(t.operationIappId)};`);
    }
    for (const c of sheet.components) {
      out.push(`insert into ${s}.product_sheet_components (sheet_id, step_id, component_sku, component_name, quantity)
  values (${sheetRef}, ${c.operationIappId ? step(c.operationIappId) : 'null'}, ${lit(c.sku)}, ${lit(c.name)}, ${num(c.quantity)});`);
    }
  }

  out.push(`insert into brsteel_write.audit (id, operation, user_id, source, target_collection, target_id)
  values (gen_random_uuid()::text, 'pcp.importIapp', 'script', 'web', 'pcp', ${lit(data.line.name)});`);
  out.push('commit;');
  return out.join('\n');
}

async function main() {
  const { values } = parseArgs({ options: { file: { type: 'string' }, 'emit-sql': { type: 'string' }, 'confirm-host': { type: 'string' } } });
  if (!values.file) { console.error('Informe --file.'); process.exit(2); }
  const data = JSON.parse(readFileSync(values.file, 'utf8')) as IappEngineeringExport;
  let sql: string;
  try { sql = buildImportSql(data); } catch (error) { console.error(`${(error as Error).message} Nada foi gerado.`); process.exit(1); }
  const summary = JSON.stringify({ phases: data.line.phases.length, operations: data.operations.length, workers: data.workers.length,
    teams: data.teams.length, workPeriods: data.workPeriods.length, sheets: data.sheets?.length ?? 0 });

  if (values['emit-sql']) {
    writeFileSync(values['emit-sql'], sql, { mode: 0o600, flag: 'wx' });
    console.log(`SQL gerado em ${values['emit-sql']}: ${summary}`);
    return;
  }
  const url = process.env.BRSTEEL_PCP_IMPORT_URL;
  if (!url || !values['confirm-host']) { console.error('Informe --emit-sql, ou --confirm-host com a variável BRSTEEL_PCP_IMPORT_URL.'); process.exit(2); }
  const target = new URL(url);
  if (target.hostname !== values['confirm-host']) {
    console.error(`O host da URL (${target.hostname}) não confere com --confirm-host. Nada foi gravado.`);
    process.exit(2);
  }
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(target.hostname);
  const client = new pg.Client({ connectionString: url, ...(loopback ? {} : { ssl: { rejectUnauthorized: true } }) });
  await client.connect();
  try {
    await client.query(sql);
    console.log(summary);
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    // A mensagem do driver pode trazer valores; mostramos só o código.
    console.error(`Falha no banco (${(error as { code?: string }).code ?? 'sem código'}). Nada foi gravado.`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith('pcp-import-iapp.ts')) void main();
