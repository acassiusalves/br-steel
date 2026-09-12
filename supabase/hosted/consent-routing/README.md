# OAuth consent routing

Production and staging share the hosted OAuth provider. Its Site URL remains
`https://br-steel.vercel.app` and its Authorization Path remains `/oauth/consent`.
The application resolves the pending authorization's stored `resource` before
reading the local session or choosing a login screen. Only the two exact BR Steel
MCP resources can select an environment. Missing, expired, used, unknown, and
malformed requests fail closed. Session provisioning checks the resource again.

The server calls `public.brsteel_mcp_consent_resource(text)` with its existing
Supabase secret key. This deliberately runs before user login. Only `service_role`
and the function owner can execute it. It returns an allowlisted resource or null;
it exposes no OAuth token, code, redirect URI, user, or credentials. The service
role receives no direct SELECT privilege on the authorization table.

## Deployment order

1. Apply only `migrations/20260912214850_mcp_consent_resource.sql` to provider
   `mlumbvxpaqfzpdjnvzxc` using the Supabase migration tool. Do not use `db push`
   here: the root `supabase/migrations` directory belongs to the local provider.
2. Verify the function owner is `postgres`, `prosecdef` is true, search_path is
   empty, statement_timeout is 3s, and only owner/service_role have EXECUTE.
   Confirm anon/authenticated cannot execute and service_role still cannot SELECT
   `auth.oauth_authorizations`.
3. Deploy this application change to staging using
   `config/vercel.mcp-staging.json` (no scheduled jobs), and then production.
   Production's consent entry point must be updated because the provider starts
   there. Preserve all existing environment variables, scopes, user access and
   write controls. This change does not migrate operational data.
4. Reconnect the staging connector in Claude. It must reach the staging login or
   consent screen automatically, return to Claude, and execute `Meu acesso`.
   Do not manually edit the authorization URL during this acceptance test.

Rollback the applications to their previous deployment IDs first. The additive
RPC can remain while rolling back. If removing it, only after both apps are rolled
back, apply `drop function public.brsteel_mcp_consent_resource(text);` as a separate
migration. Never alter provider Site URL to recover this change.

## Local verification

`supabase/migrations/20260912215847_mcp_local_consent_resource.sql` is the local-only
equivalent: it permits `http://localhost:9003/api/mcp` and
`http://127.0.0.1:9003/api/mcp`, never the hosted resources. It is applied by the
normal local provider migration chain.

`tests/verify.sql` is only for a disposable fixture database, not the hosted
provider. It needs a minimal `auth.oauth_authorizations` table with text
authorization_id/resource/status and timestamptz expires_at; fixtures roll back.
It verifies valid/expired/used/missing/untrusted resources and privileges using
the service role. Run the hosted migration and this test there; for the local
variant, substitute the two hosted resource literals in this test with the two
local resources respectively. The real hosted Auth schema is verified read-only.

Application regression tests: `npx vitest run tests/access tests/oauth tests/mcp
tests/operations` with the repository's Firestore test emulator running.
