import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import { NATIVE_RUN_ID } from '@/server/migration/operational-snapshot';
import { createPostgresEngineeringRepository } from '@/server/persistence/postgres-pcp-engineering';
import { createEngineeringOperations } from '@/server/operations/engineering';
import { pagePermissions } from '@/lib/permissions';
import type { AccessContext } from '@/server/access/types';
import type { WriteActor } from '@/server/persistence/write-audit';

const url = process.env.BRSTEEL_PG_LOCAL_URL;
assert.ok(url);
const pool = new Pool({ connectionString: url, max: 2 });
// O repositório roda com o papel de gravação, como em produção.
const writerPool = new Pool({ connectionString: url, max: 4, options: '-c role=brsteel_ops_writer' });
const repo = createPostgresEngineeringRepository(writerPool);
const actor: WriteActor = { userId: 'admin', source: 'web', clientId: null, idempotencyKey: null };
const ctx = (role: 'Administrador' | 'Operador'): AccessContext => ({
  actor: { userId: role, role, source: 'web' }, active: true, capabilities: ['producao:read', 'producao:write'],
  permissions: pagePermissions, inactivePages: [],
});

before(async () => {
  await pool.query('truncate brsteel_import.runs cascade');
  await pool.query('truncate brsteel_write.audit, brsteel_write.idempotency');
  await pool.query(`truncate brsteel_pcp.production_lines, brsteel_pcp.production_phases, brsteel_pcp.workers,
    brsteel_pcp.production_operations, brsteel_pcp.work_teams, brsteel_pcp.work_team_operations, brsteel_pcp.worker_operations,
    brsteel_pcp.work_periods, brsteel_pcp.holidays, brsteel_pcp.loss_reasons cascade`);
  await pool.query(`insert into brsteel_import.runs (id, source_project, captured_at, status, next_index, total_records, completed_at)
    values ($1, 'brsteel-native', '-infinity', 'complete', 0, 0, '-infinity')`, [NATIVE_RUN_ID]);
  await pool.query(`insert into brsteel_import.state (singleton, source_project, active_run, ready, captured_at, completed_at)
    values (true, 'demo-brsteel-auth', $1, true, now(), now())`, [NATIVE_RUN_ID]);
});
after(async () => { await writerPool.end(); await pool.end(); });

