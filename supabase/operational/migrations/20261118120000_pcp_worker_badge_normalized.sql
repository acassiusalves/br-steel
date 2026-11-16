-- Crachá normalizado (revisão de usuários de 16/11/2026, achado U-04).
--
-- O login e a bipagem comparam o crachá sem espaços e em maiúsculas. O cadastro passa a gravar o código
-- já normalizado, e o banco aceita só esse formato. Com o `unique` que já existe, dois crachás que só
-- diferiam em maiúsculas não cabem mais, e a bipagem nunca inicia a OS no nome da pessoa errada. Zeros à
-- esquerda continuam fazendo parte do código.
begin;

update brsteel_pcp.workers set badge = upper(btrim(badge)) where badge <> upper(btrim(badge));

alter table brsteel_pcp.workers add constraint workers_badge_format check (badge ~ '^[A-Z0-9-]{1,40}$');

commit;
