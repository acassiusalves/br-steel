-- Only the dedicated local OAuth server invokes this function.
-- OAuth client identity is a provider claim, never user-editable metadata.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;

create or replace function private.mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if nullif(event -> 'claims' ->> 'client_id', '') is not null then
    event := jsonb_set(event, '{claims,aud}', to_jsonb('http://localhost:9003/api/mcp'::text));
  end if;
  return jsonb_build_object('claims', event -> 'claims');
end;
$$;

revoke all on function private.mcp_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function private.mcp_access_token_hook(jsonb) to supabase_auth_admin;
