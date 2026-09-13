-- Operational schema, separate from the OAuth migration chain. Not yet deployed.
begin;
create schema brsteel_ops;
create schema brsteel_import;
revoke all on schema brsteel_ops, brsteel_import from public;
create role brsteel_ops_reader nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role brsteel_ops_importer nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema brsteel_ops, brsteel_import to brsteel_ops_reader, brsteel_ops_importer;
create table brsteel_import.runs (
  id text primary key check (id ~ '^[a-f0-9]{64}$'),
  source_project text not null, captured_at timestamptz not null,
  status text not null check (status in ('loading', 'complete')),
  next_index integer not null default 0 check (next_index >= 0),
  total_records integer not null check (total_records >= 0),
  completed_at timestamptz,
  check (next_index <= total_records)
);
create table brsteel_import.state (
  singleton boolean primary key default true check (singleton),
  source_project text not null,
  active_run text not null references brsteel_import.runs(id),
  ready boolean not null default false
);
create table brsteel_ops.sales_orders (
  source_id text collate "C" primary key check (length(source_id) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_version numeric(30,0) not null check (source_version >= 0),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  import_run_id text not null references brsteel_import.runs(id),
  source_deleted boolean not null default false
);
create table brsteel_ops.stock_observations (
  source_id text collate "C" primary key check (length(source_id) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_version numeric(30,0) not null check (source_version >= 0),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  import_run_id text not null references brsteel_import.runs(id),
  source_deleted boolean not null default false
);
create table brsteel_ops.supplies (
  source_id text collate "C" primary key check (length(source_id) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_version numeric(30,0) not null check (source_version >= 0),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  import_run_id text not null references brsteel_import.runs(id),
  source_deleted boolean not null default false
);
create table brsteel_ops.production_columns (
  source_id text collate "C" primary key check (length(source_id) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_version numeric(30,0) not null check (source_version >= 0),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  import_run_id text not null references brsteel_import.runs(id),
  source_deleted boolean not null default false
);
create table brsteel_ops.production_counters (
  source_id text collate "C" primary key check (length(source_id) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_version numeric(30,0) not null check (source_version >= 0),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  import_run_id text not null references brsteel_import.runs(id),
  source_deleted boolean not null default false
);
create table brsteel_ops.supply_codes (
  source_id text collate "C" primary key check (length(source_id) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_version numeric(30,0) not null check (source_version >= 0),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  import_run_id text not null references brsteel_import.runs(id),
  source_deleted boolean not null default false
);
create table brsteel_ops.inventory_movements (
  source_id text collate "C" primary key check (length(source_id) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_version numeric(30,0) not null check (source_version >= 0),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  import_run_id text not null references brsteel_import.runs(id),
  source_deleted boolean not null default false
);
create table brsteel_ops.production_lots (
  source_id text collate "C" primary key check (length(source_id) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_version numeric(30,0) not null check (source_version >= 0),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  import_run_id text not null references brsteel_import.runs(id),
  source_deleted boolean not null default false
);
create table brsteel_ops.production_lot_items (
  source_id text collate "C" primary key check (length(source_id) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_version numeric(30,0) not null check (source_version >= 0),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  import_run_id text not null references brsteel_import.runs(id),
  source_deleted boolean not null default false
);
create table brsteel_ops.production_comments (
  source_id text collate "C" primary key check (length(source_id) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_version numeric(30,0) not null check (source_version >= 0),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  import_run_id text not null references brsteel_import.runs(id),
  source_deleted boolean not null default false
);
alter table brsteel_ops.sales_orders
  add column order_date text collate "C" generated always as (payload->>'data') stored,
  add column amount double precision generated always as (case when jsonb_typeof(payload->'total') = 'number' then (payload->>'total')::double precision else 0 end) stored,
  add column customer_key jsonb generated always as (nullif(payload#>'{contato,id}', 'null'::jsonb)) stored,
  add column store_key jsonb generated always as (payload#>'{loja,id}') stored,
  add column status_key jsonb generated always as (payload#>'{situacao,id}') stored;
create index sales_date_id on brsteel_ops.sales_orders(order_date desc, source_id desc) where not source_deleted;
create index sales_store_status_date on brsteel_ops.sales_orders(store_key, status_key, order_date, source_id) where not source_deleted;
create table brsteel_ops.sales_order_items (
  order_id text collate "C" not null references brsteel_ops.sales_orders(source_id),
  position integer not null check (position >= 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  quantity double precision generated always as (case when jsonb_typeof(payload->'quantidade')='number' then (payload->>'quantidade')::double precision else 0 end) stored,
  unit_price double precision generated always as (case when jsonb_typeof(payload->'valor')='number' then (payload->>'valor')::double precision else 0 end) stored,
  primary key(order_id,position)
);
alter table brsteel_ops.stock_observations add column sku text generated always as (coalesce(nullif(payload->>'sku',''),source_id)) stored;
create index stock_sku on brsteel_ops.stock_observations(sku,source_id) where not source_deleted;
alter table brsteel_ops.supplies add column sku text generated always as (payload->>'codigo') stored;
create index supplies_sku on brsteel_ops.supplies(sku) where not source_deleted;
alter table brsteel_ops.supply_codes add column supply_id text generated always as (payload->>'supplyId') stored not null references brsteel_ops.supplies(source_id);
alter table brsteel_ops.inventory_movements add column supply_id text generated always as (payload->>'supplyId') stored not null references brsteel_ops.supplies(source_id);
create index movements_supply_date on brsteel_ops.inventory_movements(supply_id,(payload->>'createdAt'),source_id) where not source_deleted;
alter table brsteel_ops.production_lots add column column_id text generated always as (payload->>'columnId') stored not null references brsteel_ops.production_columns(source_id);
create index lots_column on brsteel_ops.production_lots(column_id,source_id) where not source_deleted;
alter table brsteel_ops.production_lot_items
  add column lot_id text generated always as (payload->>'lotId') stored not null references brsteel_ops.production_lots(source_id),
  add column order_id text generated always as (payload->>'sourceOrderId') stored not null references brsteel_ops.sales_orders(source_id);
create index items_lot on brsteel_ops.production_lot_items(lot_id,source_id) where not source_deleted;
create index items_order on brsteel_ops.production_lot_items(order_id) where not source_deleted;
alter table brsteel_ops.production_comments add column lot_id text generated always as (payload->>'lotId') stored not null references brsteel_ops.production_lots(source_id);
create index comments_lot on brsteel_ops.production_comments(lot_id,source_id) where not source_deleted;
alter table brsteel_import.runs enable row level security;
revoke all on brsteel_import.runs from public;
grant select, insert, update, delete on brsteel_import.runs to brsteel_ops_importer;
create policy importer on brsteel_import.runs for all to brsteel_ops_importer using (true) with check (true);
alter table brsteel_import.state enable row level security;
revoke all on brsteel_import.state from public;
grant select, insert, update, delete on brsteel_import.state to brsteel_ops_importer;
create policy importer on brsteel_import.state for all to brsteel_ops_importer using (true) with check (true);
grant select on brsteel_import.state to brsteel_ops_reader;
create policy reader on brsteel_import.state for select to brsteel_ops_reader using (true);
alter table brsteel_ops.sales_orders enable row level security;
revoke all on brsteel_ops.sales_orders from public;
grant select, insert, update, delete on brsteel_ops.sales_orders to brsteel_ops_importer;
create policy importer on brsteel_ops.sales_orders for all to brsteel_ops_importer using (true) with check (true);
grant select on brsteel_ops.sales_orders to brsteel_ops_reader;
create policy reader on brsteel_ops.sales_orders for select to brsteel_ops_reader using (true);
alter table brsteel_ops.stock_observations enable row level security;
revoke all on brsteel_ops.stock_observations from public;
grant select, insert, update, delete on brsteel_ops.stock_observations to brsteel_ops_importer;
create policy importer on brsteel_ops.stock_observations for all to brsteel_ops_importer using (true) with check (true);
grant select on brsteel_ops.stock_observations to brsteel_ops_reader;
create policy reader on brsteel_ops.stock_observations for select to brsteel_ops_reader using (true);
alter table brsteel_ops.supplies enable row level security;
revoke all on brsteel_ops.supplies from public;
grant select, insert, update, delete on brsteel_ops.supplies to brsteel_ops_importer;
create policy importer on brsteel_ops.supplies for all to brsteel_ops_importer using (true) with check (true);
grant select on brsteel_ops.supplies to brsteel_ops_reader;
create policy reader on brsteel_ops.supplies for select to brsteel_ops_reader using (true);
alter table brsteel_ops.production_columns enable row level security;
revoke all on brsteel_ops.production_columns from public;
grant select, insert, update, delete on brsteel_ops.production_columns to brsteel_ops_importer;
create policy importer on brsteel_ops.production_columns for all to brsteel_ops_importer using (true) with check (true);
grant select on brsteel_ops.production_columns to brsteel_ops_reader;
create policy reader on brsteel_ops.production_columns for select to brsteel_ops_reader using (true);
alter table brsteel_ops.production_counters enable row level security;
revoke all on brsteel_ops.production_counters from public;
grant select, insert, update, delete on brsteel_ops.production_counters to brsteel_ops_importer;
create policy importer on brsteel_ops.production_counters for all to brsteel_ops_importer using (true) with check (true);
grant select on brsteel_ops.production_counters to brsteel_ops_reader;
create policy reader on brsteel_ops.production_counters for select to brsteel_ops_reader using (true);
alter table brsteel_ops.supply_codes enable row level security;
revoke all on brsteel_ops.supply_codes from public;
grant select, insert, update, delete on brsteel_ops.supply_codes to brsteel_ops_importer;
create policy importer on brsteel_ops.supply_codes for all to brsteel_ops_importer using (true) with check (true);
grant select on brsteel_ops.supply_codes to brsteel_ops_reader;
create policy reader on brsteel_ops.supply_codes for select to brsteel_ops_reader using (true);
alter table brsteel_ops.inventory_movements enable row level security;
revoke all on brsteel_ops.inventory_movements from public;
grant select, insert, update, delete on brsteel_ops.inventory_movements to brsteel_ops_importer;
create policy importer on brsteel_ops.inventory_movements for all to brsteel_ops_importer using (true) with check (true);
grant select on brsteel_ops.inventory_movements to brsteel_ops_reader;
create policy reader on brsteel_ops.inventory_movements for select to brsteel_ops_reader using (true);
alter table brsteel_ops.production_lots enable row level security;
revoke all on brsteel_ops.production_lots from public;
grant select, insert, update, delete on brsteel_ops.production_lots to brsteel_ops_importer;
create policy importer on brsteel_ops.production_lots for all to brsteel_ops_importer using (true) with check (true);
grant select on brsteel_ops.production_lots to brsteel_ops_reader;
create policy reader on brsteel_ops.production_lots for select to brsteel_ops_reader using (true);
alter table brsteel_ops.production_lot_items enable row level security;
revoke all on brsteel_ops.production_lot_items from public;
grant select, insert, update, delete on brsteel_ops.production_lot_items to brsteel_ops_importer;
create policy importer on brsteel_ops.production_lot_items for all to brsteel_ops_importer using (true) with check (true);
grant select on brsteel_ops.production_lot_items to brsteel_ops_reader;
create policy reader on brsteel_ops.production_lot_items for select to brsteel_ops_reader using (true);
alter table brsteel_ops.production_comments enable row level security;
revoke all on brsteel_ops.production_comments from public;
grant select, insert, update, delete on brsteel_ops.production_comments to brsteel_ops_importer;
create policy importer on brsteel_ops.production_comments for all to brsteel_ops_importer using (true) with check (true);
grant select on brsteel_ops.production_comments to brsteel_ops_reader;
create policy reader on brsteel_ops.production_comments for select to brsteel_ops_reader using (true);
alter table brsteel_ops.sales_order_items enable row level security;
revoke all on brsteel_ops.sales_order_items from public;
grant select, insert, update, delete on brsteel_ops.sales_order_items to brsteel_ops_importer;
create policy importer on brsteel_ops.sales_order_items for all to brsteel_ops_importer using (true) with check (true);
grant select on brsteel_ops.sales_order_items to brsteel_ops_reader;
create policy reader on brsteel_ops.sales_order_items for select to brsteel_ops_reader using (true);
commit;
