begin;

create role brsteel_ops_backup
  nologin
  inherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls;

grant usage on schema brsteel_ops, brsteel_import to brsteel_ops_backup;

grant select on brsteel_import.runs to brsteel_ops_backup;
create policy backup_reader on brsteel_import.runs
  for select to brsteel_ops_backup using (true);

grant select on brsteel_import.state to brsteel_ops_backup;
create policy backup_reader on brsteel_import.state
  for select to brsteel_ops_backup using (true);

grant select on brsteel_ops.sales_orders to brsteel_ops_backup;
create policy backup_reader on brsteel_ops.sales_orders
  for select to brsteel_ops_backup using (true);

grant select on brsteel_ops.stock_observations to brsteel_ops_backup;
create policy backup_reader on brsteel_ops.stock_observations
  for select to brsteel_ops_backup using (true);

grant select on brsteel_ops.supplies to brsteel_ops_backup;
create policy backup_reader on brsteel_ops.supplies
  for select to brsteel_ops_backup using (true);

grant select on brsteel_ops.production_columns to brsteel_ops_backup;
create policy backup_reader on brsteel_ops.production_columns
  for select to brsteel_ops_backup using (true);

grant select on brsteel_ops.production_counters to brsteel_ops_backup;
create policy backup_reader on brsteel_ops.production_counters
  for select to brsteel_ops_backup using (true);

grant select on brsteel_ops.supply_codes to brsteel_ops_backup;
create policy backup_reader on brsteel_ops.supply_codes
  for select to brsteel_ops_backup using (true);

grant select on brsteel_ops.inventory_movements to brsteel_ops_backup;
create policy backup_reader on brsteel_ops.inventory_movements
  for select to brsteel_ops_backup using (true);

grant select on brsteel_ops.production_lots to brsteel_ops_backup;
create policy backup_reader on brsteel_ops.production_lots
  for select to brsteel_ops_backup using (true);

grant select on brsteel_ops.production_lot_items to brsteel_ops_backup;
create policy backup_reader on brsteel_ops.production_lot_items
  for select to brsteel_ops_backup using (true);

grant select on brsteel_ops.production_comments to brsteel_ops_backup;
create policy backup_reader on brsteel_ops.production_comments
  for select to brsteel_ops_backup using (true);

grant select on brsteel_ops.sales_order_items to brsteel_ops_backup;
create policy backup_reader on brsteel_ops.sales_order_items
  for select to brsteel_ops_backup using (true);

commit;
