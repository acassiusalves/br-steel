/**
 * Carga das OPs em andamento do Kanban do iApp para o Kanban de OPs do BR Steel.
 *
 * Repetível: casa as OPs pelo `iapp_id`. Rodar de novo cria as OPs novas, regrava as que ainda não foram
 * mexidas no BR Steel (sem nenhum evento no quadro) e conclui as que saíram da lista de abertas do iApp.
 * OP já movida, iniciada ou finalizada aqui não é tocada: a partir daí vale o BR Steel.
 *
 *   node --import tsx scripts/pcp-import-iapp-orders.ts --file /privado/ops.json --emit-sql /privado/ops.sql
 *   supabase db query --workdir <dir vinculado> --linked -f /privado/ops.sql
 *
 * Ou direto num banco (o local da suíte, por exemplo):
 *   BRSTEEL_PCP_IMPORT_URL=postgresql://... node --import tsx scripts/pcp-import-iapp-orders.ts --file ... --confirm-host 127.0.0.1
 *
 * O iApp não informa quem iniciou cada OS nem quando. Uma OS em execução ou executada lá entra marcada
 * como `imported`, sem funcionário e sem horário; no quadro, o líder da operação pode finalizá-la.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';

/** Exportação feita a partir dos cards do Kanban "Ordem de Produção por Fase Produtiva" do iApp. */
export type IappOrdersExport = {
  capturedAt: string;
  /** IDs de todas as OPs abertas no recorte exportado; as importadas fora dessa lista foram concluídas lá. */
  openIds: number[];
  orders: {
    iappId: number;
    number: string;
    /** Nome da fase em que o card está; null em "A Produzir". */
    phase: string | null;
    status: 'A PRODUZIR' | 'PRODUZINDO' | 'SUSPENSO' | 'BLOQUEADO';
    sku: string;
    description: string | null;
    quantity: number;
    priority: string | null;
    plannedStart: string | null;
    plannedEnd: string | null;
    steps: { operation: string; status: 'ABERTO' | 'EM EXECUÇÃO' | 'EXECUTADA' }[];
  }[];
};

const ORDER_STATUS: Record<string, 'a_produzir' | 'produzindo' | 'suspenso'> = {
  'A PRODUZIR': 'a_produzir', PRODUZINDO: 'produzindo', SUSPENSO: 'suspenso', BLOQUEADO: 'suspenso',
};
const STEP_STATUS: Record<string, 'aberto' | 'em_execucao' | 'executada'> = { ABERTO: 'aberto', 'EM EXECUÇÃO': 'em_execucao', EXECUTADA: 'executada' };
const PRIORITY: Record<string, 'estoque' | 'fulfillment' | 'urgente'> = {
  estoque: 'estoque', fullfilment: 'fulfillment', fulfillment: 'fulfillment', 'pedido urgente': 'urgente',
};

