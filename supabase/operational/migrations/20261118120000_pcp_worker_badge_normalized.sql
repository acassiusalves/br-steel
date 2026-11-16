-- Crachá normalizado (revisão da lógica de usuários de 16/11/2026, achado U-04).
--
-- O código do crachá identifica o login (conta `cracha-<código>`) e quem executa na bipagem do Kanban. O app
-- passa a gravá-lo em maiúsculas, sem espaços nas pontas, só com letras, números e hífen, até 40 caracteres.
-- Antes de aplicar, confira os dados (só leitura):
--   select upper(btrim(badge)), count(*) from brsteel_pcp.workers group by 1 having count(*) > 1;
--   select id from brsteel_pcp.workers where upper(btrim(badge)) !~ '^[A-Z0-9-]{1,40}$';
-- Se dois códigos só diferirem em maiúsculas ou espaços, a atualização viola o `unique` e nada é aplicado.
-- A restrição nasce `not valid`: vale para toda gravação nova, e um código antigo fora do padrão só precisa ser
-- corrigido na próxima edição do funcionário. Depois de corrigir todos, rode
--   alter table brsteel_pcp.workers validate constraint workers_badge_normalized;
begin;

update brsteel_pcp.workers set badge = upper(btrim(badge)), updated_at = now() where badge <> upper(btrim(badge));

alter table brsteel_pcp.workers
  add constraint workers_badge_normalized check (badge ~ '^[A-Z0-9-]{1,40}$') not valid;

commit;
