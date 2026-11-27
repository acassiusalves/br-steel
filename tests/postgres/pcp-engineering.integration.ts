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
    brsteel_pcp.work_periods, brsteel_pcp.holidays, brsteel_pcp.loss_reasons, brsteel_pcp.bling_products,
    brsteel_pcp.sales_invoices, brsteel_pcp.sales_invoice_items, brsteel_pcp.sales_item_products cascade`);
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
  // Depois da primeira carga, status e crachá de quem tem login ficam com o BR Steel.
  await pool.query(`update brsteel_pcp.workers set active = false where iapp_id = 10`);
  await pool.query(`update brsteel_pcp.workers set user_id = 'cracha-s-002' where iapp_id = 11`);
  await pool.query(buildImportSql({ ...data, workers: data.workers.map(w => ({ ...w, badge: `${w.badge}-N` })) }));
  const kept = (await pool.query(`select iapp_id, badge, active from brsteel_pcp.workers where iapp_id in (10, 11, 12) order by iapp_id`)).rows;
  assert.deepEqual(kept, [
    { iapp_id: '10', badge: 'S-001-N', active: false },
    { iapp_id: '11', badge: 'S-002', active: true },
    { iapp_id: '12', badge: 'S-003-N', active: true },
  ]);
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

test('Kanban de OPs: líder move, membro executa, perda reduz a quantidade e o card chega a Concluído', async () => {
  const { createPostgresProductionOrderRepository } = await import('@/server/persistence/postgres-pcp-orders');
  const { createPostgresKanbanRepository } = await import('@/server/persistence/postgres-pcp-kanban');
  const kanban = createPostgresKanbanRepository(writerPool);
  const snapshot = (await repo.read()).data;
  const op = (name: string) => snapshot.operations.find(o => o.name === name)!;
  const [check, dobrar] = [op('Check Q/Q Corte'), op('Dobrar')];
  const worker = async (name: string, badge: string, userId: string | null, operationIds: string[]) =>
    (await repo.saveWorker(null, { name, badge, kind: 'Kanban', active: true, userId, operationIds }, actor)).data.id;
  const lider = await worker('Líder K', 'K-01', 'u-lider', [check.id, dobrar.id]);
  const dobrador = await worker('Dobrador K', 'K-02', null, [dobrar.id]);
  await repo.saveTeam(null, { name: 'Equipe K', status: 'aberto', shift: 'integral', leaderId: lider, operationIds: [check.id, dobrar.id],
    members: [{ workerId: lider, leaderId: null }, { workerId: dobrador, leaderId: lider }] }, actor);
  const reason = (await repo.saveLossReason(null, { name: 'Peça amassada', active: true }, actor)).data.id;
  const sheetId = (await repo.saveSheet(null, { code: 'K-0001', sku: 'SKU-K', name: 'Produto K', status: 'aberto', baseQuantity: 1, lineId: null,
    steps: [check, dobrar].map(o => ({ operationId: o.id, predecessorOperationId: null, plannedMinutes: null, notes: null })), components: [] }, actor)).data.id;
  const batch = (await createPostgresProductionOrderRepository(writerPool).createBatch({ kind: 'semanal', factor: 1.5, from: '2026-08-01', to: '2026-11-12',
    items: [{ sku: 'SKU-K', sheetId, quantity: 10, description: 'Produto K' }] }, actor)).data;
  const orderId = (await pool.query('select id from brsteel_pcp.production_orders where batch_id = $1', [batch.batchId])).rows[0].id as string;

  const asLider = { userId: 'u-lider', source: 'web' as const, clientId: null, idempotencyKey: null, isAdmin: false };
  const outsider = { ...asLider, userId: 'ninguem' };
  const card = async () => (await kanban.board(asLider)).data.cards.find(c => c.id === orderId)!;

  let c = await card();
  assert.equal(c.column, 'a_produzir');
  assert.equal(c.allowed.moveTo, check.phaseId);
  await assert.rejects(kanban.move(orderId, check.phaseId, outsider), /líder/);
  await kanban.move(orderId, check.phaseId, asLider);
  c = await card();
  assert.equal(c.column, check.phaseId);
  const checkStep = c.allowed.start!.stepId;
  assert.ok(c.allowed.start!.workers.some(w => w.id === lider));
  await kanban.start(orderId, checkStep, lider, asLider);
  await assert.rejects(kanban.move(orderId, dobrar.phaseId, asLider), /Finalize/);
  await assert.rejects(kanban.finish(orderId, checkStep, { lossQuantity: 0, lossReasonId: null, notes: null }, outsider), /Só quem iniciou/);
  await assert.rejects(kanban.finish(orderId, checkStep, { lossQuantity: 1, lossReasonId: null, notes: null }, asLider), /motivo/);
  await kanban.finish(orderId, checkStep, { lossQuantity: 1, lossReasonId: reason, notes: 'Uma peça veio amassada do corte' }, asLider);
  c = await card();
  assert.equal(c.currentQuantity, 9);
  assert.deepEqual(c.losses.map(l => l.reason), ['Peça amassada']);

  // Coluna de operação: o líder bipa o crachá do dobrador, que não tem login, e a OS já começa.
  assert.equal((await kanban.board(asLider)).data.columns.find(col => col.key === dobrar.phaseId)?.asksBadge, true);
  assert.equal((await kanban.board(asLider)).data.columns.find(col => col.key === check.phaseId)?.asksBadge, false);
  await assert.rejects(kanban.move(orderId, dobrar.phaseId, asLider), /crachá/);
  await assert.rejects(kanban.move(orderId, dobrar.phaseId, asLider, 'K-99'), /Crachá não encontrado/);
  c = await card();
  assert.equal(c.column, check.phaseId);
  await kanban.move(orderId, dobrar.phaseId, asLider, ' k-02 ');
  c = await card();
  const dobraStep = c.steps[1].id;
  assert.deepEqual([c.column, c.steps[1].status, c.steps[1].workerName], [dobrar.phaseId, 'em_execucao', 'Dobrador K']);

  // Pausa: o tempo parado vira espera; finalizar pausada fecha a pausa.
  assert.equal(c.allowed.pauseStepId, dobraStep);
  await assert.rejects(kanban.pause(orderId, dobraStep, outsider), /pausá-la/);
  await kanban.pause(orderId, dobraStep, asLider);
  await assert.rejects(kanban.pause(orderId, dobraStep, asLider), /já está pausada/);
  c = await card();
  assert.ok(c.steps[1].pausedSince);
  assert.deepEqual([c.allowed.pauseStepId, c.allowed.resumeStepId], [null, dobraStep]);
  await kanban.resume(orderId, dobraStep, asLider);
  assert.equal((await card()).steps[1].pausedSince, null);
  await kanban.pause(orderId, dobraStep, asLider);
  await kanban.finish(orderId, dobraStep, { lossQuantity: 0, lossReasonId: null, notes: null }, asLider);
  assert.equal(Number((await pool.query('select count(*) from brsteel_pcp.production_order_step_pauses where step_id = $1 and resumed_at is null', [dobraStep])).rows[0].count), 0);
  c = await card();
  assert.equal(c.allowed.moveTo, 'concluido');
  await kanban.move(orderId, 'concluido', asLider);
  c = await card();
  assert.equal(c.column, 'concluido');
  assert.deepEqual(c.steps.map(s => [s.status, s.workerName]), [['executada', 'Líder K'], ['executada', 'Dobrador K']]);
  const kinds = (await pool.query('select kind from brsteel_pcp.production_order_events where order_id = $1 order by created_at, kind', [orderId])).rows.map(r => r.kind);
  assert.deepEqual(kinds, ['move', 'start', 'finish', 'loss', 'move', 'start', 'pause', 'resume', 'pause', 'finish', 'move']);

  // Tempos úteis com horários fixos, sobre o expediente da fábrica (o teste da carga regrava o expediente).
  await repo.replaceWorkPeriods([1, 2, 3, 4, 5].flatMap(weekday => [
    { weekday, startsAt: '07:45', endsAt: '12:00' }, { weekday, startsAt: '13:00', endsAt: '16:00' }, { weekday, startsAt: '16:15', endsAt: '17:30' },
  ]), actor);
  const [first, second] = c.steps;
  await pool.query(`update brsteel_pcp.production_order_steps set started_at = $2, finished_at = $3 where id = $1`,
    [first.id, '2026-11-04T10:19:00-03:00', '2026-11-04T15:38:00-03:00']);
  await pool.query(`update brsteel_pcp.production_order_steps set started_at = $2, finished_at = $3 where id = $1`,
    [second.id, '2026-11-04T16:30:00-03:00', '2026-11-05T08:00:00-03:00']);
  // Uma pausa de 20 minutos úteis no meio da dobra: sai da execução e entra na espera.
  await pool.query('delete from brsteel_pcp.production_order_step_pauses where step_id = $1', [second.id]);
  await pool.query(`insert into brsteel_pcp.production_order_step_pauses (order_id, step_id, paused_at, resumed_at, paused_by, resumed_by)
    values ($1, $2, '2026-11-04T16:40:00-03:00', '2026-11-04T17:00:00-03:00', 'u-lider', 'u-lider')`, [orderId, second.id]);
  c = await card();
  assert.deepEqual(c.steps.map(s => [s.waitMinutes, s.runMinutes, s.pausedMinutes]), [[null, 259, 0], [37, 55, 20]]);
  assert.deepEqual(c.totals, { runMinutes: 314, waitMinutes: 57 });

  // Excluir: só o administrador, só em "A produzir"; a OP vira "encerrado" e sai do quadro.
  const extra = (await createPostgresProductionOrderRepository(writerPool).createBatch({ kind: 'semanal', factor: 1.5, from: '2026-08-01', to: '2026-11-12',
    items: [{ sku: 'SKU-K', sheetId, quantity: 4, description: 'Produto K' }] }, actor)).data;
  const extraId = (await pool.query('select id from brsteel_pcp.production_orders where batch_id = $1', [extra.batchId])).rows[0].id as string;
  const asAdmin = { ...asLider, userId: 'admin', isAdmin: true };
  assert.equal((await card()).allowed.close, false);
  assert.equal((await kanban.board(asLider)).data.cards.find(x => x.id === extraId)!.allowed.close, false);
  assert.equal((await kanban.board(asAdmin)).data.cards.find(x => x.id === extraId)!.allowed.close, true);
  await assert.rejects(kanban.close(extraId, asLider), /administrador/);
  await assert.rejects(kanban.close(orderId, asAdmin), /A produzir/);
  await kanban.close(extraId, asAdmin);
  assert.equal((await pool.query('select status from brsteel_pcp.production_orders where id = $1', [extraId])).rows[0].status, 'encerrado');
  assert.equal((await kanban.board(asAdmin)).data.cards.some(x => x.id === extraId), false);
  assert.deepEqual((await pool.query('select kind from brsteel_pcp.production_order_events where order_id = $1', [extraId])).rows.map(r => r.kind), ['close']);
  // A planilha do iApp do lote não leva a OP excluída.
  assert.equal((await createPostgresProductionOrderRepository(writerPool).exportIapp(extra.batchId, actor)).data.rows.length, 0);
});

test('gerador de OP: cadastro copiado do Bling, saldo do depósito Estoque, faixa da fila e média semanal com margem', async () => {
  const { createPostgresProductionOrderRepository } = await import('@/server/persistence/postgres-pcp-orders');
  const { weeksInRange } = await import('@/lib/pcp/invoice-demand');
  // Vendas das NF-e no período: a calha vende o dobro da porta-utensílios.
  const invoices = { async demand() { return { items: [{ sku: 'PTU200200150', cfop: '5102', quantity: 120 }, { sku: 'CNUL440205140IN', cfop: '5102', quantity: 240 }],
    kits: new Map(), pendingInvoices: 0, listedAt: new Date() }; } };
  // Bling falso: só a linha oficial interessa; o saldo é o do depósito Estoque (não o total).
  const calls: string[] = [];
  const bling = {
    async products(skus: readonly string[]) {
      calls.push(`products:${skus.length}`);
      return [
        { sku: 'PTU200200150', blingId: 101, name: 'PORTA UTENSILIOS', format: 'S', stockMin: 30, stockMax: 64 },
        { sku: 'CNUL440205140IN', blingId: 102, name: 'CALHA UMIDA 440', format: 'S', stockMin: 40, stockMax: 80 },
        { sku: 'CBA600400350', blingId: 103, name: 'CUBA 600x400x350', format: 'S', stockMin: 15, stockMax: 30 },
        { sku: 'TMPCLH440230', blingId: 104, name: 'TAMPA 440', format: 'S', stockMin: null, stockMax: null },
        { sku: 'KIT50OSSOME', blingId: 105, name: 'KIT 50', format: 'E', stockMin: 1, stockMax: 2 },
      ];
    },
    async estoqueBalances(ids: readonly number[]) { calls.push(`balances:${ids.length}`); return new Map([[101, 0], [102, 0], [103, 31], [104, 23]]); },
  };
  const orders = createPostgresProductionOrderRepository(writerPool, bling, invoices);
  const range = { from: '2026-08-19', to: '2026-11-10' };
  const weeks = weeksInRange(range.from, range.to);
  const synced = (await orders.syncBlingCatalog(actor)).data;
  assert.equal(synced.synced, 5);
  assert.equal(synced.missing.length, 66);
  // Uma leitura com mais de uma hora é refeita pelo próprio cálculo; dentro da hora, reaproveitada.
  await pool.query("update brsteel_pcp.bling_products set synced_at = now() - interval '2 hours'");

  const snapshot = (await repo.read()).data;
  const op = (name: string) => snapshot.operations.find(o => o.name === name)!.id;
  const step = (operationId: string) => ({ operationId, predecessorOperationId: null, plannedMinutes: null, notes: null });
  const ptuSheet = (await repo.saveSheet(null, { code: 'MM-0001', sku: 'PTU200200150', name: 'Porta utensílios', status: 'aberto', baseQuantity: 1,
    lineId: null, steps: [step(op('Dobrar'))], components: [] }, actor)).data.id;
  const cnulSheet = (await repo.saveSheet(null, { code: 'MM-0002', sku: 'CNUL440205140IN', name: 'Calha 440', status: 'aberto', baseQuantity: 1,
    lineId: null, steps: [step(op('Dobrar'))], components: [] }, actor)).data.id;
  // Já há 20 calhas em OP semanal aberta: entram na posição (saldo + em OP), que ainda fica abaixo do mínimo.
  await orders.createBatch({ kind: 'semanal', factor: 1, ...range, items: [{ sku: 'CNUL440205140IN', sheetId: cnulSheet, quantity: 20, description: null }] }, actor);

  const semanal = (await orders.preview({ kind: 'semanal', factor: 1, ...range }, actor)).data;
  // Os dois estão zerados: o mais vendido vem primeiro, e a quantidade é a média semanal.
  assert.deepEqual(semanal.suggestions.map(s => [s.sku, s.tier, s.quantity, s.openQuantity]),
    [['CNUL440205140IN', 'zerado', Math.ceil(240 / weeks), 20], ['PTU200200150', 'zerado', Math.ceil(120 / weeks), 0]]);
  assert.equal(semanal.suggestions.find(s => s.sku === 'PTU200200150')?.sheet?.id, ptuSheet);
  assert.ok(semanal.warnings.some(w => w.includes('sem estoque mínimo e máximo') && w.includes('TMPCLH440230')));
  assert.ok(semanal.warnings.some(w => w.includes('Kits fora da fila') && w.includes('KIT50OSSOME')));
  assert.ok(semanal.warnings.some(w => w.includes('66 SKU(s) da linha oficial')));
  // Sem venda é informação, não aviso: vai para as notas, que a tela mostra só nos detalhes.
  assert.ok(Array.isArray(semanal.notes));
  assert.ok(!semanal.warnings.some(w => w.startsWith('Sem venda')));
  assert.deepEqual(calls.filter(c => c.startsWith('balances')), ['balances:5']);
  assert.deepEqual(calls.filter(c => c.startsWith('products')), ['products:71', 'products:71']);

  // No corte, a margem do pulmão vale sobre a média semanal (a OP semanal aberta não conta para o corte).
  const corte = (await orders.preview({ kind: 'corte', factor: 1.47, ...range }, actor)).data;
  assert.deepEqual(corte.suggestions.map(s => [s.sku, s.quantity]),
    [['CNUL440205140IN', Math.ceil(240 / weeks * 1.47 - 1e-9)], ['PTU200200150', Math.ceil(120 / weeks * 1.47 - 1e-9)]]);

  // Quem só consulta não relê o cadastro: usa a última leitura, com aviso.
  await pool.query("update brsteel_pcp.bling_products set synced_at = now() - interval '2 hours'");
  const readOnly = (await orders.preview({ kind: 'semanal', factor: 1, ...range }, null)).data;
  assert.equal(readOnly.suggestions.length, 2);
  assert.ok(readOnly.warnings.some(w => w.includes('última leitura do Bling')));
  assert.deepEqual(calls.filter(c => c.startsWith('products')), ['products:71', 'products:71']);
  // Releitura que falha: segue com a leitura anterior, com aviso, e não tenta de novo logo em seguida.
  let failures = 0;
  const flaky = createPostgresProductionOrderRepository(writerPool, { ...bling, async products() { failures++; throw new Error('timeout'); } });
  const stale = (await flaky.preview({ kind: 'semanal', factor: 1, ...range }, actor)).data;
  assert.ok(stale.warnings.some(w => w.includes('não foi possível reler agora')));
  await flaky.preview({ kind: 'semanal', factor: 1, ...range }, actor);
  assert.equal(failures, 1);
  await pool.query("update brsteel_pcp.bling_products set synced_at = now()");

  // Bling fora do ar: a prévia não inventa saldo.
  const offline = createPostgresProductionOrderRepository(writerPool, { ...bling, async estoqueBalances() { throw new Error('timeout'); } });
  await assert.rejects(offline.preview({ kind: 'semanal', factor: 1, ...range }, actor), /saldo do depósito Estoque/);
  assert.deepEqual(calls.filter(c => c.startsWith('products')), ['products:71', 'products:71']);
  const audit = (await pool.query("select count(*)::int as n from brsteel_write.audit where operation = 'pcp.syncBlingCatalog'")).rows[0].n;
  assert.equal(audit, 2);
});

test('vendidos das NF-e de saída: pendente conta, cancelada não, só CFOP de venda e kit explodido só quando aparece na nota', async () => {
  const { createPostgresSalesInvoices } = await import('@/server/persistence/postgres-sales-invoices');
  const { createPostgresProductionOrderRepository } = await import('@/server/persistence/postgres-pcp-orders');
  await pool.query(`insert into brsteel_pcp.bling_products (sku, bling_id, name, format, stock_min, stock_max) values
    ('GPTOALHA', 201, 'GANCHO PORTA TOALHA', 'S', 10, 20), ('CNUL440205140IN', 102, 'CALHA UMIDA 440', 'S', 40, 80),
    ('TMPCLH440230', 104, 'TAMPA 440', 'S', null, null)
    on conflict (sku) do update set bling_id = excluded.bling_id, stock_min = excluded.stock_min, stock_max = excluded.stock_max, synced_at = now()`);
  type Header = { blingId: number; number: string; situation: number; issuedAt: string };
  const notes = new Map<number, Header & { items: { sku: string; quantity: number; cfop: string | null }[] }>([
    // Pendente: conta. O kit veio com o próprio código e é explodido; o item fora da linha não conta.
    [1, { blingId: 1, number: '000001', situation: 1, issuedAt: '2026-11-05T10:00:00-03:00', items: [
      { sku: 'GPTOALHA', quantity: 4, cfop: '6102' }, { sku: 'CLHLINCOMTAM440INOX', quantity: 3, cfop: '6102' }, { sku: 'LCO21250', quantity: 9, cfop: '6102' }] }],
    // Último minuto do período no horário de Brasília; a remessa (5915) não é venda.
    [2, { blingId: 2, number: '000002', situation: 5, issuedAt: '2026-11-10T23:30:00-03:00', items: [
      { sku: 'GPTOALHA', quantity: 10, cfop: '5102' }, { sku: 'GPTOALHA', quantity: 7, cfop: '5915' }] }],
    // Já é o dia seguinte em Brasília: fora do período.
    [3, { blingId: 3, number: '000003', situation: 5, issuedAt: '2026-11-11T00:10:00-03:00', items: [{ sku: 'GPTOALHA', quantity: 100, cfop: '6102' }] }],
    [4, { blingId: 4, number: '000004', situation: 2, issuedAt: '2026-11-06T09:00:00-03:00', items: [{ sku: 'GPTOALHA', quantity: 50, cfop: '6102' }] }],
    // O detalhe desta falha: fica pendente para a próxima execução.
    [5, { blingId: 5, number: '000005', situation: 5, issuedAt: '2026-11-07T09:00:00-03:00', items: [] }],
  ]);
  const calls: string[] = [];
  const reader = {
    async listOutgoing(input: { from: string; to: string; page: number; cancelled: boolean }) {
      calls.push(`list:${input.cancelled ? 'canceladas' : 'demais'}:${input.page}:${input.from}..${input.to}`);
      return [...notes.values()].filter(n => (n.situation === 2) === input.cancelled).map(n => ({ blingId: n.blingId, number: n.number, situation: n.situation, issuedAt: n.issuedAt }));
    },
    async invoice(id: number) {
      calls.push(`nota:${id}`);
      if (id === 5) throw new Error('timeout');
      return notes.get(id)!;
    },
    async productsByCode(codes: readonly string[]) {
      calls.push(`produtos:${codes.join(',')}`);
      return [{ sku: 'CLHLINCOMTAM440INOX', blingId: 900, format: 'E' }, { sku: 'LCO21250', blingId: 901, format: 'S' }];
    },
    async kitStructure(id: number) { calls.push(`kit:${id}`); return [{ blingId: 102, quantity: 1 }, { blingId: 104, quantity: 1 }]; },
  };
  const invoices = createPostgresSalesInvoices(writerPool, reader);
  const now = () => Date.parse('2026-11-12T12:00:00-03:00');
  // Nota que sumiu das listagens do Bling há mais de duas horas: foi excluída lá.
  await pool.query(`insert into brsteel_pcp.sales_invoices (bling_id, number, situation, issued_at, items_situation, listed_at)
    values (99, '000099', 1, '2026-11-06T10:00:00-03:00', 1, '2026-11-12T08:00:00-03:00')`);
  await pool.query(`insert into brsteel_pcp.sales_invoice_items (invoice_id, position, sku, quantity, cfop) values (99, 0, 'GPTOALHA', 1000, '6102')`);

  const first = (await invoices.sync(actor, { now })).data;
  assert.deepEqual(first, { listed: 5, fetched: 3, failed: 1, pending: 1, removed: 1, codesChecked: 2 });
  assert.deepEqual(calls.slice(0, 2), ['list:demais:1:2026-07-15..2026-11-13', 'list:canceladas:1:2026-07-15..2026-11-13']);
  // A cancelada não tem os itens lidos; as demais, da mais recente para a mais antiga.
  assert.deepEqual(calls.filter(c => c.startsWith('nota:')), ['nota:3', 'nota:2', 'nota:5', 'nota:1']);
  assert.deepEqual(calls.filter(c => c.startsWith('produtos') || c.startsWith('kit')), ['produtos:CLHLINCOMTAM440INOX,LCO21250', 'kit:900']);

  const bling = {
    async products(): Promise<never> { throw new Error('o cadastro está fresco, não deve ser relido'); },
    async estoqueBalances() { return new Map([[201, 0], [102, 0], [104, 0]]); },
  };
  const orders = createPostgresProductionOrderRepository(writerPool, bling, invoices);
  const range = { from: '2026-11-01', to: '2026-11-10' };
  let preview = (await orders.preview({ kind: 'semanal', factor: 1, ...range }, actor)).data;
  const sold = (sku: string) => preview.suggestions.find(s => s.sku === sku);
  assert.equal(sold('GPTOALHA')?.sold, 14);
  assert.equal(sold('GPTOALHA')?.weeklyAverage, 14 / (10 / 7));
  assert.equal(sold('CNUL440205140IN')?.sold, 3);
  assert.ok(preview.warnings.some(w => w.startsWith('1 nota(s) do período ainda sem itens')));

  // A pendente foi autorizada (itens relidos), a 2 foi cancelada e a 5 voltou a responder.
  notes.set(1, { ...notes.get(1)!, situation: 5 });
  notes.set(2, { ...notes.get(2)!, situation: 2 });
  notes.set(5, { ...notes.get(5)!, items: [{ sku: 'GPTOALHA', quantity: 2, cfop: '6102' }] });
  reader.invoice = async (id: number) => { calls.push(`nota:${id}`); return notes.get(id)!; };
  calls.length = 0;
  const second = (await invoices.sync(actor, { now: () => now() + 900_000 })).data;
  assert.deepEqual(second, { listed: 5, fetched: 2, failed: 0, pending: 0, removed: 0, codesChecked: 0 });
  assert.deepEqual(calls.filter(c => c.startsWith('nota:')), ['nota:5', 'nota:1']);
  preview = (await orders.preview({ kind: 'semanal', factor: 1, ...range }, actor)).data;
  assert.equal(sold('GPTOALHA')?.sold, 6);
  assert.ok(!preview.warnings.some(w => w.includes('sem itens copiados')));

  // Bling fora do ar na listagem: não grava nada.
  const offline = createPostgresSalesInvoices(writerPool, { ...reader, async listOutgoing() { throw new Error('timeout'); } });
  await assert.rejects(offline.sync(actor, { now }), /listar as notas fiscais/);
  const audit = (await pool.query("select count(*)::int as n from brsteel_write.audit where operation = 'pcp.syncSalesInvoices'")).rows[0].n;
  assert.equal(audit, 2);
});

test('OP avulsa, OP de pedido do Bling e urgência no quadro', async () => {
  const { createPostgresProductionOrderRepository } = await import('@/server/persistence/postgres-pcp-orders');
  const { createPostgresKanbanRepository } = await import('@/server/persistence/postgres-pcp-kanban');
  const { createProductionOrderOperations } = await import('@/server/operations/production-orders');
  const snapshot = (await repo.read()).data;
  const op = (name: string) => snapshot.operations.find(o => o.name === name)!.id;
  const step = (operationId: string) => ({ operationId, predecessorOperationId: null, plannedMinutes: null, notes: null });
  const sheet = async (code: string, sku: string, steps: string[], components: { componentSku: string; quantity: number }[] = []) =>
    (await repo.saveSheet(null, { code, sku, name: `Produto ${sku}`, status: 'aberto', baseQuantity: 1, lineId: null, steps: steps.map(step),
      components: components.map(c => ({ ...c, componentName: null, operationId: null })) }, actor)).data.id;
  // Cuba sintética: 2 partes com ficha própria (vão para o corte) e uma matéria-prima sem ficha.
  const cuba = await sheet('PV-0001', 'CUBA-P', [op('Check Q/Q Corte'), op('Dobrar')], [{ componentSku: 'PARTE-P', quantity: 2 }, { componentSku: 'MP-P', quantity: 1 }]);
  const parte = await sheet('PV-0002', 'PARTE-P', [op('Cortar')]);

  // Pedido sintético no formato do leitor do Bling: a cuba direto, um kit com mais 2 cubas e um item de revenda.
  let offline = false;
  const salesOrders = {
    async findByNumber(number: string) {
      if (offline) throw new Error('timeout');
      return number === '900' ? [{ blingId: 42, number: '900', storeNumber: 'LOJA-1', date: '2026-11-15', customerName: 'Cliente Teste' }] : [];
    },
    async order(blingId: number) {
      if (offline) throw new Error('timeout');
      return { blingId, number: '900', storeNumber: 'LOJA-1', date: '2026-11-15', customerName: 'Cliente Teste', items: [
        { sku: 'CUBA-P', description: 'Cuba', quantity: 3, productBlingId: 6 },
        { sku: 'KIT-P', description: 'Kit', quantity: 1, productBlingId: 7 },
        { sku: 'REVENDA-P', description: 'Revenda', quantity: 1, productBlingId: 9 }] };
    },
    async product(blingId: number) {
      if (blingId === 7) return { blingId, sku: 'KIT-P', name: 'Kit', format: 'E', components: [{ blingId: 8, quantity: 2 }] };
      if (blingId === 8) return { blingId, sku: 'CUBA-P', name: 'Cuba', format: 'S', components: [] };
      if (blingId === 9) return { blingId, sku: 'REVENDA-P', name: 'Revenda', format: 'S', components: [] };
      return null;
    },
  };
  const orders = createPostgresProductionOrderRepository(writerPool, undefined, undefined, salesOrders);

  // OP avulsa: na produção semanal, sem partes; no corte, com as partes.
  const products = (await orders.listProducible()).data;
  assert.deepEqual(products.find(p => p.sku === 'CUBA-P'), { sku: 'CUBA-P', name: 'Produto CUBA-P', sheetId: cuba, sheetCode: 'PV-0001', stepCount: 2, partCount: 1 });
  const manual = (await orders.createManualOrder({ kind: 'semanal', sku: 'CUBA-P', sheetId: cuba, quantity: 4, urgent: true, notes: 'Reposição de vitrine' }, actor)).data;
  assert.equal(manual.childCount, 0);
  const manualRow = (await pool.query('select origin, priority, notes, bling_order_id from brsteel_pcp.production_orders where number = $1', [manual.number])).rows[0];
  assert.deepEqual(manualRow, { origin: 'avulsa', priority: 'urgente', notes: 'Reposição de vitrine', bling_order_id: null });
  const manualCut = (await orders.createManualOrder({ kind: 'corte', sku: 'CUBA-P', sheetId: cuba, quantity: 3, urgent: false, notes: null }, actor)).data;
  assert.equal(manualCut.childCount, 1);
  assert.deepEqual((await orders.listOrders(manualCut.batchId)).data.map(o => [o.sku, o.kind, o.quantity, o.origin]).sort(),
    [['CUBA-P', 'corte', 3, 'avulsa'], ['PARTE-P', 'corte', 6, 'avulsa']]);
  await assert.rejects(orders.createManualOrder({ kind: 'semanal', sku: 'OUTRO', sheetId: cuba, quantity: 1, urgent: false, notes: null }, actor), /não é do SKU/);
  assert.equal((await pool.query("select count(*)::int n from brsteel_write.audit where operation = 'pcp.createManualOrder'")).rows[0].n, 2);

  // Prévia do pedido: a cuba soma o item e o kit; a revenda não tem ficha.
  const preview = (await orders.previewSalesOrder('900')).data;
  assert.equal(preview.order.number, '900');
  assert.deepEqual(preview.lines.map(l => [l.sku, l.quantity, l.sheet?.id ?? null]), [['CUBA-P', 5, cuba], ['REVENDA-P', 1, null]]);
  assert.deepEqual(preview.lines[0].parts.map(p => [p.sku, p.quantity, p.sheet.id]), [['PARTE-P', 10, parte]]);
  assert.deepEqual(preview.lines[0].materials, ['MP-P']);
  assert.match(preview.warnings.join(' '), /REVENDA-P/);
  assert.deepEqual(preview.existing, []);
  await assert.rejects(orders.previewSalesOrder('901'), (e: { code?: string }) => e.code === 'NOT_FOUND');

  const input = { blingOrderId: 42, urgent: true, confirmDuplicate: false,
    items: [{ sku: 'CUBA-P', sheetId: cuba, quantity: 5, description: 'Cuba', parts: [{ sku: 'PARTE-P', sheetId: parte, quantity: 10, description: null }] }] };
  // Item fora do pedido ou parte que não é da ficha: recusado.
  await assert.rejects(orders.createFromSalesOrder({ ...input, items: [{ ...input.items[0], sku: 'REVENDA-P' }] }, actor), (e: { code?: string }) => e.code === 'INVALID_INPUT');
  await assert.rejects(orders.createFromSalesOrder({ ...input, items: [{ ...input.items[0], parts: [{ sku: 'MP-P', sheetId: parte, quantity: 1, description: null }] }] }, actor),
    (e: { code?: string }) => e.code === 'INVALID_INPUT');

  const fromOrder = (await orders.createFromSalesOrder(input, actor)).data;
  assert.deepEqual({ ...fromOrder, batchId: undefined }, { batchId: undefined, orderCount: 1, childCount: 1, salesOrderNumber: '900' });
  const rows = (await pool.query(`select o.sku, o.kind, o.quantity::float8 quantity, o.origin, o.priority, o.bling_order_id::text bling_id, o.bling_order_number,
      (select m.sku from brsteel_pcp.production_orders m where m.id = o.parent_order_id) parent
    from brsteel_pcp.production_orders o where o.batch_id = $1 order by o.number`, [fromOrder.batchId])).rows;
  assert.deepEqual(rows, [
    { sku: 'CUBA-P', kind: 'semanal', quantity: 5, origin: 'pedido', priority: 'urgente', bling_id: '42', bling_order_number: '900', parent: null },
    { sku: 'PARTE-P', kind: 'corte', quantity: 10, origin: 'pedido', priority: 'urgente', bling_id: '42', bling_order_number: '900', parent: 'CUBA-P' },
  ]);
  const batch = (await orders.listBatches()).data.find(b => b.id === fromOrder.batchId)!;
  assert.deepEqual({ origin: batch.origin, number: batch.salesOrderNumber, kind: batch.kind }, { origin: 'pedido', number: '900', kind: 'semanal' });
  // Na planilha do iApp, a OP do pedido com partes vai com multinível "S".
  assert.deepEqual((await orders.exportIapp(fromOrder.batchId, actor)).data.rows, [['PV-0001', 5, '', 'S', 'N']]);

  // O mesmo pedido de novo pede confirmação.
  assert.deepEqual((await orders.previewSalesOrder('900')).data.existing.map(e => e.sku), ['CUBA-P', 'PARTE-P']);
  await assert.rejects(orders.createFromSalesOrder(input, actor), (e: { code?: string }) => e.code === 'DUPLICATE_SALES_ORDER');
  const again = (await orders.createFromSalesOrder({ ...input, urgent: false, confirmDuplicate: true, items: [{ ...input.items[0], parts: [] }] }, actor)).data;
  assert.equal(again.childCount, 0);

  // Bling fora do ar: nada é gravado.
  const before = (await pool.query('select count(*)::int n from brsteel_pcp.production_orders')).rows[0].n;
  offline = true;
  await assert.rejects(orders.previewSalesOrder('900'), (e: { code?: string }) => e.code === 'BLING_UNAVAILABLE');
  await assert.rejects(orders.createFromSalesOrder({ ...input, confirmDuplicate: true }, actor), (e: { code?: string }) => e.code === 'BLING_UNAVAILABLE');
  assert.equal((await pool.query('select count(*)::int n from brsteel_pcp.production_orders')).rows[0].n, before);
  offline = false;

  // Pedido sem número do Bling não passa pela constraint.
  await assert.rejects(pool.query(`insert into brsteel_pcp.production_orders (kind, sku, quantity, created_by, origin) values ('semanal', 'X', 1, 'teste', 'pedido')`),
    (e: { code?: string }) => e.code === '23514');

  // Sem permissão de gravação: não gera nem consulta o Bling.
  const ops = createProductionOrderOperations(orders);
  const readOnly: AccessContext = { ...ctx('Operador'), capabilities: ['producao:read'] };
  await assert.rejects(ops.createManualOrder(readOnly, { kind: 'semanal', sku: 'CUBA-P', sheetId: cuba, quantity: 1 }), /Sem permissão/);
  await assert.rejects(ops.previewSalesOrder(readOnly, { number: '900' }), /Sem permissão/);
  await assert.rejects(ops.previewSalesOrder(ctx('Operador'), { number: '900; drop' }), /inválido/);

  // Quadro: os urgentes vêm primeiro; o card mostra o pedido e a OP mãe.
  const kanban = createPostgresKanbanRepository(writerPool);
  const asAdmin = { userId: 'admin', source: 'web' as const, clientId: null, idempotencyKey: null, isAdmin: true };
  const asLider = { ...asAdmin, userId: 'u-lider', isAdmin: false };
  let board = (await kanban.board(asAdmin)).data;
  const todo = board.cards.filter(c => c.column === 'a_produzir');
  const firstNormal = todo.findIndex(c => !c.urgent);
  assert.ok(firstNormal > 0 && todo.slice(firstNormal).every(c => !c.urgent), 'urgentes no topo da coluna');
  const mother = board.cards.find(c => c.salesOrderNumber === '900' && c.sku === 'CUBA-P' && c.urgent)!;
  const part = board.cards.find(c => c.sku === 'PARTE-P' && c.salesOrderNumber === '900')!;
  assert.deepEqual({ origin: mother.origin, parent: part.parentNumber, setUrgent: mother.allowed.setUrgent }, { origin: 'pedido', parent: mother.number, setUrgent: true });

  // Só o administrador muda a urgência; a parte acompanha a OP mãe.
  await assert.rejects(kanban.setPriority(mother.id, false, asLider), /administrador/);
  await kanban.setPriority(mother.id, false, asAdmin);
  board = (await kanban.board(asAdmin)).data;
  assert.deepEqual([mother.id, part.id].map(id => board.cards.find(c => c.id === id)!.urgent), [false, false]);
  const events = (await pool.query(`select payload from brsteel_pcp.production_order_events where kind = 'priority' and order_id = any($1) order by created_at`,
    [[mother.id, part.id]])).rows.map(r => r.payload);
  assert.deepEqual(events.map(p => [p.from, p.to, Boolean(p.parentOrderId)]).sort(), [['urgente', 'estoque', false], ['urgente', 'estoque', true]]);
  assert.equal((await pool.query("select count(*)::int n from brsteel_write.audit where operation = 'pcp.setOrderPriority'")).rows[0].n, 2);
});

test('crachá só no formato que o login e a bipagem leem: maiúsculas, sem espaço, zeros à esquerda mantidos', async () => {
  const insert = (badge: string) => pool.query(`insert into brsteel_pcp.workers (name, badge, kind, active) values ('Teste crachá', $1, 'Teste', true)`, [badge]);
  for (const badge of ['ab-1', ' 012', '12 34', 'x'.repeat(41)]) {
    await assert.rejects(insert(badge), (e: { code?: string }) => e.code === '23514', badge);
  }
  // Pelo repositório, a recusa da restrição chega como mensagem própria, sem o texto do driver.
  await assert.rejects(repo.saveWorker(null, { name: 'Teste crachá', badge: 'ab-1', kind: 'Teste', active: true, userId: null, operationIds: [] }, actor),
    /Crachá inválido/);
  await insert('012');
  await assert.rejects(insert('012'), (e: { code?: string }) => e.code === '23505');
  await pool.query(`delete from brsteel_pcp.workers where name = 'Teste crachá'`);
});

test('vínculo do login: só grava em funcionário sem login e com o mesmo crachá; formulário sem login não desfaz o vínculo', async () => {
  const input = { name: 'Vínculo', badge: 'VINC-1', kind: 'Teste', active: true, userId: null, operationIds: [] };
  const id = (await repo.saveWorker(null, input, actor)).data.id;
  await assert.rejects(repo.linkWorkerUser(id, 'cracha-vinc-2', 'VINC-2', actor), /mudou/);
  await repo.linkWorkerUser(id, 'cracha-vinc-1', 'VINC-1', actor);
  await assert.rejects(repo.linkWorkerUser(id, 'cracha-vinc-1', 'VINC-1', actor), /mudou/);
  const { userId: _omit, ...withoutLogin } = { ...input, kind: 'Supervisor' };
  void _omit;
  await repo.saveWorker(id, withoutLogin, actor);
  const row = (await pool.query('select user_id, kind from brsteel_pcp.workers where id = $1', [id])).rows[0];
  assert.deepEqual(row, { user_id: 'cracha-vinc-1', kind: 'Supervisor' });
  await repo.saveWorker(id, { ...withoutLogin, userId: null }, actor);
  assert.equal((await pool.query('select user_id from brsteel_pcp.workers where id = $1', [id])).rows[0].user_id, null);
  assert.equal((await pool.query("select count(*)::int n from brsteel_write.audit where operation = 'pcp.linkWorkerUser' and target_id = $1", [id])).rows[0].n, 1);
});

test('fila por categoria reproduz quantidades e protege a confirmação do lote', async () => {
  const { createPostgresProductionOrderRepository } = await import('@/server/persistence/postgres-pcp-orders');
  const product = (sku: string, blingId: number, extra = {}) => ({
    sku, blingId, name: sku, format: 'S', stockMin: 7, stockMax: 40, active: true,
    categoryId: '702', structureStockType: null, hasStructure: true, ...extra,
  });
  const bling = {
    async products() { return []; },
    async estoqueBalances() { return new Map(); },
    async categories() { return [{ id: 701, descricao: 'Produtos Inox Marketplace' }, { id: 702, descricao: 'Ralos', categoriaPai: { id: 701 } }]; },
    async queueProducts() { return [
      product('FILACUBA', 11001, { format: 'E', structureStockType: 'F' }), product('FILARALO', 11002),
      product('FILAGANCHO', 11003), product('FILAESTOQUE', 11004), product('FILAKIT', 11005, { format: 'E' }),
      product('FILAREVENDA', 11006, { categoryId: '703' }), product('FILAINATIVO', 11007, { active: false }),
      product('FILAPOSICAO', 11008),
    ]; },
    async queueBalances() { return new Map([
      [11001, { value: 0, source: 'virtual' as const }], [11002, { value: 4, source: 'fisico' as const }],
      [11003, { value: 0, source: 'virtual' as const }], [11004, { value: 2, source: 'total' as const }],
      [11008, { value: 7, source: 'virtual' as const }],
    ]); },
  };
  const invoices = {
    async demand() { return { items: [], kits: new Map(), pendingInvoices: 0, listedAt: new Date() }; },
    async queueDemand() { return {
      sold: new Map([['FILACUBA', 120], ['FILARALO', 24], ['FILAGANCHO', 36], ['FILAESTOQUE', 7],
        ['FILAKIT', 60], ['FILAREVENDA', 72], ['FILAINATIVO', 96], ['FILAPOSICAO', 24]]),
      ignored: [{ invoice: '105', sku: 'FORA', quantity: 1001 }], invoiceCount: 5, pendingInvoices: 0,
      listedAt: new Date(), coveredFrom: '2026-09-01', coveredTo: '2026-11-27',
    }; },
  };
  const orders = createPostgresProductionOrderRepository(writerPool, bling, invoices);
  const snapshot = (await repo.read()).data;
  const operationId = snapshot.operations.find(o => o.name === 'Dobrar')!.id;
  const saveSheet = async (sku: string, code: string) => (await repo.saveSheet(null, {
    sku, code, name: sku, status: 'aberto', baseQuantity: 1, lineId: null, components: [],
    steps: [{ operationId, predecessorOperationId: null, plannedMinutes: null, notes: null }],
  }, actor)).data.id;
  const sheetId = await saveSheet('FILACUBA', 'FILA-1');
  const fallbackSheet = await saveSheet('FILAESTOQUE', 'FILA-2');
  const input = { kind: 'semanal', policy: 'bling', factor: 1.7, from: '2026-09-04', to: '2026-11-26' } as const;
  await pool.query("insert into brsteel_pcp.bling_products (sku, bling_id) values ('FILAANTIGA', 11001)");
  const preview = (await orders.preview(input, actor)).data;
  assert.equal((await pool.query('select sku from brsteel_pcp.bling_products where bling_id = 11001')).rows[0].sku, 'FILACUBA');
  const cut = (await orders.preview({ ...input, kind: 'corte' }, actor)).data;
  assert.deepEqual(cut.suggestions, preview.suggestions);
  assert.deepEqual(preview.suggestions.map(s => [s.sku, s.quantity, s.tier]), [
    ['FILACUBA', 17, 'zerado'], ['FILAGANCHO', 6, 'zerado'], ['FILARALO', 5, 'abaixo_minimo'], ['FILAESTOQUE', 5, 'abaixo_minimo'],
  ]);
  assert.equal(preview.suggestions.find(s => s.sku === 'FILAGANCHO')?.sheet, null);
  assert.equal(preview.suggestions.find(s => s.sku === 'FILAESTOQUE')?.stockSource, 'total');
  assert.deepEqual(preview.ignored, [{ invoice: '105', sku: 'FORA', quantity: 1001 }]);
  assert.ok(preview.previewToken);
  assert.equal((await orders.preview(input, null)).data.previewToken, undefined);
  const incomplete = (await orders.preview({ ...input, from: '2026-08-01' }, actor)).data;
  assert.equal(incomplete.previewToken, undefined);
  assert.ok(incomplete.warnings.some(warning => warning.includes('cobre')));

  const batch = {
    ...input, items: [{ sku: 'FILACUBA', sheetId, quantity: 3, description: null }],
    previewToken: preview.previewToken, idempotencyKey: 'b22d0a9f-c6f2-41ad-ad86-f94847de5217',
  };
  await assert.rejects(orders.createBatch({
    ...batch, items: [{ sku: 'FILAESTOQUE', sheetId: fallbackSheet, quantity: 5, description: null }],
  }, actor), /prévia|saldo/);
  await assert.rejects(orders.createBatch({ ...batch, factor: 2 }, actor), /nova prévia/);
  await assert.rejects(orders.createBatch(batch, { ...actor, userId: 'outro-operador' }), /nova prévia/);
  const [first, retry] = await Promise.all([orders.createBatch(batch, actor), orders.createBatch(batch, actor)]);
  assert.equal(first.data.batchId, retry.data.batchId);
  assert.equal((await orders.listOrders(first.data.batchId)).data[0].quantity, 3);
  await assert.rejects(orders.createBatch({
    ...batch, idempotencyKey: 'f22d0a9f-c6f2-41ad-ad86-f94847de5217',
  }, actor), /lote.*aberto/i);
  await assert.rejects(orders.createBatch({
    kind: 'semanal', factor: 1, from: input.from, to: input.to, items: batch.items,
  }, actor), /lote.*aberto/i);
  await assert.rejects(orders.createBatch({
    ...batch, items: [{ ...batch.items[0], quantity: 9 }],
  }, actor), /idempotência/i);
});

test('a demanda fiscal da fila corta por item, relê NF-e pendente e registra cobertura vazia', async () => {
  const { createPostgresSalesInvoices, saoPauloDate } = await import('@/server/persistence/postgres-sales-invoices');
  await pool.query('truncate brsteel_pcp.sales_invoices cascade');
  const firstTime = Date.now() - 8 * 3_600_000;
  const day = saoPauloDate(firstTime);
  const invoice = { blingId: 12001, number: '000079', situation: 1, issuedAt: new Date(firstTime).toISOString() };
  let detailFails = false;
  let lines = [
    { sku: 'FISCAL-A', cfop: '5102', quantity: 600 }, { sku: 'FISCAL-A', cfop: '6102', quantity: 600 },
    { sku: 'FISCAL-A', cfop: '5102', quantity: 1001 }, { sku: 'FISCAL-A', cfop: '5915', quantity: 70 },
    { sku: 'FISCAL-B', cfop: '7405', quantity: 1000 }, { sku: 'FISCAL-KIT', cfop: '5102', quantity: 3 },
  ];
  let exists = true;
  const seen: number[] = [];
  const reader = {
    async listOutgoing({ cancelled }: { cancelled: boolean }) {
      if (!exists) return [];
      return cancelled ? [{ ...invoice, blingId: 12002, situation: 2 }] : [invoice];
    },
    async invoice(blingId: number) {
      if (detailFails) throw new Error('temporarily unavailable');
      seen.push(blingId);
      return { ...invoice, items: lines };
    },
    async productsByCode() { return []; },
    async kitStructure() { return []; },
  };
  const invoices = createPostgresSalesInvoices(writerPool, reader);
  await invoices.sync(actor, { now: () => firstTime });
  let read = await invoices.queueDemand(day, day);
  assert.equal(read.sold.get('FISCAL-A'), 1200);
  assert.equal(read.sold.get('FISCAL-B'), 1000);
  assert.equal(read.sold.get('FISCAL-KIT'), 3);
  assert.deepEqual(read.ignored, [{ invoice: '000079', sku: 'FISCAL-A', quantity: 1001 }]);
  assert.equal(read.invoiceCount, 1);
  assert.equal(read.pendingInvoices, 1);

  lines = [{ sku: 'FISCAL-A', cfop: '5102', quantity: 9 }];
  await invoices.sync(actor);
  read = await invoices.queueDemand(day, day);
  assert.deepEqual(seen, [12001, 12001]);
  assert.equal(read.sold.get('FISCAL-A'), 9);
  assert.equal(read.pendingInvoices, 0);

  invoice.situation = 5;
  detailFails = true;
  await invoices.sync(actor, { now: () => Date.now() + 30_000 });
  read = await invoices.queueDemand(day, day);
  assert.equal(read.sold.has('FISCAL-A'), false);
  assert.equal(read.pendingInvoices, 1);
  assert.equal(read.coveredTo, saoPauloDate(Date.now() + 30_000));

  exists = false;
  await assert.rejects(invoices.sync(actor, { now: () => Date.now() + 60_000 }), /listagem vazia/i);
  assert.equal((await invoices.queueDemand(day, day)).listedAt?.getTime(), read.listedAt?.getTime());
  await pool.query('truncate brsteel_pcp.sales_invoices cascade');
  await invoices.sync(actor, { now: () => Date.now() + 60_000 });
  const empty = await invoices.queueDemand(day, day);
  assert.equal(empty.invoiceCount, 0);
  assert.ok(empty.coveredFrom && empty.coveredFrom <= day);
  assert.ok(empty.coveredTo && empty.coveredTo >= day);
  assert.ok(empty.listedAt);
});
