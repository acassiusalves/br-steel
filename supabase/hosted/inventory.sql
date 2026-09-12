-- Read-only catalog inventory for Supabase project mlumbvxpaqfzpdjnvzxc.
-- Run as postgres. This single SELECT works with the CLI Management API query.
-- It reads no application rows, passwords, access tokens, or client secrets.
-- Inspect Auth settings, current custom token hook, users and OAuth clients separately.
with hook as (
  select p.* from pg_proc p
  where p.oid = to_regprocedure('private.mcp_access_token_hook(jsonb)')
), inventory as (
  select 1 as sort_order, 'connection'::text as section,
    jsonb_build_object(
      'database', current_database(), 'role', current_user,
      'server_version', current_setting('server_version'),
      'expected_project_ref', 'mlumbvxpaqfzpdjnvzxc',
      'project_identity_note', 'Verify project ref in the dashboard or CLI flag; database name does not prove project identity',
      'pgrst_db_schemas_session_setting', current_setting('pgrst.db_schemas', true)
    ) as details
  union all
  select 2, 'schemas', coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'owner', pg_get_userbyid(n.nspowner), 'acl', n.nspacl
  ) order by n.nspname), '[]'::jsonb)
  from pg_namespace n where n.nspname in ('public', 'private', 'auth', 'supabase_migrations')
  union all
  select 3, 'api_and_auth_schema_privileges', coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'role', r.rolname,
    'usage', has_schema_privilege(r.oid, n.oid, 'USAGE'),
    'create', has_schema_privilege(r.oid, n.oid, 'CREATE')
  ) order by n.nspname, r.rolname), '[]'::jsonb)
  from pg_namespace n cross join pg_roles r
  where n.nspname in ('public', 'private')
    and r.rolname in ('anon', 'authenticated', 'service_role', 'supabase_auth_admin')
  union all
  select 4, 'existing_public_private_relations', coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'name', c.relname, 'kind', c.relkind,
    'owner', pg_get_userbyid(c.relowner), 'rls_enabled', c.relrowsecurity,
    'rls_forced', c.relforcerowsecurity, 'acl', c.relacl
  ) order by n.nspname, c.relname), '[]'::jsonb)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
  union all
  select 5, 'existing_public_private_functions', coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'name', p.proname,
    'arguments', pg_get_function_identity_arguments(p.oid),
    'owner', pg_get_userbyid(p.proowner), 'security_definer', p.prosecdef,
    'settings', p.proconfig, 'acl', p.proacl
  ) order by n.nspname, p.proname, p.oid), '[]'::jsonb)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
  union all
  select 6, 'existing_hook_definition', coalesce(jsonb_agg(jsonb_build_object(
    'definition', pg_get_functiondef(h.oid), 'owner', pg_get_userbyid(h.proowner), 'acl', h.proacl
  )), '[]'::jsonb) from hook h
  union all
  select 7, 'existing_hook_dependents', coalesce(jsonb_agg(jsonb_build_object(
    'dependent', pg_describe_object(d.classid, d.objid, d.objsubid), 'dependency_type', d.deptype
  )), '[]'::jsonb)
  from pg_depend d join hook h on d.refclassid = 'pg_proc'::regclass and d.refobjid = h.oid
  union all
  select 8, 'default_privileges', coalesce(jsonb_agg(jsonb_build_object(
    'owner', pg_get_userbyid(d.defaclrole),
    'schema', case when d.defaclnamespace = 0 then '(all schemas)' else n.nspname end,
    'object_type', d.defaclobjtype, 'acl', d.defaclacl
  )), '[]'::jsonb)
  from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
  where d.defaclnamespace = 0 or n.nspname in ('public', 'private')
  union all
  select 9, 'auth_and_migration_relation_columns', coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'relation', c.relname, 'column', a.attname,
    'type', format_type(a.atttypid, a.atttypmod)
  ) order by n.nspname, c.relname, a.attnum), '[]'::jsonb)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where (n.nspname = 'auth' and c.relname in ('users', 'oauth_clients', 'oauth_authorizations'))
    or (n.nspname = 'supabase_migrations' and c.relname = 'schema_migrations')
)
select section, details from inventory order by sort_order;
