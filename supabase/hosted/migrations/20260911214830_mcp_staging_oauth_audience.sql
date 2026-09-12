-- Hosted BR Steel MCP staging only: Supabase mlumbvxpaqfzpdjnvzxc.
-- Audience is the verified canonical Vercel origin plus /api/mcp.
-- Run inventory.sql and review existing Auth hooks/OAuth consumers before applying.
-- Execute this entire migration atomically; no local migration or config is changed.

-- Do not revoke schema access that another application might currently depend on.
-- Existing tables are permitted; existing API access to this private schema needs review.
do $preflight$
declare
  private_oid oid := to_regnamespace('private');
  hook_oid oid := to_regprocedure('private.mcp_access_token_hook(jsonb)');
  api_role text;
begin
  if private_oid is not null then
    foreach api_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_schema_privilege(api_role, private_oid, 'USAGE')
        or has_schema_privilege(api_role, private_oid, 'CREATE') then
        raise exception 'Existing private schema grants access to %; inspect consumers before adapting this migration', api_role;
      end if;
    end loop;
    if has_schema_privilege('supabase_auth_admin', private_oid, 'CREATE') then
      raise exception 'Existing Auth admin CREATE privilege on private schema requires review';
    end if;
  end if;
  if hook_oid is not null and exists (
    select 1 from pg_proc p,
      lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = hook_oid and a.grantee not in (
      0, p.proowner, 'anon'::regrole::oid, 'authenticated'::regrole::oid,
      'service_role'::regrole::oid, 'supabase_auth_admin'::regrole::oid
    )
  ) then
    raise exception 'Existing MCP hook has grants to other roles; inspect consumers before replacement';
  end if;
end;
$preflight$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to supabase_auth_admin;

-- OAuth identity is the Auth provider claims.client_id, never user metadata.
-- This applies to every OAuth client in this project, including token refresh.
-- Review any existing OAuth clients before enabling this global Auth hook.
create or replace function private.mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $hook$
begin
  if nullif(event -> 'claims' ->> 'client_id', '') is not null then
    event := jsonb_set(event, '{claims,aud}', to_jsonb('https://br-steel-mcp-staging.vercel.app/api/mcp'::text));
  end if;
  return jsonb_build_object('claims', event -> 'claims');
end;
$hook$;

revoke all on function private.mcp_access_token_hook(jsonb) from public, anon, authenticated, service_role;
revoke grant option for execute on function private.mcp_access_token_hook(jsonb) from supabase_auth_admin;
grant execute on function private.mcp_access_token_hook(jsonb) to supabase_auth_admin;
