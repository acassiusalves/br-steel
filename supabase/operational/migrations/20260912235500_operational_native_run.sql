-- Native writes belong to no import. A permanent sentinel run gives them a valid import_run_id without
-- pretending they came from a snapshot; the importer excludes this run from reconciliation and comparison.
begin;

insert into brsteel_import.runs (id, source_project, captured_at, status, next_index, total_records, completed_at)
values (repeat('0', 64), 'brsteel-native', '-infinity', 'complete', 0, 0, '-infinity')
on conflict (id) do nothing;

commit;
