-- CLI 2.114.0 db query uses one prepared statement; use psql for this transaction:
-- docker exec -i supabase_db_brsteel-mcp-oauth sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U supabase_auth_admin -d postgres -v ON_ERROR_STOP=1' < supabase/tests/mcp_access_token_hook.sql
begin;
do $$
begin
  if has_function_privilege('anon', 'private.mcp_access_token_hook(jsonb)', 'execute')
    or has_function_privilege('authenticated', 'private.mcp_access_token_hook(jsonb)', 'execute')
    or has_function_privilege('service_role', 'private.mcp_access_token_hook(jsonb)', 'execute') then
    raise exception 'Application API roles must not execute the hook';
  end if;
  if not has_function_privilege('supabase_auth_admin', 'private.mcp_access_token_hook(jsonb)', 'execute') then
    raise exception 'Auth admin must be able to execute the hook';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'mcp_access_token_hook' and p.prosecdef) then
    raise exception 'Hook must be security invoker';
  end if;
  if exists (select 1 from pg_tables where schemaname in ('public', 'private')) then
    raise exception 'Dedicated identity provider must contain no operational tables';
  end if;
end;
$$;

do $$
declare
  result jsonb;
begin
  result := private.mcp_access_token_hook('{"claims":{"aud":"authenticated","user_metadata":{"client_id":"untrusted"}},"authentication_method":"token_refresh"}'::jsonb);
  if result -> 'claims' ->> 'aud' <> 'authenticated' then
    raise exception 'Normal session audience must be preserved; user metadata is not OAuth identity';
  end if;
  result := private.mcp_access_token_hook('{"claims":{"aud":"authenticated","client_id":"provider-client"},"authentication_method":"token_refresh"}'::jsonb);
  if result -> 'claims' ->> 'aud' <> 'http://localhost:9003/api/mcp' then
    raise exception 'OAuth refresh must receive the MCP resource audience';
  end if;
  result := private.mcp_access_token_hook('{"claims":{"aud":"authenticated","client_id":"provider-client"},"authentication_method":"oauth_provider/authorization_code"}'::jsonb);
  if result -> 'claims' ->> 'aud' <> 'http://localhost:9003/api/mcp' then
    raise exception 'OAuth code exchange must receive the MCP resource audience';
  end if;
end;
$$;
rollback;
