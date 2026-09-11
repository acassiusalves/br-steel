#!/usr/bin/env node
// Real, local-only provider contract test. Synthetic user/client are deleted afterward.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose';

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const env = Object.fromEntries(readFileSync('.env.oauth.local', 'utf8').split('\n')
  .filter((line) => line.includes('=') && !line.startsWith('#'))
  .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
assert.equal(env.SUPABASE_URL, 'http://127.0.0.1:55321', 'Refusing non-local Supabase');
assert.equal(env.MCP_PUBLIC_URL, 'http://localhost:9003/api/mcp');
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, options);
const sessionClient = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, options);
const reservedId = randomUUID();
const email = `oauth-provider-${reservedId}@example.invalid`;
const callback = 'http://localhost:45454/oauth/callback';
let clientId;
const evidence = { checkedAt: new Date().toISOString() };
function requireSuccess(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.code ?? result.error.name} (${result.error.status ?? 'unknown'})`);
  return result.data;
}
async function http(url, options = {}) {
  assert.equal(new URL(url).origin, env.SUPABASE_URL, 'Refusing non-local request');
  const response = await fetch(url, { redirect: 'manual', ...options });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = {}; }
  return { status: response.status, body, location: response.headers.get('location') };
}
const metadataResponse = await http(`${env.SUPABASE_URL}/auth/v1/.well-known/oauth-authorization-server`);
assert.equal(metadataResponse.status, 200);
const metadata = metadataResponse.body;
assert.equal(metadata.issuer, `${env.SUPABASE_URL}/auth/v1`);
const jwks = createRemoteJWKSet(new URL(metadata.jwks_uri));
async function validate(token, aud = env.MCP_PUBLIC_URL) {
  const result = await jwtVerify(token, jwks, { algorithms: ['ES256'], issuer: metadata.issuer, audience: aud });
  assert.equal(result.payload.sub, reservedId);
  assert.equal(result.payload.exp - result.payload.iat, 900);
  if (aud === env.MCP_PUBLIC_URL) assert.equal(result.payload.client_id, clientId);
  else assert.equal(result.payload.client_id, undefined);
  return result.payload;
}
async function begin({ prompt, redirect = callback } = {}) {
  const verifier = randomBytes(48).toString('base64url');
  const params = new URLSearchParams({ response_type: 'code', client_id: clientId,
    redirect_uri: redirect, scope: 'openid profile email offline_access', state: randomUUID(),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  if (prompt) params.set('prompt', prompt);
  const response = await http(`${metadata.authorization_endpoint}?${params}`);
  if (redirect !== callback) return response;
  assert.equal(response.status, 302, `Authorize HTTP status ${response.status}: ${response.body.error ?? 'unknown'}`);
  const location = new URL(response.location);
  assert.equal(location.origin, 'http://localhost:9003');
  assert.equal(location.pathname, '/oauth/consent');
  const id = location.searchParams.get('authorization_id');
  assert.ok(id);
  return { id, verifier, state: params.get('state') };
}
async function details(request) {
  return requireSuccess(await sessionClient.auth.oauth.getAuthorizationDetails(request.id), 'Authorization details');
}
async function authorize(request, existingDetails) {
  const detail = existingDetails ?? await details(request);
  const response = detail.redirect_url ? detail : requireSuccess(
    await sessionClient.auth.oauth.approveAuthorization(request.id, { skipBrowserRedirect: true }), 'Approve');
  const redirect = new URL(response.redirect_url);
  assert.equal(`${redirect.origin}${redirect.pathname}`, callback);
  assert.equal(redirect.searchParams.get('state'), request.state);
  assert.ok(redirect.searchParams.get('code'));
  return redirect.searchParams.get('code');
}
async function exchange(code, verifier, redirect = callback) {
  return http(metadata.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId,
      redirect_uri: redirect, code_verifier: verifier, code }) });
}
async function refresh(token) {
  return http(metadata.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: token }) });
}

try {
  const user = requireSuccess(await admin.auth.admin.createUser({ id: reservedId, email,
    password: randomBytes(32).toString('base64url'), email_confirm: true,
    app_metadata: { brsteel_user_id: `synthetic-${reservedId}` } }), 'Create synthetic identity').user;
  assert.equal(user.id, reservedId);
  evidence.reservedIdentityIdAccepted = true;
  const link = requireSuccess(await admin.auth.admin.generateLink({ type: 'magiclink', email }), 'Generate OTP link');
  const bridge = requireSuccess(await sessionClient.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token }), 'Consume OTP');
  await validate(bridge.session.access_token, 'authenticated');
  const normalRefresh = requireSuccess(await sessionClient.auth.refreshSession(), 'Refresh normal session');
  await validate(normalRefresh.session.access_token, 'authenticated');
  evidence.normalSessionAudience = 'authenticated';

  const registration = await http(metadata.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'BR Steel synthetic provider verification', redirect_uris: [callback],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
  assert.equal(registration.status, 201, `DCR status ${registration.status}: ${registration.body.error ?? 'unknown'}`);
  clientId = registration.body.client_id;
  assert.ok(clientId);
  assert.equal(registration.body.token_endpoint_auth_method, 'none');
  evidence.dynamicRegistration = true;

  const request = await begin();
  const detail = await details(request);
  assert.equal(detail.client.id, clientId);
  assert.equal(detail.redirect_uri, callback);
  assert.equal(detail.redirect_url, undefined);
  const code = await authorize(request, detail);
  const tokens = await exchange(code, request.verifier);
  assert.equal(tokens.status, 200, `Token exchange ${tokens.status}: ${tokens.body.error ?? 'unknown'}`);
  const claims = await validate(tokens.body.access_token);
  evidence.oauthClaims = { alg: 'ES256', iss: claims.iss, aud: claims.aud,
    sub: claims.sub, client_id: claims.client_id, iat: claims.iat, exp: claims.exp, expiresIn: claims.exp - claims.iat };
  evidence.wrongAudienceRejected = await jwtVerify(tokens.body.access_token, jwks,
    { algorithms: ['ES256'], issuer: metadata.issuer, audience: 'http://localhost:9003/wrong-resource' })
    .then(() => false, () => true);
  assert.equal(evidence.wrongAudienceRejected, true);

  const refreshed = await refresh(tokens.body.refresh_token);
  assert.equal(refreshed.status, 200);
  await validate(refreshed.body.access_token);
  assert.notEqual(refreshed.body.refresh_token, tokens.body.refresh_token);
  evidence.refreshAudiencePreserved = true;
  evidence.refreshRotated = true;

  const repeat = await begin();
  evidence.existingGrantAutoApproves = Boolean((await details(repeat)).redirect_url);
  const forced = await begin({ prompt: 'consent' });
  evidence.promptConsentReturnsDetails = !Boolean((await details(forced)).redirect_url);

  const wrongPkce = await begin();
  const wrongPkceCode = await authorize(wrongPkce);
  const wrongPkceResponse = await exchange(wrongPkceCode, randomBytes(48).toString('base64url'));
  assert.equal(wrongPkceResponse.status, 400);
  assert.equal(wrongPkceResponse.body.error, 'invalid_grant');
  evidence.wrongPkceRejected = true;

  const wrongRedirectAuthorization = await begin({ redirect: 'http://localhost:45454/other' });
  assert.equal(wrongRedirectAuthorization.status, 400);
  evidence.wrongAuthorizationRedirectRejected = true;
  const wrongRedirectRequest = await begin();
  const wrongRedirectCode = await authorize(wrongRedirectRequest);
  const wrongRedirectExchange = await exchange(wrongRedirectCode, wrongRedirectRequest.verifier, 'http://localhost:45454/other');
  assert.equal(wrongRedirectExchange.status, 400);
  assert.equal(wrongRedirectExchange.body.error, 'invalid_grant');
  evidence.wrongTokenRedirectRejected = true;

  requireSuccess(await sessionClient.auth.oauth.revokeGrant({ clientId }), 'Revoke grant');
  for (const token of [tokens.body.refresh_token, refreshed.body.refresh_token]) {
    const result = await refresh(token);
    assert.equal(result.status, 400);
    assert.ok(result.body.error === 'invalid_grant' || result.body.error_code === 'refresh_token_not_found',
      `Refresh revoke response: ${JSON.stringify({ error: result.body.error, error_code: result.body.error_code, code: result.body.code })}`);
  }
  evidence.oldRefreshRejectedAfterRevoke = true;

  const reconnected = await begin();
  const reconnectedDetails = await details(reconnected);
  assert.equal(reconnectedDetails.redirect_url, undefined);
  const reconnectedCode = await authorize(reconnected, reconnectedDetails);
  const newTokens = await exchange(reconnectedCode, reconnected.verifier);
  assert.equal(newTokens.status, 200);
  await validate(newTokens.body.access_token);
  assert.notEqual(decodeJwt(newTokens.body.access_token).session_id, claims.session_id);
  for (const token of [tokens.body.refresh_token, refreshed.body.refresh_token]) {
    const result = await refresh(token);
    assert.equal(result.status, 400);
    assert.ok(result.body.error === 'invalid_grant' || result.body.error_code === 'refresh_token_not_found',
      `Refresh reconnect response: ${JSON.stringify({ error: result.body.error, error_code: result.body.error_code, code: result.body.code })}`);
  }
  evidence.oldRefreshRejectedAfterReconnect = true;
  // Revocation removes sessions, but cannot erase a JWT signature. The resource
  // server must check its own active grant/validAfter on every request.
  await validate(tokens.body.access_token);
  evidence.oldAccessStillCryptographicallyValidUntilExpiry = true;
  requireSuccess(await sessionClient.auth.oauth.revokeGrant({ clientId }), 'Final revoke');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (clientId) requireSuccess(await admin.auth.admin.oauth.deleteClient(clientId), 'Delete synthetic client');
  requireSuccess(await admin.auth.admin.deleteUser(reservedId), 'Delete synthetic user');
}
