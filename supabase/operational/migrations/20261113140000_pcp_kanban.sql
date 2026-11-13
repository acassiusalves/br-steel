-- Kanban de OPs por fase (Fase 4 do plano de cópia do iApp).
--
-- A OP fica numa coluna: "A produzir", uma fase da linha, ou "Concluído". Cada OS guarda quem a
-- iniciou e quando, quando terminou e as observações. Perdas reduzem a quantidade atual da OP.
-- Todo evento do quadro vai para `production_order_events`, para saber quem moveu cada card.
begin;

alter table brsteel_pcp.production_orders
  add column phase_id uuid references brsteel_pcp.production_phases(id) on delete restrict;
create index production_orders_phase on brsteel_pcp.production_orders (phase_id);

alter table brsteel_pcp.production_order_steps
  add column worker_id uuid references brsteel_pcp.workers(id) on delete restrict,
  add column started_at timestamptz,
  add column finished_at timestamptz,
  add column notes text check (length(notes) <= 2000),
  add constraint production_order_steps_timeline check (
    (status = 'aberto' and worker_id is null and started_at is null and finished_at is null)
    or (status = 'em_execucao' and worker_id is not null and started_at is not null and finished_at is null)
    or (status = 'executada' and worker_id is not null and started_at is not null and finished_at is not null and finished_at >= started_at));

create table brsteel_pcp.production_order_losses (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references brsteel_pcp.production_orders(id) on delete cascade,
  step_id uuid not null references brsteel_pcp.production_order_steps(id) on delete cascade,
  quantity numeric(14,5) not null check (quantity > 0),
  reason_id uuid not null references brsteel_pcp.loss_reasons(id) on delete restrict,
  notes text check (length(notes) <= 2000),
  created_by text not null check (length(created_by) between 1 and 200),
  created_at timestamptz not null default now()
);
create index production_order_losses_order on brsteel_pcp.production_order_losses (order_id);

create table brsteel_pcp.production_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references brsteel_pcp.production_orders(id) on delete cascade,
  step_id uuid references brsteel_pcp.production_order_steps(id) on delete set null,
  kind text not null check (kind in ('move', 'start', 'finish', 'loss')),
  from_column text check (length(from_column) <= 100),
  to_column text check (length(to_column) <= 100),
  worker_id uuid references brsteel_pcp.workers(id) on delete set null,
  user_id text not null check (length(user_id) between 1 and 200),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);
create index production_order_events_order on brsteel_pcp.production_order_events (order_id, created_at);

do $$
declare t text;
begin
  foreach t in array array['production_order_losses', 'production_order_events'] loop
    execute format('alter table brsteel_pcp.%I enable row level security', t);
    execute format('revoke all on brsteel_pcp.%I from public', t);
    execute format('grant select, insert, update, delete on brsteel_pcp.%I to brsteel_ops_writer', t);
    execute format('create policy writer on brsteel_pcp.%I for all to brsteel_ops_writer using (true) with check (true)', t);
    execute format('grant select on brsteel_pcp.%I to brsteel_ops_reader', t);
    execute format('create policy reader on brsteel_pcp.%I for select to brsteel_ops_reader using (true)', t);
    execute format('grant select on brsteel_pcp.%I to brsteel_ops_backup', t);
    execute format('create policy backup_reader on brsteel_pcp.%I for select to brsteel_ops_backup using (true)', t);
  end loop;
end $$;

commit;
