-- OPs em andamento trazidas do Kanban do iApp, para o quadro do BR Steel começar com os mesmos cards.
--
-- `iapp_id` é o ID da OP no iApp e torna a carga repetível: rodar de novo atualiza as OPs que ainda não
-- foram mexidas aqui e não duplica nada. `iapp_number` é o número que a equipe conhece (0009664).
--
-- O iApp não informa quem iniciou cada OS nem quando, só o tempo total apontado. Por isso uma OS vinda
-- de lá pode estar em execução ou executada sem funcionário e sem horário de início (`imported`).
begin;

alter table brsteel_pcp.production_orders
  add column iapp_id bigint unique,
  add column iapp_number text check (length(iapp_number) between 1 and 30),
  add column planned_start timestamptz,
  add column planned_end timestamptz;

alter table brsteel_pcp.production_order_steps
  add column imported boolean not null default false;

alter table brsteel_pcp.production_order_steps drop constraint production_order_steps_timeline;
alter table brsteel_pcp.production_order_steps add constraint production_order_steps_timeline check (
  (status = 'aberto' and worker_id is null and started_at is null and finished_at is null)
  or (status = 'em_execucao' and finished_at is null
      and ((worker_id is not null and started_at is not null) or (imported and worker_id is null and started_at is null)))
  or (status = 'executada'
      and ((worker_id is not null and started_at is not null and finished_at is not null and finished_at >= started_at)
        or (imported and worker_id is null and started_at is null))));

commit;