/** "12/11/2026 13:58" no horário de São Paulo → ISO. */
export function iappDate(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`Data inválida na exportação: ${value}`);
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00-03:00`;
}

/** Normaliza a exportação para o formato que o SQL grava, recusando o que o banco recusaria. */
export function normalizeOrders(data: IappOrdersExport) {
  if (!Array.isArray(data.orders) || !Array.isArray(data.openIds)) throw new Error('Exportação sem OPs.');
  const seen = new Set<number>();
  const orders = data.orders.map(o => {
    if (!Number.isSafeInteger(o.iappId) || o.iappId <= 0) throw new Error(`OP com ID inválido: ${o.iappId}`);
    if (seen.has(o.iappId)) throw new Error(`OP repetida: ${o.number}`);
    seen.add(o.iappId);
    const status = ORDER_STATUS[o.status];
    if (!status) throw new Error(`OP ${o.number}: situação desconhecida (${o.status}).`);
    if (!o.sku?.trim() || o.sku.length > 100) throw new Error(`OP ${o.number}: SKU inválido.`);
    if (!(o.quantity > 0) || !Number.isFinite(o.quantity)) throw new Error(`OP ${o.number}: quantidade inválida.`);
    if (!/^[0-9A-Za-z.-]{1,30}$/.test(o.number)) throw new Error(`OP com número inválido: ${o.number}`);
    const operations = new Set<string>();
    const steps = o.steps.map(t => {
      const stepStatus = STEP_STATUS[t.status];
      if (!stepStatus) throw new Error(`OP ${o.number}: OS com situação desconhecida (${t.status}).`);
      if (!t.operation?.trim()) throw new Error(`OP ${o.number}: OS sem operação.`);
      return { operation: t.operation.trim(), status: stepStatus };
    }).filter(t => !operations.has(t.operation.toLowerCase()) && operations.add(t.operation.toLowerCase()));
    // OP de corte: só a operação de cortar. As demais seguem o roteiro inteiro (produção semanal, ou dobra).
    const kind = steps.length > 0 && steps.every(t => /^cortar$/i.test(t.operation)) ? 'corte' : 'semanal';
    return {
      iappId: o.iappId, number: o.number, status, phase: status === 'a_produzir' ? null : o.phase?.trim() || null,
      kind, sku: o.sku.trim(), description: o.description?.trim().slice(0, 300) || null, quantity: o.quantity,
      priority: PRIORITY[(o.priority ?? '').trim().toLowerCase()] ?? 'estoque',
      plannedStart: iappDate(o.plannedStart), plannedEnd: iappDate(o.plannedEnd), steps,
    };
  });
  const openIds = data.openIds.map(id => { if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`ID inválido: ${id}`); return id; });
  for (const o of orders) if (!openIds.includes(o.iappId)) throw new Error(`OP ${o.number} fora da lista de abertas.`);
  return { orders, openIds };
}

/** SQL único, transacional e idempotente. As fases e operações são achadas pelo nome, que veio do iApp. */
export function buildOrdersSql(data: IappOrdersExport): string {
  const payload = JSON.stringify(normalizeOrders(data));
  if (payload.includes('$iapp$')) throw new Error('A exportação contém um delimitador reservado.');
  const s = 'brsteel_pcp';
  return `begin;
do $do$
declare
  payload jsonb := $iapp$${payload}$iapp$::jsonb;
  op jsonb; os jsonb; v_order uuid; v_touched boolean; v_phase uuid; v_operation uuid; v_prev uuid; v_step uuid; v_position int;
