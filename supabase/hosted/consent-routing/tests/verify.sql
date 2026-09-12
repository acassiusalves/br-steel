-- Disposable local database only: fixtures are rolled back.
begin;
insert into auth.oauth_authorizations (authorization_id,resource,status,expires_at) values
 ('valid-stage-request-0001','https://br-steel-mcp-staging.vercel.app/api/mcp','pending',now()+interval '10 minutes'),
 ('valid-prod-request-0001','https://br-steel.vercel.app/api/mcp','pending',now()+interval '10 minutes'),
 ('expired-stage-request-01','https://br-steel-mcp-staging.vercel.app/api/mcp','pending',now()),
 ('approved-stage-request-1','https://br-steel-mcp-staging.vercel.app/api/mcp','approved',now()+interval '10 minutes'),
 ('unknown-resource-000001','https://attacker.test/api/mcp','pending',now()+interval '10 minutes'),
 ('missing-resource-000001',null,'pending',now()+interval '10 minutes');
set local role service_role;
do $tests$
begin
 if public.brsteel_mcp_consent_resource('valid-stage-request-0001') is distinct from 'https://br-steel-mcp-staging.vercel.app/api/mcp' then raise exception 'Staging route lost'; end if;
 if public.brsteel_mcp_consent_resource('valid-prod-request-0001') is distinct from 'https://br-steel.vercel.app/api/mcp' then raise exception 'Production route lost'; end if;
 if exists(select from unnest(array['expired-stage-request-01','approved-stage-request-1','unknown-resource-000001','missing-resource-000001','not-existing-request-00001','invalid id',null]) id where public.brsteel_mcp_consent_resource(id) is not null) then raise exception 'Invalid authorization accepted'; end if;
 if has_table_privilege(current_user,'auth.oauth_authorizations','SELECT') then raise exception 'Service role obtained authorization table access'; end if;
end $tests$;
reset role;
do $acl$
begin
 if has_function_privilege('anon','public.brsteel_mcp_consent_resource(text)','EXECUTE') or has_function_privilege('authenticated','public.brsteel_mcp_consent_resource(text)','EXECUTE') then raise exception 'Public API role can lookup authorizations'; end if;
 if exists(select from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.brsteel_mcp_consent_resource(text)'::regprocedure and a.privilege_type='EXECUTE' and a.grantee not in(p.proowner,'service_role'::regrole::oid)) then raise exception 'Unexpected lookup caller'; end if;
end $acl$;
rollback;
