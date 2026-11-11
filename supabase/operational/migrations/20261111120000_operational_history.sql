-- Histórico de saldo por SKU e demanda semanal: as duas séries que até aqui só existiam no Firestore.
-- Mesmo formato genérico das demais coleções, para que carga, reconciliação e comparador as cubram.
create table brsteel_ops.stock_observation_log (
  source_id text collate "C" primary key check (length(source_id) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_version numeric(30,0) not null check (source_version >= 0),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  import_run_id text not null references brsteel_import.runs(id),
  source_deleted boolean not null default false
);
create index stock_observation_log_sku on brsteel_ops.stock_observation_log
  ((payload->>'sku'), (payload->>'observedAt')) where not source_deleted;

create table brsteel_ops.sku_weekly_demand (
  source_id text collate "C" primary key check (length(source_id) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_version numeric(30,0) not null check (source_version >= 0),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  import_run_id text not null references brsteel_import.runs(id),
  source_deleted boolean not null default false
);

alter table brsteel_ops.stock_observation_log enable row level security;
revoke all on brsteel_ops.stock_observation_log from public;
grant select, insert, update, delete on brsteel_ops.stock_observation_log to brsteel_ops_importer;
create policy importer on brsteel_ops.stock_observation_log for all to brsteel_ops_importer using (true) with check (true);
grant select on brsteel_ops.stock_observation_log to brsteel_ops_reader;
create policy reader on brsteel_ops.stock_observation_log for select to brsteel_ops_reader using (true);
grant select, insert, update, delete on brsteel_ops.stock_observation_log to brsteel_ops_writer;
create policy writer on brsteel_ops.stock_observation_log for all to brsteel_ops_writer using (true) with check (true);
grant select on brsteel_ops.stock_observation_log to brsteel_ops_backup;
create policy backup_reader on brsteel_ops.stock_observation_log for select to brsteel_ops_backup using (true);

alter table brsteel_ops.sku_weekly_demand enable row level security;
revoke all on brsteel_ops.sku_weekly_demand from public;
grant select, insert, update, delete on brsteel_ops.sku_weekly_demand to brsteel_ops_importer;
create policy importer on brsteel_ops.sku_weekly_demand for all to brsteel_ops_importer using (true) with check (true);
grant select on brsteel_ops.sku_weekly_demand to brsteel_ops_reader;
create policy reader on brsteel_ops.sku_weekly_demand for select to brsteel_ops_reader using (true);
grant select, insert, update, delete on brsteel_ops.sku_weekly_demand to brsteel_ops_writer;
create policy writer on brsteel_ops.sku_weekly_demand for all to brsteel_ops_writer using (true) with check (true);
grant select on brsteel_ops.sku_weekly_demand to brsteel_ops_backup;
create policy backup_reader on brsteel_ops.sku_weekly_demand for select to brsteel_ops_backup using (true);
