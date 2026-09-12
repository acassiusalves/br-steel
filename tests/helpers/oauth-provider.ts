import { vi } from 'vitest';
import { createSessionToken, hashPassword } from '@/lib/server-auth';
import { resetDatabase, seedUser } from './firestore';

const mocks = vi.hoisted(() => ({
  getAuthorizationResource: vi.fn(), ensureIdentity: vi.fn(), createSession: vi.fn(), getUser: vi.fn(),
  getAuthorizationDetails: vi.fn(), approveAuthorization: vi.fn(), denyAuthorization: vi.fn(),
  revokeGrant: vi.fn(), signOut: vi.fn(),
}));
vi.mock('@/server/oauth/supabase', () => ({ getOAuthProvider: () => mocks }));
export const provider = mocks;
export const AUTH_ID = 'sq3ajqf4ksqdun6yxstzoxwec5d7br2p';
export const CLIENT_ID = 'bbbb0000-0000-4000-8000-000000000001';
export const actor = { id: 'oauth-user', name: 'OAuth Test', email: 'oauth@example.test', role: 'Administrador' };
export async function oauthFixture() {
  await resetDatabase();
  vi.stubEnv('MCP_OAUTH_ENABLED', 'true');
  vi.stubEnv('MCP_WRITES_ENABLED', 'true');
  vi.stubEnv('MCP_PUBLIC_URL', 'http://localhost/api/mcp');
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:55321');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-public-key');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'test-secret-key');
  const { hash, salt } = hashPassword('test-individual-password');
  await seedUser(actor.id, { ...actor, passwordHash: hash, passwordSalt: salt });
  for (const mock of Object.values(provider)) mock.mockReset();
  provider.getAuthorizationResource.mockImplementation(async () => process.env.MCP_PUBLIC_URL);
  provider.ensureIdentity.mockImplementation(async (sub, user) => ({ sub, email: user.email }));
  provider.createSession.mockImplementation(async (identity) => ({
    sub: identity.sub, access_token: 'private-access-token', refresh_token: 'private-refresh-token', expires_at: Math.floor(Date.now() / 1000) + 900,
  }));
  provider.getUser.mockImplementation(async session => ({ sub: session.sub }));
  provider.getAuthorizationDetails.mockImplementation(async (session, id) => ({
    authorization_id: id, client: { id: CLIENT_ID, name: 'Claude de teste', uri: 'https://client.example.test', logo_uri: '' },
    user: { id: session.sub, email: actor.email }, redirect_uri: 'https://client.example.test/callback', scope: 'openid email profile',
  }));
  provider.approveAuthorization.mockResolvedValue('https://client.example.test/callback?code=private-code&state=test-state');
  provider.denyAuthorization.mockResolvedValue('https://client.example.test/callback?error=access_denied&state=test-state');
  provider.revokeGrant.mockResolvedValue(undefined);
  provider.signOut.mockResolvedValue(undefined);
}
export function req(path: string, body?: unknown, cookie = `brsteel_session=${createSessionToken(actor)}`, origin = 'http://localhost') {
  return new Request(`http://localhost/api/mcp-auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
