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

test('a carga do iApp é idempotente e respeita o organograma', async () => {
  const { buildImportSql } = await import('../../scripts/pcp-import-iapp');
  const data = {
    line: { iappId: 900, name: 'Linha sintética', monthlyCapacity: 100, phases: ['Corte', 'Check Corte', 'Dobra'] },
    operations: [
      { iappId: 1, code: 'S01', name: 'Cortar', phase: 'Corte', position: 1, predecessorIappId: null, defaultWorkerIappId: 10, location: 'interno' as const, classification: 'BATELADAS' },
      { iappId: 2, code: 'S02', name: 'Check Corte', phase: 'Check Corte', position: 1, predecessorIappId: 1, defaultWorkerIappId: null, location: 'interno' as const, classification: null },
      { iappId: 3, code: 'S03', name: "Dobrar d'água", phase: 'Dobra', position: 2, predecessorIappId: 2, defaultWorkerIappId: 11, location: 'interno' as const, classification: null },
    ],
    workers: [
      { iappId: 10, name: 'Pessoa A', badge: 'S-001', kind: 'Cortador', active: true, operationIappIds: [1] },
      { iappId: 11, name: 'Pessoa B', badge: 'S-002', kind: 'Dobrador', active: true, operationIappIds: [3, 99] },
      { iappId: 12, name: 'Pessoa C', badge: 'S-003', kind: 'Dobrador', active: true, operationIappIds: [3] },
    ],
    teams: [
      { iappId: 50, name: 'Dobra sintética', status: 'aberto' as const, shift: 'integral' as const, leaderIappId: 11, operations: ["Dobrar d'água"],
        members: [{ workerIappId: 11, leaderIappId: null }, { workerIappId: 12, leaderIappId: 11 }] },
    ],
    workPeriods: [{ weekday: 1, startsAt: '07:45', endsAt: '12:00' }, { weekday: 1, startsAt: '13:00', endsAt: '17:30' }],
    sheets: [{ iappId: 700, code: 'S-0700', sku: 'SKU-S700', name: 'Produto sintético importado', status: 'aberto' as const, baseQuantity: 1,
      steps: [{ operationIappId: 1, predecessorOperationIappId: null, plannedMinutes: 8 }, { operationIappId: 3, predecessorOperationIappId: 1, plannedMinutes: null }],
      components: [{ sku: 'PARTE-1', name: 'Parte um', quantity: 2, operationIappId: 1 }] }],
  };
  const sql = buildImportSql(data);
  await pool.query(sql);
  await pool.query(sql);
  const counts = (await pool.query(`select
    (select count(*)::int from brsteel_pcp.workers where iapp_id in (10, 11, 12)) workers,
    (select count(*)::int from brsteel_pcp.production_operations where iapp_id in (1, 2, 3) and predecessor_id is not null) linked,
    (select count(*)::int from brsteel_pcp.worker_operations wo join brsteel_pcp.workers w on w.id = wo.worker_id where w.iapp_id = 11) b_ops,
    (select count(*)::int from brsteel_pcp.work_team_members m join brsteel_pcp.work_teams t on t.id = m.team_id where t.iapp_id = 50 and m.leader_id is not null) subordinates`)).rows[0];
  assert.deepEqual(counts, { workers: 3, linked: 2, b_ops: 1, subordinates: 1 });
  const sheet = (await pool.query(`select (select count(*)::int from brsteel_pcp.product_sheet_steps t where t.sheet_id = s.id) steps,
      (select count(*)::int from brsteel_pcp.product_sheet_steps t where t.sheet_id = s.id and t.predecessor_step_id is not null) linked,
      (select count(*)::int from brsteel_pcp.product_sheet_components c where c.sheet_id = s.id and c.step_id is not null) components
    from brsteel_pcp.product_sheets s where s.iapp_id = 700`)).rows[0];
  assert.deepEqual(sheet, { steps: 2, linked: 1, components: 1 });
  assert.throws(() => buildImportSql({ ...data, sheets: [{ ...data.sheets[0], steps: [{ operationIappId: 3, predecessorOperationIappId: 1, plannedMinutes: null }] }] }), /S-0700/);
  assert.throws(() => buildImportSql({ ...data, sheets: [{ ...data.sheets[0], sku: '' }] }), /sem código, SKU ou nome/);
  // Ciclo de predecessoras é recusado antes de gerar SQL.
  assert.throws(() => buildImportSql({ ...data, operations: data.operations.map(op => (op.iappId === 1 ? { ...op, predecessorIappId: 3 } : op)) }), /ciclo/);
  assert.throws(() => buildImportSql({ ...data, teams: [{ ...data.teams[0], leaderIappId: 10 }] }), /membro da equipe/);
});

