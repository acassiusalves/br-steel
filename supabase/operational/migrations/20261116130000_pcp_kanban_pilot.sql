-- Kanban de OPs para o piloto (reunião de 13/11/2026).
--
-- 1. Crachá: só o líder opera o quadro (um terminal por operação, sem celular no chão de fábrica). Ao
--    passar o card para uma coluna de operação, ele bipa o crachá de quem vai executar e a OS já começa.
--    As colunas de Check Q/Q são a fila de espera e não pedem crachá.
-- 2. Pausa: a OS em execução pode ser pausada; o tempo pausado conta como espera, não como execução.
-- 3. Exclusão: o administrador encerra uma OP de "A produzir" que foi gerada errada. Ela sai do quadro
--    e de toda conta, mas fica registrada (status "encerrado").
begin;

alter table brsteel_pcp.production_phases
  add column asks_badge boolean not null default true;
update brsteel_pcp.production_phases set asks_badge = false where name ilike 'check%';

create table brsteel_pcp.production_order_step_pauses (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references brsteel_pcp.production_orders(id) on delete cascade,
  step_id uuid not null references brsteel_pcp.production_order_steps(id) on delete cascade,
  paused_at timestamptz not null default now(),
  resumed_at timestamptz,
  paused_by text not null check (length(paused_by) between 1 and 200),
  resumed_by text check (length(resumed_by) between 1 and 200),
  check (resumed_at is null or resumed_at >= paused_at),
  check ((resumed_at is null) = (resumed_by is null))
);
create index production_order_step_pauses_order on brsteel_pcp.production_order_step_pauses (order_id);
-- Uma pausa aberta por OS.
create unique index production_order_step_pauses_open on brsteel_pcp.production_order_step_pauses (step_id) where resumed_at is null;

alter table brsteel_pcp.production_order_events drop constraint production_order_events_kind_check;
alter table brsteel_pcp.production_order_events add constraint production_order_events_kind_check
  check (kind in ('move', 'start', 'finish', 'loss', 'pause', 'resume', 'close'));

alter table brsteel_pcp.production_order_step_pauses enable row level security;
revoke all on brsteel_pcp.production_order_step_pauses from public;
grant select, insert, update, delete on brsteel_pcp.production_order_step_pauses to brsteel_ops_writer;
create policy writer on brsteel_pcp.production_order_step_pauses for all to brsteel_ops_writer using (true) with check (true);
grant select on brsteel_pcp.production_order_step_pauses to brsteel_ops_reader;
create policy reader on brsteel_pcp.production_order_step_pauses for select to brsteel_ops_reader using (true);
grant select on brsteel_pcp.production_order_step_pauses to brsteel_ops_backup;
create policy backup_reader on brsteel_pcp.production_order_step_pauses for select to brsteel_ops_backup using (true);

commit;
