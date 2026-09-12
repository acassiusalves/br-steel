import { actor, AUTH_ID, oauthFixture, provider, req } from '../helpers/oauth-provider';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ConsentPage from '@/app/oauth/consent/page';
import { POST as establish } from '@/app/api/mcp-auth/session/route';
import { adminDb, cookieJar } from '../helpers/firestore';
import { createSessionToken } from '@/lib/server-auth';
import * as headers from 'next/headers';
const production = 'https://br-steel.vercel.app';
const staging = 'https://br-steel-mcp-staging.vercel.app';
const next = `/oauth/consent?authorization_id=${AUTH_ID}`;
function environment(origin: string) {
  vi.stubEnv('APP_ORIGIN', origin); vi.stubEnv('MCP_PUBLIC_URL', `${origin}/api/mcp`);
}
beforeEach(async () => {
  await oauthFixture();
  environment(production);
  provider.getAuthorizationResource.mockResolvedValue(`${staging}/api/mcp`);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
// Catch the current bug: a staging request must leave production before reading its login session.
it('routes the stored staging resource before using a production login', async () => {
  const cookies = vi.spyOn(headers, 'cookies');
  cookieJar.value = createSessionToken(actor);
  await expect(ConsentPage({ searchParams: Promise.resolve({ authorization_id: AUTH_ID }) }))
    .rejects.toMatchObject({ digest: `NEXT_REDIRECT;replace;${staging}${next};307;` });
  expect(cookies).not.toHaveBeenCalled();
});
it.each([production, staging])('keeps a matching resource on its own login origin: %s', async origin => {
  environment(origin); provider.getAuthorizationResource.mockResolvedValue(`${origin}/api/mcp`);
  await expect(ConsentPage({ searchParams: Promise.resolve({ authorization_id: AUTH_ID }) }))
    .rejects.toMatchObject({ digest: `NEXT_REDIRECT;replace;/login?next=${encodeURIComponent(next)};307;` });
});
it('routes a production request arriving at staging to the fixed production origin', async () => {
  environment(staging); provider.getAuthorizationResource.mockResolvedValue(`${production}/api/mcp`);
  await expect(ConsentPage({ searchParams: Promise.resolve({ authorization_id: AUTH_ID }) }))
    .rejects.toMatchObject({ digest: `NEXT_REDIRECT;replace;${production}${next};307;` });
});
it.each([null, '', 'https://attacker.test/api/mcp', `${staging}/api/mcp?next=https://attacker.test`, `${staging}/api/mcp/`])
('refuses missing, expired or unsupported resources instead of falling back to production: %s', async resource => {
  provider.getAuthorizationResource.mockResolvedValue(resource);
  const html = renderToStaticMarkup(await ConsentPage({ searchParams: Promise.resolve({ authorization_id: AUTH_ID }) }));
  expect(html).toContain('role="status"'); expect(html).not.toContain('attacker');
});
it('does not disclose provider failures or continue to login after lookup failure', async () => {
  const cookies = vi.spyOn(headers, 'cookies');
  provider.getAuthorizationResource.mockRejectedValue(new Error('private-provider-payload'));
  const html = renderToStaticMarkup(await ConsentPage({ searchParams: Promise.resolve({ authorization_id: AUTH_ID }) }));
  expect(html).toContain('role="status"'); expect(html).not.toContain('private-provider-payload');
  expect(cookies).not.toHaveBeenCalled();
});
it('rejects cross-environment session provisioning before creating any identity', async () => {
  environment('http://localhost');
  const response = await establish(req('session', { authorization_id: AUTH_ID }));
  expect(response.status).toBe(400);
  expect((await adminDb.collection('mcpIdentities').get()).size).toBe(0);
  expect(provider.ensureIdentity).not.toHaveBeenCalled();
});