test('ficha técnica: roteiro com predecessoras, componentes por passo e regravação', async () => {
  const snapshot = (await repo.read()).data;
  const op = (name: string) => snapshot.operations.find(o => o.name === name)!.id;
  const [cortar, check, dobrar] = [op('Cortar'), op('Check Q/Q Corte'), op('Dobrar')];
  const input = {
    code: 'F-0001', sku: 'SKU-SINTETICO', name: 'Produto sintético', status: 'aberto' as const, baseQuantity: 1, lineId: null,
    steps: [
      { operationId: cortar, predecessorOperationId: null, plannedMinutes: 8, notes: null },
      { operationId: check, predecessorOperationId: cortar, plannedMinutes: null, notes: 'Conferir a quantidade' },
      { operationId: dobrar, predecessorOperationId: check, plannedMinutes: 4.5, notes: null },
    ],
    components: [
      { componentSku: 'CHAPA-1', componentName: 'Chapa lateral', quantity: 2, operationId: cortar },
      { componentSku: 'CHAPA-2', componentName: null, quantity: 1, operationId: null },
    ],
  };
  const id = (await repo.saveSheet(null, input, actor)).data.id;
  let sheet = (await repo.getSheet(id)).data;
  assert.deepEqual(sheet.steps.map(s => s.predecessorOperationId), [null, cortar, check]);
  assert.equal(sheet.components.find(c => c.componentSku === 'CHAPA-1')?.operationId, cortar);

  // Regravar sem o Check: a predecessora do Dobrar precisa ser ajustada pelo cliente; o servidor recusa se não for.
  await assert.rejects(repo.saveSheet(id, { ...input, steps: [input.steps[0], input.steps[2]] }, actor), /no roteiro da ficha/);
  await repo.saveSheet(id, { ...input, steps: [input.steps[0], { ...input.steps[2], predecessorOperationId: cortar }],
    components: [input.components[0]] }, actor);
  sheet = (await repo.getSheet(id)).data;
  assert.deepEqual(sheet.steps.map(s => s.operationId), [cortar, dobrar]);
  assert.equal(sheet.components.length, 1);
  await assert.rejects(repo.saveSheet(null, { ...input, code: 'F-0001' }, actor), /código/);
  const list = (await repo.listSheets()).data;
  assert.deepEqual(list.find(s => s.id === id), { id, code: 'F-0001', sku: 'SKU-SINTETICO', name: 'Produto sintético', status: 'aberto', stepCount: 2, componentCount: 1 });
  // Operação usada em ficha não pode ser apagada.
  await assert.rejects(pool.query('delete from brsteel_pcp.production_operations where id = $1', [dobrar]), (e: { code?: string }) => e.code === '23503');
});

test('lote de OPs: roteiro vira OS, corte gera OPs das partes e a planilha do iApp leva só as OPs mães', async () => {
  const { createPostgresProductionOrderRepository } = await import('@/server/persistence/postgres-pcp-orders');
  const orders = createPostgresProductionOrderRepository(writerPool);
  const snapshot = (await repo.read()).data;
  const op = (name: string) => snapshot.operations.find(o => o.name === name)!.id;
  const step = (operationId: string, predecessorOperationId: string | null = null) => ({ operationId, predecessorOperationId, plannedMinutes: null, notes: null });
  const sheet = async (code: string, sku: string, steps: ReturnType<typeof step>[], components: { componentSku: string; quantity: number; operationId: string | null }[] = []) =>
    (await repo.saveSheet(null, { code, sku, name: sku, status: 'aberto', baseQuantity: 1, lineId: null, steps,
      components: components.map(c => ({ ...c, componentName: null })) }, actor)).data.id;
  // Produto com 3 passos sem predecessora definida: as OS herdam a ordem do roteiro.
  const product = await sheet('OP-0001', 'PROD-1', [step(op('Check Q/Q Corte')), step(op('Dobrar')), step(op('Check Corte'))],
    [{ componentSku: 'PARTE-1', quantity: 2, operationId: op('Check Q/Q Corte') }, { componentSku: 'SEM-FICHA', quantity: 1, operationId: null }]);
  await sheet('OP-0002', 'PARTE-1', [step(op('Cortar'))]);

  const range = { from: '2026-08-01', to: '2026-11-12' };
  const semanal = (await orders.createBatch({ kind: 'semanal', factor: 1.5, ...range,
    items: [{ sku: 'PROD-1', sheetId: product, quantity: 21, description: 'Produto' }] }, actor)).data;
  assert.deepEqual({ orderCount: semanal.orderCount, childCount: semanal.childCount }, { orderCount: 1, childCount: 0 });
  const corte = (await orders.createBatch({ kind: 'corte', factor: 2, ...range,
    items: [{ sku: 'PROD-1', sheetId: product, quantity: 5, description: 'Produto' }] }, actor)).data;
  assert.equal(corte.childCount, 1);

  const corteOrders = (await orders.listOrders(corte.batchId)).data;
  const child = corteOrders.find(o => o.parentOrderId)!;
  assert.deepEqual({ sku: child.sku, quantity: child.quantity, steps: child.stepCount }, { sku: 'PARTE-1', quantity: 10, steps: 1 });
  const parent = (await orders.listOrders(semanal.batchId)).data[0];
  const preds = (await pool.query(`select o.name, p.name as pred from brsteel_pcp.production_order_steps t
    join brsteel_pcp.production_operations o on o.id = t.operation_id
    left join brsteel_pcp.production_order_steps ps on ps.id = t.predecessor_step_id
    left join brsteel_pcp.production_operations p on p.id = ps.operation_id where t.order_id = $1 order by t.position`, [parent.id])).rows;
  assert.deepEqual(preds.map(r => r.pred), [null, 'Check Q/Q Corte', 'Dobrar']);

  const sheet2 = await orders.exportIapp(corte.batchId, actor);
  assert.deepEqual(sheet2.data.rows, [['OP-0001', 5, '', 'S', 'N']]);
  assert.ok((await orders.listBatches()).data.find(b => b.id === corte.batchId)?.exportedAt);
  await assert.rejects(orders.createBatch({ kind: 'semanal', factor: 1.5, ...range,
    items: [{ sku: 'OUTRO', sheetId: product, quantity: 1, description: null }] }, actor), /não é do SKU/);
  // Números sequenciais e únicos.
  const numbers = (await orders.listOrders(null)).data.map(o => o.number);
  assert.equal(new Set(numbers).size, numbers.length);
});
