begin;
alter table brsteel_import.state add column captured_at timestamptz, add column completed_at timestamptz;
update brsteel_import.state s set captured_at=r.captured_at,completed_at=r.completed_at
from brsteel_import.runs r where r.id=s.active_run;
alter table brsteel_import.state add constraint ready_copy_metadata check (
  not ready or (captured_at is not null and completed_at is not null and captured_at <= completed_at)
);
commit;