begin
  for op in select value from jsonb_array_elements(payload->'orders') loop
    select o.id, exists (select 1 from ${s}.production_order_events e where e.order_id = o.id)
      into v_order, v_touched from ${s}.production_orders o where o.iapp_id = (op->>'iappId')::bigint;
    -- Já mexida no BR Steel: daqui em diante vale o quadro daqui.
    if v_touched then continue; end if;
    v_phase := (select p.id from ${s}.production_phases p join ${s}.production_lines l on l.id = p.line_id
      where l.active and lower(p.name) = lower(op->>'phase') order by p.position limit 1);
    if v_order is null then
      insert into ${s}.production_orders (iapp_id, iapp_number, kind, sku, description, sheet_id, quantity, status, phase_id, priority,
          created_by, created_at, planned_start, planned_end)
        values ((op->>'iappId')::bigint, op->>'number', op->>'kind', op->>'sku', op->>'description',
          (select sh.id from ${s}.product_sheets sh where sh.sku = op->>'sku'
            order by (select count(*) from ${s}.product_sheet_steps st where st.sheet_id = sh.id) desc, sh.code limit 1),
          (op->>'quantity')::numeric, op->>'status', case when op->>'status' = 'a_produzir' then null else v_phase end, op->>'priority',
          'iapp-import', coalesce((op->>'plannedStart')::timestamptz, now()), (op->>'plannedStart')::timestamptz, (op->>'plannedEnd')::timestamptz)
        returning id into v_order;
    else
      update ${s}.production_orders set iapp_number = op->>'number', kind = op->>'kind', sku = op->>'sku', description = op->>'description',
          quantity = (op->>'quantity')::numeric, status = op->>'status', phase_id = case when op->>'status' = 'a_produzir' then null else v_phase end,
          priority = op->>'priority', planned_start = (op->>'plannedStart')::timestamptz, planned_end = (op->>'plannedEnd')::timestamptz, updated_at = now()
        where id = v_order;
      delete from ${s}.production_order_steps where order_id = v_order;
    end if;
    v_prev := null; v_position := 0;
    for os in select value from jsonb_array_elements(op->'steps') loop
      v_operation := (select id from ${s}.production_operations where lower(name) = lower(os->>'operation') order by position limit 1);
      -- Operação sem cadastro aqui (Projetar, que não tem fase): a OS fica de fora.
      if v_operation is null then continue; end if;
      insert into ${s}.production_order_steps (order_id, operation_id, position, predecessor_step_id, status, imported)
        values (v_order, v_operation, v_position, v_prev, os->>'status', os->>'status' <> 'aberto')
        returning id into v_step;
      v_prev := v_step; v_position := v_position + 1;
    end loop;
  end loop;
  -- Vindas do iApp, ainda não mexidas aqui, que saíram da lista de abertas: foram concluídas ou encerradas lá.
  update ${s}.production_orders o set status = 'concluido', phase_id = null, updated_at = now()
    where o.iapp_id is not null and o.status in ('a_produzir', 'produzindo', 'suspenso')
      and o.iapp_id not in (select (jsonb_array_elements_text(payload->'openIds'))::bigint)
      and not exists (select 1 from ${s}.production_order_events e where e.order_id = o.id);
end
$do$;
insert into brsteel_write.audit (id, operation, user_id, source, target_collection, target_id)
  values (gen_random_uuid()::text, 'pcp.importIappOrders', 'script', 'web', 'pcp.orders', ${pgLiteral(data.capturedAt.slice(0, 40))});
commit;
`;
}

const pgLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

async function main() {
  const { values } = parseArgs({ options: { file: { type: 'string' }, 'emit-sql': { type: 'string' }, 'confirm-host': { type: 'string' } } });
  if (!values.file) { console.error('Informe --file.'); process.exit(2); }
  const data = JSON.parse(readFileSync(values.file, 'utf8')) as IappOrdersExport;
  let sql: string;
  try { sql = buildOrdersSql(data); } catch (error) { console.error(`${(error as Error).message} Nada foi gerado.`); process.exit(1); }
  const summary = JSON.stringify({ orders: data.orders.length, steps: data.orders.reduce((n, o) => n + o.steps.length, 0), openIds: data.openIds.length });
  if (values['emit-sql']) {
    writeFileSync(values['emit-sql'], sql, { mode: 0o600, flag: 'wx' });
    console.log(`SQL gerado em ${values['emit-sql']}: ${summary}`);
    return;
  }
  const url = process.env.BRSTEEL_PCP_IMPORT_URL;
  if (!url || !values['confirm-host']) { console.error('Informe --emit-sql, ou --confirm-host com a variável BRSTEEL_PCP_IMPORT_URL.'); process.exit(2); }
  const target = new URL(url);
  if (target.hostname !== values['confirm-host']) { console.error(`O host da URL (${target.hostname}) não confere com --confirm-host. Nada foi gravado.`); process.exit(2); }
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(target.hostname);
  const client = new pg.Client({ connectionString: url, ...(loopback ? {} : { ssl: { rejectUnauthorized: true } }) });
  await client.connect();
  try { await client.query(sql); console.log(summary); }
  catch (error) {
    await client.query('rollback').catch(() => undefined);
    console.error(`Falha no banco (${(error as { code?: string }).code ?? 'sem código'}). Nada foi gravado.`);
    process.exitCode = 1;
  } finally { await client.end(); }
}

if (process.argv[1]?.endsWith('pcp-import-iapp-orders.ts')) void main();
