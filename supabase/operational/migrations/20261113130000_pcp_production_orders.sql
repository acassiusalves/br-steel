-- Ordens de produção do PCP (Fase 3 do plano de cópia do iApp).
--
-- Cada geração cria um lote (`production_order_batches`) com as OPs sugeridas pela fila de produção.
-- Uma OP aponta para a ficha técnica usada e nasce com uma ordem de serviço por passo do roteiro
-- (`production_order_steps`), que o Kanban da Fase 4 vai movimentar. No corte, a OP do produto tem
-- OPs filhas para as partes com ficha própria (multinível "S" do iApp).
begin;

create table brsteel_pcp.production_order_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('semanal', 'corte')),
  -- Parâmetros da geração (período, fatores) para saber depois de onde vieram as quantidades.
  params jsonb not null default '{}' check (jsonb_typeof(params) = 'object'),
  created_by text not null check (length(created_by) between 1 and 200),
  created_by_name text check (length(created_by_name) <= 200),
  created_at timestamptz not null default now(),
  -- Momento em que a planilha do iApp foi baixada pela última vez (paralelo com o iApp).
  exported_at timestamptz
);

create table brsteel_pcp.production_orders (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  batch_id uuid references brsteel_pcp.production_order_batches(id) on delete restrict,
  parent_order_id uuid references brsteel_pcp.production_orders(id) on delete cascade,
  kind text not null check (kind in ('semanal', 'corte')),
  sku text not null check (length(sku) between 1 and 100),
  description text check (length(description) <= 300),
  sheet_id uuid references brsteel_pcp.product_sheets(id) on delete restrict,
  quantity numeric(14,5) not null check (quantity > 0),
  status text not null default 'a_produzir' check (status in ('a_produzir', 'produzindo', 'concluido', 'suspenso', 'encerrado')),
  priority text not null default 'estoque' check (priority in ('estoque', 'fulfillment', 'urgente')),
  notes text check (length(notes) <= 2000),
  created_by text not null check (length(created_by) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_order_id is null or parent_order_id <> id)
);
create index production_orders_batch on brsteel_pcp.production_orders (batch_id);
create index production_orders_parent on brsteel_pcp.production_orders (parent_order_id);
create index production_orders_status on brsteel_pcp.production_orders (status, created_at desc);
create index production_orders_sku on brsteel_pcp.production_orders (sku);

-- Ordens de serviço: uma por passo do roteiro da ficha, copiadas no momento da geração.
create table brsteel_pcp.production_order_steps (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references brsteel_pcp.production_orders(id) on delete cascade,
  operation_id uuid not null references brsteel_pcp.production_operations(id) on delete restrict,
  position integer not null check (position >= 0),
  predecessor_step_id uuid,
  status text not null default 'aberto' check (status in ('aberto', 'em_execucao', 'executada')),
  unique (order_id, operation_id),
  unique (order_id, position),
  unique (order_id, id),
  foreign key (order_id, predecessor_step_id) references brsteel_pcp.production_order_steps (order_id, id) deferrable initially deferred,
  check (predecessor_step_id is null or predecessor_step_id <> id)
);
create index production_order_steps_operation on brsteel_pcp.production_order_steps (operation_id);

do $$
declare t text;
begin
  foreach t in array array['production_order_batches', 'production_orders', 'production_order_steps'] loop
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

-- A numeração das OPs vem da sequência da coluna identity; o papel de gravação precisa usá-la.
grant usage on all sequences in schema brsteel_pcp to brsteel_ops_writer;

commit;
