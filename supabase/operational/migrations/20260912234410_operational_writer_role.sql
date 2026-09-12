-- Native write surface for the core. Separate from the OAuth migration chain and not yet deployed.
-- brsteel_ops holds import projections only; native write bookkeeping lives in brsteel_write so the
-- importer never reconciles audit or idempotency rows as missing source documents.
begin;

create schema brsteel_write;
revoke all on schema brsteel_write from public;

create role brsteel_ops_writer
  nologin
  inherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls;

grant usage on schema brsteel_ops, brsteel_import, brsteel_write to brsteel_ops_writer;
grant usage on schema brsteel_write to brsteel_ops_backup;

-- Readiness is checked inside the write transaction; the writer never mutates import bookkeeping.
grant select on brsteel_import.state to brsteel_ops_writer;
create policy writer on brsteel_import.state for select to brsteel_ops_writer using (true);

create table brsteel_write.audit (
  id text collate "C" primary key check (length(id) between 1 and 200),
  operation text not null check (length(operation) between 1 and 100),
  user_id text not null check (length(user_id) between 1 and 200),
  source text not null check (source in ('web', 'mcp')),
  client_id text check (length(client_id) between 1 and 200),
  target_collection text not null check (length(target_collection) between 1 and 100),
  target_id text not null check (length(target_id) between 1 and 200),
  created_at timestamptz not null default now()
);
create index audit_created_at on brsteel_write.audit (created_at);
create index audit_user_created on brsteel_write.audit (user_id, created_at desc);

create table brsteel_write.idempotency (
  key text collate "C" primary key check (length(key) between 1 and 200),
  operation text not null check (length(operation) between 1 and 100),
  user_id text not null check (length(user_id) between 1 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  check (expires_at > created_at)
);
create index idempotency_expires_at on brsteel_write.idempotency (expires_at);

alter table brsteel_write.audit enable row level security;
alter table brsteel_write.idempotency enable row level security;

-- The writer inserts audit and idempotency rows but never rewrites history.
grant select, insert on brsteel_write.audit to brsteel_ops_writer;
create policy writer on brsteel_write.audit for select to brsteel_ops_writer using (true);
create policy writer_insert on brsteel_write.audit for insert to brsteel_ops_writer with check (true);

grant select, insert, delete on brsteel_write.idempotency to brsteel_ops_writer;
create policy writer on brsteel_write.idempotency for all to brsteel_ops_writer using (true) with check (true);

grant select on brsteel_write.audit to brsteel_ops_backup;
create policy backup_reader on brsteel_write.audit for select to brsteel_ops_backup using (true);
grant select on brsteel_write.idempotency to brsteel_ops_backup;
create policy backup_reader on brsteel_write.idempotency for select to brsteel_ops_backup using (true);

grant select, insert, update, delete on brsteel_ops.sales_orders to brsteel_ops_writer;
create policy writer on brsteel_ops.sales_orders for all to brsteel_ops_writer using (true) with check (true);
grant select, insert, update, delete on brsteel_ops.sales_order_items to brsteel_ops_writer;
create policy writer on brsteel_ops.sales_order_items for all to brsteel_ops_writer using (true) with check (true);
grant select, insert, update, delete on brsteel_ops.stock_observations to brsteel_ops_writer;
create policy writer on brsteel_ops.stock_observations for all to brsteel_ops_writer using (true) with check (true);
grant select, insert, update, delete on brsteel_ops.supplies to brsteel_ops_writer;
create policy writer on brsteel_ops.supplies for all to brsteel_ops_writer using (true) with check (true);
grant select, insert, update, delete on brsteel_ops.supply_codes to brsteel_ops_writer;
create policy writer on brsteel_ops.supply_codes for all to brsteel_ops_writer using (true) with check (true);
grant select, insert, update, delete on brsteel_ops.inventory_movements to brsteel_ops_writer;
create policy writer on brsteel_ops.inventory_movements for all to brsteel_ops_writer using (true) with check (true);
grant select, insert, update, delete on brsteel_ops.production_columns to brsteel_ops_writer;
create policy writer on brsteel_ops.production_columns for all to brsteel_ops_writer using (true) with check (true);
grant select, insert, update, delete on brsteel_ops.production_lots to brsteel_ops_writer;
create policy writer on brsteel_ops.production_lots for all to brsteel_ops_writer using (true) with check (true);
grant select, insert, update, delete on brsteel_ops.production_lot_items to brsteel_ops_writer;
create policy writer on brsteel_ops.production_lot_items for all to brsteel_ops_writer using (true) with check (true);
grant select, insert, update, delete on brsteel_ops.production_comments to brsteel_ops_writer;
create policy writer on brsteel_ops.production_comments for all to brsteel_ops_writer using (true) with check (true);
grant select, insert, update, delete on brsteel_ops.production_counters to brsteel_ops_writer;
create policy writer on brsteel_ops.production_counters for all to brsteel_ops_writer using (true) with check (true);

commit;
