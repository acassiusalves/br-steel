-- Single DO for CLI; no persistent writes, role changes, grants, or user-data reads.
-- Catalog checks establish permissions; this is NOT proof of real Auth invocation.
do $verify$
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

declare
  production constant text := 'https://br-steel.vercel.app/api/mcp';
  staging constant text := 'https://br-steel-mcp-staging.vercel.app/api/mcp';
  base jsonb := '{"iss":"https://mlumbvxpaqfzpdjnvzxc.supabase.co/auth/v1","aud":"authenticated","exp":1790000900,"iat":1790000000,"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"00000000-0000-4000-8000-000000000002","email":"fixture@example.invalid","phone":"","is_anonymous":false,"app_metadata":{"source":"fixture"}}';
  method text;
  marker jsonb;
  metadata jsonb;
  claims jsonb;
  result jsonb;
  expected text;
  client jsonb;
  audience jsonb;
  rejected boolean;
begin
  foreach method in array array['oauth_provider/authorization_code', 'token_refresh'] loop
    -- Missing app_metadata, absent key, null, empty, and exact staging all mean legacy staging.
    foreach metadata in array array[
      'null'::jsonb, '{}'::jsonb,
      '{"brsteel_mcp_resource":null}'::jsonb, '{"brsteel_mcp_resource":""}'::jsonb,
      jsonb_build_object('brsteel_mcp_resource', staging),
      jsonb_build_object('brsteel_mcp_resource', production)
    ] loop
      claims := base || jsonb_build_object('client_id', 'provider-client', 'app_metadata', metadata,
        'aud', jsonb_build_array(production, staging),
        'user_metadata', jsonb_build_object('brsteel_mcp_resource', production, 'aud', production));
      if metadata = 'null'::jsonb then claims := claims - 'app_metadata'; end if;
      expected := case when metadata ->> 'brsteel_mcp_resource' = production then production else staging end;
      result := private.mcp_access_token_hook(jsonb_build_object('claims', claims, 'authentication_method', method));
      if result is distinct from jsonb_build_object('claims', claims || jsonb_build_object('aud', expected)) then
        raise exception 'OAuth % audience/claim preservation failure for metadata %', method, metadata;
      end if;
      if jsonb_typeof(result #> '{claims,aud}') <> 'string' then
        raise exception 'OAuth audience must be a single string, never an array';
      end if;
    end loop;
    -- Reject unknown strings and malformed nonempty marker types, including resource arrays.
    foreach marker in array array[
      '"https://attacker.invalid/api/mcp"'::jsonb, '" "'::jsonb,
      to_jsonb(production || '/'), '42'::jsonb, 'false'::jsonb,
      '{}'::jsonb, jsonb_build_array(production, staging)
    ] loop
      claims := base || jsonb_build_object('client_id', 'provider-client', 'app_metadata',
        jsonb_build_object('brsteel_mcp_resource', marker));
      rejected := false;
      begin
        perform private.mcp_access_token_hook(jsonb_build_object('claims', claims, 'authentication_method', method));
      exception when sqlstate '22023' then rejected := true;
      end;
      if not rejected then raise exception 'Unknown resource accepted for %: %', method, marker; end if;
    end loop;
  end loop;
  -- All normal-token claims are JSONB-identical, even with malicious metadata/method/top-level client_id.
  foreach method in array array['password', 'token_refresh', 'oauth_provider/authorization_code'] loop
    foreach client in array array['null'::jsonb, '""'::jsonb, '"absent"'::jsonb] loop
      foreach audience in array array['"authenticated"'::jsonb, '"existing-audience"'::jsonb, '["existing-a","existing-b"]'::jsonb] loop
        claims := base || jsonb_build_object('client_id', client, 'aud', audience,
          'app_metadata', jsonb_build_object('brsteel_mcp_resource', 'unknown-resource'),
          'user_metadata', jsonb_build_object('client_id', 'forged', 'brsteel_mcp_resource', production));
        if client = '"absent"'::jsonb then claims := claims - 'client_id'; end if;
        result := private.mcp_access_token_hook(jsonb_build_object('claims', claims,
          'client_id', 'forged-top-level', 'authentication_method', method));
        if result is distinct from jsonb_build_object('claims', claims) then
          raise exception 'Normal token changed for %, client %, audience %', method, client, audience;
        end if;
      end loop;
    end loop;
  end loop;
end;
  raise notice 'PASS: audience and ACL assertions as caller %; real Auth issuance remains separate', current_user;
end;
$verify$;
