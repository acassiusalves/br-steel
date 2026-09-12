-- Single read-only catalog query. Contains function code/ACL, no user records or secrets.
-- Save JSON output privately before applying; project identity is enforced by CLI argument.
select jsonb_build_object(
  'expected_project_ref', 'mlumbvxpaqfzpdjnvzxc',
  'captured_at', current_timestamp,
  'function_definition', pg_get_functiondef(p.oid),
  'function_owner', pg_get_userbyid(p.proowner),
  'function_acl', p.proacl::text,
  'schema_owner', pg_get_userbyid(n.nspowner),
  'schema_acl', n.nspacl::text,
  'security_definer', p.prosecdef,
  'function_config', p.proconfig
) as backup
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.oid = to_regprocedure('private.mcp_access_token_hook(jsonb)');