test('linha, operações com predecessora, equipe com líder e hierarquia de funcionários', async () => {
  const line = (await repo.saveLine(null, { name: 'Linha de produção', monthlyCapacity: 250, active: true,
    phases: [{ name: 'Corte' }, { name: 'Check Q/Q Corte' }, { name: 'Dobra' }] }, actor)).data.id;
  let snapshot = (await repo.read()).data;
  const [corte, checkCorte, dobra] = snapshot.lines[0].phases;
  assert.deepEqual(snapshot.lines[0].phases.map(p => p.name), ['Corte', 'Check Q/Q Corte', 'Dobra']);

  const base = { position: 0, location: 'interno' as const, classification: null, defaultWorkerId: null, active: true };
  const cortar = (await repo.saveOperation(null, { ...base, code: '01', name: 'Cortar', phaseId: corte.id, predecessorId: null }, actor)).data.id;
  const check = (await repo.saveOperation(null, { ...base, code: '07', name: 'Check Q/Q Corte', phaseId: checkCorte.id, predecessorId: cortar }, actor)).data.id;
  const dobrar = (await repo.saveOperation(null, { ...base, code: '02', name: 'Dobrar', phaseId: dobra.id, predecessorId: check }, actor)).data.id;

  // Ciclo: Cortar não pode depender de Dobrar, que já depende de Cortar pela cadeia.
  await assert.rejects(repo.saveOperation(cortar, { ...base, code: '01', name: 'Cortar', phaseId: corte.id, predecessorId: dobrar }, actor), /ciclo/);
  await assert.rejects(repo.saveOperation(null, { ...base, code: '01', name: 'Duplicada', phaseId: corte.id, predecessorId: null }, actor), /código/);

  // Reordenar fases troca posições sem colidir na unicidade (verificada no commit).
  await repo.saveLine(line, { name: 'Linha de produção', monthlyCapacity: 250, active: true,
    phases: [{ id: checkCorte.id, name: 'Check Q/Q Corte' }, { id: corte.id, name: 'Corte' }, { id: dobra.id, name: 'Dobra' }] }, actor);
  // Fase com operação não pode sair.
  await assert.rejects(repo.saveLine(line, { name: 'Linha de produção', monthlyCapacity: 250, active: true,
    phases: [{ id: corte.id, name: 'Corte' }, { id: checkCorte.id, name: 'Check Q/Q Corte' }] }, actor), /em uso/);

  const worker = (name: string, badge: string) => ({ name, badge, kind: 'Dobrador', active: true, userId: null, operationIds: [dobrar] });
  const lider = (await repo.saveWorker(null, worker('Líder', '009'), actor)).data.id;
  const membro = (await repo.saveWorker(null, worker('Membro', '010'), actor)).data.id;
  const outro = (await repo.saveWorker(null, worker('Outro', '011'), actor)).data.id;
  await assert.rejects(repo.saveWorker(null, worker('Duplicado', '009'), actor), /crachá/);

  const teamInput = (members: { workerId: string; leaderId: string | null }[], leaderId: string | null) =>
    ({ name: 'Dobra', status: 'aberto' as const, shift: 'integral' as const, leaderId, operationIds: [dobrar], members });
  // Organograma da Dobra no iApp: líder com dois subordinados.
  const team = (await repo.saveTeam(null, teamInput(
    [{ workerId: lider, leaderId: null }, { workerId: membro, leaderId: lider }, { workerId: outro, leaderId: lider }], lider), actor)).data.id;
  // O mesmo líder chefia outra equipe, como no iApp.
  await repo.saveTeam(null, { ...teamInput([{ workerId: lider, leaderId: null }], lider), name: 'Polimento' }, actor);
  await assert.rejects(repo.saveTeam(team, teamInput([{ workerId: membro, leaderId: null }], lider), actor), /membro da equipe/);
  await assert.rejects(repo.saveTeam(team, teamInput(
    [{ workerId: lider, leaderId: membro }, { workerId: membro, leaderId: lider }], null), actor), /ciclo/);
  await assert.rejects(repo.saveWorker(lider, { ...worker('Líder', '009'), active: false }, actor), /líder ou superior/);

  snapshot = (await repo.read()).data;
  assert.deepEqual(snapshot.lines[0].phases.map(p => p.name), ['Check Q/Q Corte', 'Corte', 'Dobra']);
  assert.equal(snapshot.operations.find(o => o.id === dobrar)?.predecessorId, check);
  const dobraTeam = snapshot.teams.find(t => t.id === team)!;
  assert.equal(dobraTeam.leaderId, lider);
  assert.deepEqual(dobraTeam.members.find(m => m.workerId === membro), { workerId: membro, leaderId: lider });
  assert.equal(snapshot.teams.length, 2);
  assert.deepEqual(snapshot.workers.find(w => w.id === membro)?.operationIds, [dobrar]);
  const audits = (await pool.query(`select count(*)::int as n from brsteel_write.audit where operation like 'pcp.%'`)).rows[0].n;
  assert.ok(audits >= 8);
});

test('expediente, feriados e motivos de perda', async () => {
  const day = (weekday: number) => [
    { weekday, startsAt: '07:45', endsAt: '12:00' }, { weekday, startsAt: '13:00', endsAt: '16:00' }, { weekday, startsAt: '16:15', endsAt: '17:30' },
  ];
  await repo.replaceWorkPeriods([1, 2, 3, 4, 5].flatMap(day), actor);
  await assert.rejects(repo.replaceWorkPeriods([{ weekday: 1, startsAt: '08:00', endsAt: '12:00' }, { weekday: 1, startsAt: '11:00', endsAt: '13:00' }], actor), /sobrepõem/);
  await repo.saveHoliday({ day: '2026-12-25', name: 'Natal' }, actor);
  const reason = (await repo.saveLossReason(null, { name: 'Dobra invertida', active: true }, actor)).data.id;
  await repo.saveLossReason(reason, { name: 'Dobra invertida', active: false }, actor);
  const snapshot = (await repo.read()).data;
  assert.equal(snapshot.workPeriods.length, 15);
  assert.deepEqual(snapshot.workPeriods[0], { weekday: 1, startsAt: '07:45', endsAt: '12:00' });
  assert.deepEqual(snapshot.holidays, [{ day: '2026-12-25', name: 'Natal' }]);
  assert.equal(snapshot.lossReasons[0].active, false);
  await repo.deleteHoliday('2026-12-25', actor);
  await assert.rejects(repo.deleteHoliday('2026-12-25', actor), /não encontrado/);
});

test('a página de engenharia é só do administrador', async () => {
  const ops = createEngineeringOperations(repo);
  await assert.rejects(ops.readEngineering(ctx('Operador')), /Sem permissão/);
  assert.ok((await ops.readEngineering(ctx('Administrador'))).data.lossReasons);
  await assert.rejects(ops.saveLossReason(ctx('Operador'), null, { name: 'X', active: true }), /Sem permissão|administradores/);
  const created = await ops.saveLossReason(ctx('Administrador'), null, { name: 'Peça riscada', active: true });
  assert.ok(created.data.id);
  await assert.rejects(ops.saveLossReason(ctx('Administrador'), null, { name: 'Y', active: true, extra: 1 }));
});
