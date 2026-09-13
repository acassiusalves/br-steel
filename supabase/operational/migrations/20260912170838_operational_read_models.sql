-- Local candidate read projections. Existing copies must be rebuilt by the same snapshot.
begin;
alter table brsteel_ops.stock_observations
  add column stock_read jsonb,
  add column observed_at_ms double precision,
  add column observed_sku text collate "C" generated always as (stock_read#>>'{produto,codigo}') stored,
  add column sku_order integer,
  add constraint stock_read_complete check (
    (stock_read is null and observed_at_ms is null and sku_order is null) or
    (stock_read is not null and jsonb_typeof(stock_read)='object' and observed_at_ms is not null and sku_order is not null and sku_order>=0
      and observed_sku is not null and observed_at_ms not in ('Infinity'::double precision,'-Infinity'::double precision,'NaN'::double precision))
  );
create index stock_latest_observation on brsteel_ops.stock_observations(observed_sku,observed_at_ms desc,source_id desc)
  where not source_deleted and stock_read is not null;
create index stock_last_observed_time on brsteel_ops.stock_observations(observed_at_ms desc,source_id)
  where not source_deleted and stock_read is not null;
alter table brsteel_ops.supplies add column lookup_sku text collate "C";
create index supplies_limits_sku on brsteel_ops.supplies(lookup_sku,source_id desc) where not source_deleted;
update brsteel_import.runs set status='loading',next_index=0,completed_at=null
  where id in (select active_run from brsteel_import.state);
update brsteel_import.state set ready=false;
commit;
