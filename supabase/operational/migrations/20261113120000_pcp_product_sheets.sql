-- Fichas técnicas do PCP (Fase 2 do plano de cópia do iApp).
--
-- Uma ficha diz por quais operações um produto passa (o roteiro) e do que ele é feito (os componentes).
-- O roteiro gera as ordens de serviço de cada OP; os componentes geram as OPs de corte (multinível "S").
-- Mesmo padrão de `brsteel_pcp`: relacional, só no PostgreSQL, `iapp_id` para repetir a carga.
begin;

create table brsteel_pcp.product_sheets (
  id uuid primary key default gen_random_uuid(),
  iapp_id bigint unique,
  -- Identificação da ficha no iApp (ex.: 00000204). A planilha de importação de OP do iApp pode exigi-la.
  code text not null unique check (length(code) between 1 and 50),
  sku text not null check (length(sku) between 1 and 100),
  name text not null check (length(name) between 1 and 300),
  status text not null default 'aberto'
    check (status in ('aberto', 'aberto_avulso', 'bloqueado', 'suspenso', 'versao_revisada', 'fechado', 'amostra')),
  base_quantity numeric(14,5) not null default 1 check (base_quantity > 0),
  line_id uuid references brsteel_pcp.production_lines(id) on delete restrict,
  extras jsonb not null default '{}' check (jsonb_typeof(extras) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index product_sheets_sku on brsteel_pcp.product_sheets (sku);

-- Roteiro: operações em ordem. A predecessora de um passo é outro passo da mesma ficha.
create table brsteel_pcp.product_sheet_steps (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references brsteel_pcp.product_sheets(id) on delete cascade,
  operation_id uuid not null references brsteel_pcp.production_operations(id) on delete restrict,
  position integer not null check (position >= 0),
  predecessor_step_id uuid,
  planned_minutes numeric(14,5) check (planned_minutes >= 0),
  notes text check (length(notes) <= 2000),
  unique (sheet_id, operation_id),
  unique (sheet_id, position) deferrable initially deferred,
  -- Chave composta: a predecessora precisa ser um passo da mesma ficha.
  unique (sheet_id, id),
  foreign key (sheet_id, predecessor_step_id) references brsteel_pcp.product_sheet_steps (sheet_id, id) deferrable initially deferred,
  check (predecessor_step_id is null or predecessor_step_id <> id)
);
create index product_sheet_steps_operation on brsteel_pcp.product_sheet_steps (operation_id);

-- Componentes da estrutura (materiais consumidos). `step_id` diz em qual passo o componente entra.
create table brsteel_pcp.product_sheet_components (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references brsteel_pcp.product_sheets(id) on delete cascade,
  step_id uuid references brsteel_pcp.product_sheet_steps(id) on delete set null,
  component_sku text not null check (length(component_sku) between 1 and 100),
  component_name text check (length(component_name) <= 300),
  quantity numeric(14,5) not null check (quantity > 0),
  unique (sheet_id, component_sku, step_id)
);
create index product_sheet_components_sheet on brsteel_pcp.product_sheet_components (sheet_id);
create index product_sheet_components_step on brsteel_pcp.product_sheet_components (step_id);

do $$
declare t text;
begin
  foreach t in array array['product_sheets', 'product_sheet_steps', 'product_sheet_components'] loop
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
