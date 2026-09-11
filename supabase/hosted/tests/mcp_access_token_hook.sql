-- Project: mlumbvxpaqfzpdjnvzxc. Run the entire file after the hosted migration.
-- SQL Editor role: postgres (must be able to SET ROLE supabase_auth_admin).
-- Read-only transaction: no users, sessions, tables, or configuration are changed.
-- A failed assertion is an error; execute ROLLBACK if the client stops on error.
begin read only;
set local statement_timeout = '15s';

do $acl$
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
$acl$;

-- Exercise the real invoker privileges used by Supabase Auth.
set local role supabase_auth_admin;

do $audience$
declare
  base_claims jsonb := '{
    "iss":"https://mlumbvxpaqfzpdjnvzxc.supabase.co/auth/v1",
    "aud":"authenticated","exp":1790000900,"iat":1790000000,
    "sub":"00000000-0000-4000-8000-000000000001",
    "role":"authenticated","aal":"aal1",
    "session_id":"00000000-0000-4000-8000-000000000002",
    "email":"oauth-test@example.invalid","phone":"","is_anonymous":false,
    "app_metadata":{"source":"fixture"},"user_metadata":{"label":"fixture"},
    "amr":[{"method":"password","timestamp":1790000000}]
  }'::jsonb;
  claims jsonb;
  result jsonb;
  method text;
  candidate jsonb;
begin
  -- Both the initial OAuth exchange and refresh must get the hosted resource.
  foreach method in array array['oauth_provider/authorization_code', 'token_refresh'] loop
    claims := base_claims || '{"client_id":"00000000-0000-4000-8000-000000000003"}'::jsonb;
    result := private.mcp_access_token_hook(jsonb_build_object(
      'user_id', base_claims ->> 'sub', 'claims', claims, 'authentication_method', method));
    if result -> 'claims' ->> 'aud' is distinct from 'https://br-steel-mcp-staging.vercel.app/api/mcp' then
      raise exception 'OAuth % did not receive the hosted MCP audience', method;
    end if;
    if (result -> 'claims') - 'aud' is distinct from claims - 'aud' then
      raise exception 'OAuth % changed claims other than audience', method;
    end if;
    if result - 'claims' <> '{}'::jsonb then
      raise exception 'Hook output must contain only claims';
    end if;
  end loop;

  -- Normal sessions, including refresh and provider-like method strings, stay intact.
  foreach method in array array['password', 'token_refresh', 'oauth_provider/authorization_code'] loop
    result := private.mcp_access_token_hook(jsonb_build_object(
      'user_id', base_claims ->> 'sub', 'claims', base_claims, 'authentication_method', method));
    if result is distinct from jsonb_build_object('claims', base_claims) then
      raise exception 'Session without provider client_id was changed for %', method;
    end if;
  end loop;

  -- Empty and JSON-null provider client IDs do not establish an OAuth identity.
  foreach candidate in array array['""'::jsonb, 'null'::jsonb] loop
    claims := base_claims || jsonb_build_object('client_id', candidate);
    result := private.mcp_access_token_hook(jsonb_build_object(
      'claims', claims, 'authentication_method', 'token_refresh'));
    if result is distinct from jsonb_build_object('claims', claims) then
      raise exception 'Empty/null provider client_id must preserve all claims';
    end if;
  end loop;

  -- User-editable metadata cannot select the audience, even on a refresh.
  claims := base_claims || '{"user_metadata":{"client_id":"forged-provider-client","aud":"https://attacker.invalid/api/mcp"}}'::jsonb;
  result := private.mcp_access_token_hook(jsonb_build_object(
    'claims', claims, 'authentication_method', 'token_refresh', 'client_id', 'top-level-forged-client'));
  if result is distinct from jsonb_build_object('claims', claims) then
    raise exception 'Metadata or top-level client_id must not act as provider claims.client_id';
  end if;

  -- Preserve non-default audiences for sessions that are not OAuth provider sessions.
  claims := base_claims || '{"aud":"existing-session-audience"}'::jsonb;
  result := private.mcp_access_token_hook(jsonb_build_object('claims', claims));
  if result is distinct from jsonb_build_object('claims', claims) then
    raise exception 'Existing non-OAuth audience was overwritten';
  end if;
end;
$audience$;

reset role;
select 'PASS: hosted OAuth audience, claim preservation, and hook ACL checks' as verification;
rollback;
