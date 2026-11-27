begin;

alter table brsteel_pcp.bling_products
  add column category_id text,
  add column active boolean,
  add column structure_stock_type text,
  add column has_structure boolean,
  add column queue_synced_at timestamptz;

alter table brsteel_pcp.sales_invoices
  add column items_read_at timestamptz;

-- A janela coberta existe mesmo quando a listagem completa não encontra nenhuma nota.
create table brsteel_pcp.sales_invoice_sync_state (
  singleton boolean primary key default true check (singleton),
  covered_from date not null,
  covered_to date not null check (covered_to >= covered_from),
  listed_at timestamptz not null
);

alter table brsteel_pcp.sales_invoice_sync_state enable row level security;
revoke all on brsteel_pcp.sales_invoice_sync_state from public;
grant select, insert, update on brsteel_pcp.sales_invoice_sync_state to brsteel_ops_writer;
create policy writer on brsteel_pcp.sales_invoice_sync_state for all to brsteel_ops_writer using (true) with check (true);
grant select on brsteel_pcp.sales_invoice_sync_state to brsteel_ops_reader;
create policy reader on brsteel_pcp.sales_invoice_sync_state for select to brsteel_ops_reader using (true);
grant select on brsteel_pcp.sales_invoice_sync_state to brsteel_ops_backup;
create policy backup_reader on brsteel_pcp.sales_invoice_sync_state for select to brsteel_ops_backup using (true);

commit;
