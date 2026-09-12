-- Emergency audience-only rollback; compare backup before use. Disable production MCP/OAuth first.
-- ONLY Supabase mlumbvxpaqfzpdjnvzxc; explicit project selection is mandatory.
-- Single atomic statement, compatible with supabase db query's prepared statement.
-- Requires the existing private staging hook; never creates a schema or grants access.
do $deploy$
declare
  prior_owner oid;
  prior_acl aclitem[];
  prior_schema_owner oid;
  prior_schema_acl aclitem[];
begin
declare
  hook_oid oid := to_regprocedure('private.mcp_access_token_hook(jsonb)');
  api_role text;
  hook record;
begin
  if hook_oid is null then
    raise exception 'Hosted MCP audience hook is missing';
  end if;
  select * into strict hook from pg_proc where oid = hook_oid;
  if hook.prosecdef then
    raise exception 'Hook must be SECURITY INVOKER';
  end if;
  if hook.provolatile <> 's' or hook.prorettype <> 'jsonb'::regtype then
    raise exception 'Hook must be STABLE and return jsonb';
  end if;
  if not coalesce(hook.proconfig @> array['search_path=""'], false) then
    raise exception 'Hook must have an empty search_path';
  end if;
  if exists (
    select 1 from aclexplode(coalesce(hook.proacl, acldefault('f', hook.proowner))) a
    where a.privilege_type = 'EXECUTE'
      and (a.grantee not in (hook.proowner, 'supabase_auth_admin'::regrole::oid)
        or (a.grantee = 'supabase_auth_admin'::regrole::oid and a.is_grantable))
  ) then
    raise exception 'Only the owner and Auth admin may execute the hook; Auth admin cannot delegate';
  end if;
  if exists (
    select 1 from pg_namespace n,
      lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
    where n.nspname = 'private' and a.grantee = 0
  ) then
    raise exception 'PUBLIC must not have private schema access';
  end if;
  foreach api_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(api_role, hook_oid, 'EXECUTE') then
      raise exception 'API role % must not execute the hook', api_role;
    end if;
    if has_schema_privilege(api_role, 'private', 'USAGE')
      or has_schema_privilege(api_role, 'private', 'CREATE') then
      raise exception 'API role % must not access the private hook schema', api_role;
    end if;
  end loop;
  if not has_schema_privilege('supabase_auth_admin', 'private', 'USAGE')
    or not has_function_privilege('supabase_auth_admin', hook_oid, 'EXECUTE') then
    raise exception 'Auth admin needs schema USAGE and hook EXECUTE';
  end if;
  if has_schema_privilege('supabase_auth_admin', 'private', 'CREATE') then
    raise exception 'Auth admin must not create objects in the private schema';
  end if;
end;

  select proowner, proacl into strict prior_owner, prior_acl
    from pg_proc where oid = 'private.mcp_access_token_hook(jsonb)'::regprocedure;
  select nspowner, nspacl into strict prior_schema_owner, prior_schema_acl
    from pg_namespace where nspname = 'private';
  execute $definition$
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
$hook$
$definition$;
  if exists (
    select 1 from pg_proc where oid = 'private.mcp_access_token_hook(jsonb)'::regprocedure
      and (proowner is distinct from prior_owner or proacl is distinct from prior_acl)
  ) or exists (
    select 1 from pg_namespace where nspname = 'private'
      and (nspowner is distinct from prior_schema_owner or nspacl is distinct from prior_schema_acl)
  ) then
    raise exception 'Owner or ACL changed; aborting audience replacement';
  end if;
end;
$deploy$;
