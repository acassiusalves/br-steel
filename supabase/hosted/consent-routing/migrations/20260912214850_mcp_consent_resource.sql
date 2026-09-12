-- Hosted BR Steel provider only. No operational tables or OAuth records are changed.
begin;
create function public.brsteel_mcp_consent_resource(p_authorization_id text)
returns text language sql stable security definer
set search_path = ''
set statement_timeout = '3s'
as $function$
  select a.resource
  from auth.oauth_authorizations a
  where p_authorization_id ~ '^[A-Za-z0-9_-]{16,128}$'
    and a.authorization_id = p_authorization_id
    and a.status = 'pending'
    and a.expires_at > now()
    and a.resource in (
      'https://br-steel.vercel.app/api/mcp',
      'https://br-steel-mcp-staging.vercel.app/api/mcp'
    )
  limit 1;
$function$;
revoke all on function public.brsteel_mcp_consent_resource(text) from public, anon, authenticated;
grant execute on function public.brsteel_mcp_consent_resource(text) to service_role;
do $acl$
begin
  if exists (
    select 1 from pg_catalog.pg_proc p,
      lateral pg_catalog.aclexplode(p.proacl) a
    where p.oid = 'public.brsteel_mcp_consent_resource(text)'::regprocedure
      and a.privilege_type = 'EXECUTE'
      and a.grantee not in (p.proowner, 'service_role'::regrole::oid)
  ) then
    raise exception 'Unexpected EXECUTE grant on consent resource lookup';
  end if;
end;
$acl$;
comment on function public.brsteel_mcp_consent_resource(text) is
  'Server-only pre-login consent routing: returns only an allowlisted resource for a pending, unexpired OAuth request. No user data, token, code, or credential is returned.';
commit;
