// Local-only end-to-end proof. Run with: node --env-file=.env.local --import tsx scripts/oauth-app-verify.mjs
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = parse(readFileSync('.env.oauth.local'));
  assert.equal(env.SUPABASE_URL, 'http://127.0.0.1:55321');
  assert.equal(env.APP_ORIGIN, 'http://localhost:9003');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
  assert.equal(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 'demo-brsteel-auth');
  assert.ok(process.env.AUTH_SESSION_SECRET && process.env.AUTH_SESSION_SECRET.length >= 32);
  Object.assign(process.env, env);
  const { adminDb } = await import('../src/lib/firebase-admin');
  const { hashPassword } = await import('../src/lib/server-auth');
  const { boundIdentity, identityBindingId } = await import('../src/server/oauth/identity-bridge');
  const { validateOAuthAccessToken } = await import('../src/server/oauth/access-token');
  const { getOAuthProvider } = await import('../src/server/oauth/supabase');
  const { requireCapability } = await import('../src/server/access/policy');
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const userId = `oauth-e2e-${randomUUID()}`;
  const email = `${userId}@example.invalid`;
  const password = randomBytes(24).toString('base64url');
  const credential = hashPassword(password);
  const cookieJar = new Map<string, string>();
  const ids: string[] = [];
  let clientId: string | undefined;
  let sub: string | undefined;
  const evidence: Record<string, unknown> = { checkedAt: new Date().toISOString() };
  const callback = 'http://localhost:45454/oauth/callback';
  async function http(url: string, init: RequestInit = {}) {
    assert.ok([env.APP_ORIGIN, env.SUPABASE_URL].includes(new URL(url).origin), 'Refusing nonlocal HTTP');
    const response = await fetch(url, { ...init, redirect: 'manual' });
    const body = await response.text();
    let data: any;
    try { data = JSON.parse(body); } catch { data = null; }
    return { response, data };
  }
  async function app(path: string, method = 'GET', body?: unknown, cookies = true, origin = env.APP_ORIGIN) {
    const result = await http(`${env.APP_ORIGIN}${path}`, {
      method, headers: { origin, 'content-type': 'application/json',
        cookie: cookies ? [...cookieJar].map(([key, value]) => `${key}=${value}`).join('; ') : '' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (cookies) for (const item of result.response.headers.getSetCookie()) {
      const pair = item.split(';')[0]; const index = pair.indexOf('=');
      cookieJar.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return result;
  }
  const discovery = await http(`${env.SUPABASE_URL}/auth/v1/.well-known/oauth-authorization-server`);
  assert.equal(discovery.response.status, 200);
  const metadata = discovery.data;
  async function begin() {
    const verifier = randomBytes(48).toString('base64url');
    const state = randomUUID();
    const query = new URLSearchParams({ response_type: 'code', client_id: clientId!, redirect_uri: callback,
      scope: 'openid email profile offline_access', state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    const result = await http(`${metadata.authorization_endpoint}?${query}`);
    assert.equal(result.response.status, 302);
    const location = new URL(result.response.headers.get('location')!);
    assert.equal(location.origin, env.APP_ORIGIN);
    assert.equal(location.pathname, '/oauth/consent');
    const id = location.searchParams.get('authorization_id')!;
    assert.ok(id); ids.push(id);
    return { id, verifier, state, path: `${location.pathname}${location.search}` };
  }
  async function prepare(request: Awaited<ReturnType<typeof begin>>) {
    const session = await app('/api/mcp-auth/session', 'POST', { authorization_id: request.id, userId: 'attacker', email: 'attacker@example.invalid' });
    assert.equal(session.response.status, 200, `Bridge: ${session.data?.code}`);
    assert.deepEqual(session.data, { ok: true });
    const cookie = session.response.headers.getSetCookie().find(item => item.startsWith('brsteel_oauth_session='))!;
    assert.ok(cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax'));
    assert.ok(cookieJar.get('brsteel_oauth_session')!.split('.').length === 5, 'Bridge cookie is encrypted JWE');
    const details = await app(`/api/mcp-auth/authorization?authorization_id=${request.id}`);
    assert.equal(details.response.status, 200);
    assert.equal(details.data.authorization.client.id, clientId);
    assert.equal(details.data.authorization.redirect_uri, callback);
    assert.equal(details.data.user.email, email);
    assert.ok(details.data.capabilities.some((item: any) => item.key === 'vendas:read'));
  }
  async function decide(request: Awaited<ReturnType<typeof begin>>, decision = 'approve') {
    const result = await app('/api/mcp-auth/decision', 'POST', { authorization_id: request.id, decision, capabilities: decision === 'approve' ? ['vendas:read', 'estoque:read', 'producao:read'] : [] });
    assert.equal(result.response.status, 200, `Decision: ${result.data?.code}`);
    const url = new URL(result.data.redirectUrl);
    assert.equal(`${url.origin}${url.pathname}`, callback);
    assert.equal(url.searchParams.get('state'), request.state);
    return url;
  }
  async function exchange(request: Awaited<ReturnType<typeof begin>>, url: URL) {
    const result = await http(metadata.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId!, redirect_uri: callback, code_verifier: request.verifier, code: url.searchParams.get('code')! }) });
    assert.equal(result.response.status, 200, `Exchange: ${result.data?.error}`);
    return result.data;
  }
  async function refresh(token: string) {
    return http(metadata.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId!, refresh_token: token }) });
  }
  try {
    await adminDb.collection('users').doc(userId).create({ name: 'Teste OAuth HTTP', email, normalizedEmail: email, role: 'Administrador',
      active: true, authVersion: 0, mustChangePassword: true, passwordHash: credential.hash, passwordSalt: credential.salt });
    const registration = await http(metadata.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      client_name: 'BR Steel teste HTTP completo', redirect_uris: [callback], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
    }) });
    assert.equal(registration.response.status, 201); clientId = registration.data.client_id;
    const request = await begin();
    const anonymousPage = await app(request.path, 'GET', undefined, false);
    assert.equal(anonymousPage.response.status, 307);
    const loginUrl = new URL(anonymousPage.response.headers.get('location')!, env.APP_ORIGIN);
    assert.equal(loginUrl.pathname, '/login'); assert.equal(loginUrl.searchParams.get('next'), request.path);
    assert.equal((await app('/api/mcp-auth/session', 'POST', { authorization_id: request.id }, false)).response.status, 401);
    const login = await app('/api/auth/login', 'POST', { email, password });
    assert.equal(login.response.status, 200); assert.ok(login.response.headers.getSetCookie().some(item => item.startsWith('brsteel_oauth_session=;')));
    assert.equal((await app('/api/mcp-auth/session', 'POST', { authorization_id: request.id }, true, 'https://attacker.example')).response.status, 403);
    assert.equal(login.data.user.mustChangePassword, true);
    const setupPage = await app(request.path);
    assert.equal(setupPage.response.status, 307);
    const setupUrl = new URL(setupPage.response.headers.get('location')!, env.APP_ORIGIN);
    assert.equal(setupUrl.pathname, '/perfil'); assert.equal(setupUrl.searchParams.get('next'), request.path);
    assert.equal((await app('/api/mcp-auth/session', 'POST', { authorization_id: request.id })).response.status, 403);
    const setup = await app('/api/auth/profile', 'PATCH', { name: 'Teste OAuth HTTP', newPassword: randomBytes(24).toString('base64url') });
    assert.equal(setup.response.status, 200); assert.equal(setup.data.user.mustChangePassword, false);
    assert.ok(setup.response.headers.getSetCookie().some(item => item.startsWith('brsteel_oauth_session=;')));
    evidence.firstAccessAndSafeReturn = true;

    await prepare(request);
    const identity = await boundIdentity(userId); sub = identity!.sub;
    const normal = await getOAuthProvider().createSession(identity!);
    await assert.rejects(validateOAuthAccessToken(normal.access_token), 'Normal session audience must not authorize MCP');
    await getOAuthProvider().signOut(normal);
    const tokens = await exchange(request, await decide(request));
    const access = await validateOAuthAccessToken(tokens.access_token);
    assert.equal(access.actor.userId, userId); assert.equal(access.actor.clientId, clientId);
    assert.deepEqual(access.capabilities, ['vendas:read', 'estoque:read', 'producao:read']);
    evidence.discoveryDcrPkceLoginConsentCodeToken = true;
    evidence.normalSessionRejected = true;
    const refreshed = await refresh(tokens.refresh_token);
    assert.equal(refreshed.response.status, 200);
    await validateOAuthAccessToken(refreshed.data.access_token);
    evidence.refreshValidated = true;
    await adminDb.collection('users').doc(userId).update({ role: 'Operador' });
    const downgraded = await validateOAuthAccessToken(tokens.access_token);
    assert.equal(downgraded.actor.role, 'Operador');
    assert.throws(() => requireCapability(downgraded, 'vendas:read', '/vendas'));
    await adminDb.collection('users').doc(userId).update({ role: 'Administrador' });
    evidence.currentRoleEnforced = true;
    const repeat = await begin();
    const automatic = await app('/api/mcp-auth/session', 'POST', { authorization_id: repeat.id });
    assert.equal(automatic.response.status, 409); assert.equal(automatic.data.code, 'RECONSENT_REQUIRED');
    assert.ok(!JSON.stringify(automatic.data).includes('redirectUrl'));
    const connections = await app('/api/mcp-auth/connections');
    assert.equal(connections.data.connections.length, 1);
    const connectionId = connections.data.connections[0].id;
    assert.equal((await app('/api/mcp-auth/connections', 'DELETE', { connection_id: connectionId })).response.status, 200);
    for (const token of [tokens.access_token, refreshed.data.access_token]) await assert.rejects(validateOAuthAccessToken(token));
    for (const token of [tokens.refresh_token, refreshed.data.refresh_token]) assert.equal((await refresh(token)).response.status, 400);
    evidence.localAndProviderRevocation = true;
    const next = await begin(); await prepare(next);
    const nextTokens = await exchange(next, await decide(next));
    await validateOAuthAccessToken(nextTokens.access_token);
    for (const token of [tokens.access_token, refreshed.data.access_token]) await assert.rejects(validateOAuthAccessToken(token));
    for (const token of [tokens.refresh_token, refreshed.data.refresh_token]) assert.equal((await refresh(token)).response.status, 400);
    evidence.oldTokensRemainRejectedAfterReconnect = true;
    assert.equal((await app('/api/mcp-auth/connections', 'DELETE', { connection_id: connectionId })).response.status, 200);
    const denied = await begin(); await prepare(denied);
    assert.equal((await decide(denied, 'deny')).searchParams.get('error'), 'access_denied');
    evidence.denialReturnedToClient = true;
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    // Every deletion is confined to the synthetic identities and intents created above.
    for (const id of ids) await adminDb.collection('mcpAuthorizationIntents').doc(id).delete();
    const grants = await adminDb.collection('mcpConnections').where('userId', '==', userId).get();
    for (const doc of grants.docs) await doc.ref.delete();
    sub ??= (await adminDb.collection('mcpIdentityBindings').doc(identityBindingId(userId)).get()).data()?.sub;
    if (sub) { await adminDb.collection('mcpIdentities').doc(sub).delete(); const result = await admin.auth.admin.deleteUser(sub); assert.equal(result.error, null); }
    await adminDb.collection('mcpIdentityBindings').doc(identityBindingId(userId)).delete();
    await adminDb.collection('users').doc(userId).delete();
    if (clientId) { const result = await admin.auth.admin.oauth.deleteClient(clientId); assert.equal(result.error, null); }
    await adminDb.terminate();
  }
}
main().catch(error => { console.error('Local OAuth application verification failed:', error instanceof Error ? error.message : 'unknown error'); process.exitCode = 1; });
