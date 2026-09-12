import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ getUserById: vi.fn(), createUser: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { admin: api } }) }));
import { getOAuthProvider } from '@/server/oauth/supabase';
const user = { id: 'local-user', name: 'Local', email: 'local@example.test', role: 'Administrador' } as Parameters<ReturnType<typeof getOAuthProvider>['ensureIdentity']>[1];
const staging = 'https://br-steel-mcp-staging.vercel.app';
const production = 'https://br-steel.vercel.app';
function environment(origin: string) {
 vi.stubEnv('APP_ORIGIN', origin); vi.stubEnv('MCP_PUBLIC_URL', `${origin}/api/mcp`);
}
function external(marker?: unknown) { return { data: { user: { id: 'subject', email: user.email, app_metadata: { brsteel_user_id: user.id, ...(marker === undefined ? {} : { brsteel_mcp_resource: marker }) } } }, error: null }; }
beforeEach(() => {
 vi.resetAllMocks(); environment(production); vi.stubEnv('MCP_OAUTH_ENABLED', 'true');
 vi.stubEnv('SUPABASE_URL', 'https://provider.example.test'); vi.stubEnv('SUPABASE_SECRET_KEY', 'secret'); vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'public');
});
afterEach(() => vi.unstubAllEnvs());
it('tags new identities with the configured resource in admin metadata', async () => {
 api.getUserById.mockResolvedValue({ data: { user: null }, error: { status: 404 } });
 api.createUser.mockResolvedValue(external(`${production}/api/mcp`));
 await getOAuthProvider().ensureIdentity('subject', user);
 expect(api.createUser).toHaveBeenCalledWith(expect.objectContaining({ app_metadata: { brsteel_user_id: user.id, brsteel_mcp_resource: `${production}/api/mcp` } }));
});
it('accepts matching resources and rejects cross-environment, malformed and production legacy identities', async () => {
 api.getUserById.mockResolvedValue(external(`${production}/api/mcp`));
 await expect(getOAuthProvider().ensureIdentity('subject', user)).resolves.toMatchObject({ sub: 'subject' });
 for (const marker of [`${staging}/api/mcp`, '', null, 42, undefined]) {
  api.getUserById.mockResolvedValue(external(marker));
  await expect(getOAuthProvider().ensureIdentity('subject', user)).rejects.toMatchObject({ status: 409 });
 }
});
it('allows missing legacy marker only for known staging and loopback', async () => {
 api.getUserById.mockResolvedValue(external());
 for (const origin of [staging, 'http://localhost', 'http://127.0.0.1:3000']) {
  environment(origin); await expect(getOAuthProvider().ensureIdentity('subject', user)).resolves.toMatchObject({ sub: 'subject' });
 }
 environment('https://other.example.test');
 await expect(getOAuthProvider().ensureIdentity('subject', user)).rejects.toMatchObject({ status: 409 });
});
it('ignores forged user metadata and rejects cross-environment identity after a create race', async () => {
 const forged = { ...external(), data: { user: { ...external().data.user, user_metadata: { brsteel_mcp_resource: `${production}/api/mcp` } } } };
 api.getUserById.mockResolvedValue(forged);
 await expect(getOAuthProvider().ensureIdentity('subject', user)).rejects.toMatchObject({ status: 409 });
 api.getUserById.mockResolvedValueOnce({ data: { user: null }, error: { status: 404 } }).mockResolvedValueOnce(external(`${staging}/api/mcp`));
 api.createUser.mockResolvedValue({ data: { user: null }, error: { status: 409 } });
 await expect(getOAuthProvider().ensureIdentity('subject', user)).rejects.toMatchObject({ status: 409 });
});
