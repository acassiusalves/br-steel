import assert from 'node:assert/strict';
import { createPrivateKey } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { validateMcpStaging } from './mcp-staging-config';

export const STAGING = Object.freeze({
  vercel: 'prj_YD3ATzBPFQo4bD1ZlojrDTigUZp8',
  origin: 'https://br-steel-mcp-staging.vercel.app',
  firebase: 'brsteel-mcp-staging',
  supabase: 'mlumbvxpaqfzpdjnvzxc',
  supabaseUrl: 'https://mlumbvxpaqfzpdjnvzxc.supabase.co',
  issuer: 'https://mlumbvxpaqfzpdjnvzxc.supabase.co/auth/v1',
  jwks: 'https://mlumbvxpaqfzpdjnvzxc.supabase.co/auth/v1/.well-known/jwks.json',
  resource: 'https://br-steel-mcp-staging.vercel.app/api/mcp',
});

/** Pure signature/claim proof against the one pinned public JWKS fetched by the runner. */
export async function verifyStagingProofJwt(token: string, jwks: JSONWebKeySet, expected: { sub: string; clientId?: string }) {
  try {
    assert.ok(typeof token === 'string' && token.length > 0 && token.length <= 16384);
    assert.ok(jwks && Array.isArray(jwks.keys) && jwks.keys.length > 0 && jwks.keys.length <= 16);
    assert.ok(Buffer.byteLength(JSON.stringify(jwks)) <= 65536);
    for (const key of jwks.keys) {
      assert.ok(key.kty === 'EC' || key.kty === 'RSA');
      assert.ok(!['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some(field => Object.hasOwn(key, field)));
    }
    const audience = expected.clientId ? STAGING.resource : 'authenticated';
    const { payload, protectedHeader } = await jwtVerify(token, createLocalJWKSet(jwks), {
      algorithms: ['ES256', 'RS256'], issuer: STAGING.issuer, audience,
      requiredClaims: ['sub', 'iat', 'exp', ...(expected.clientId ? ['client_id'] : [])],
    });
    assert.equal(payload.aud, audience); // Refuse an audience array containing extra consumers.
    assert.equal(payload.sub, expected.sub);
    assert.equal(payload.client_id, expected.clientId); // Ordinary sessions must have no OAuth client claim.
    assert.ok(Number.isSafeInteger(payload.iat) && Number.isSafeInteger(payload.exp));
    assert.ok(payload.iat! >= 0 && payload.iat! <= Math.floor(Date.now() / 1000));
    assert.equal(payload.exp! - payload.iat!, 900);
    // No token, claim set, identity, kid, or arbitrary provider value can enter the report.
    return { signatureVerified: true, algorithm: protectedHeader.alg as 'ES256' | 'RS256',
      issuerMatches: true, audienceMatches: true, subjectMatches: true,
      ...(expected.clientId ? { clientIdMatches: true } : { oauthClientClaimAbsent: true }), lifetimeSeconds: 900 };
  } catch {
    // AssertionError/jose errors may carry raw claim values. Do not expose them to the reporter.
    throw new Error('Independent staging JWT verification failed');
  }
}

/** Offline only. No .env, credential-file, emulator or ADC fallback is permitted. */
export function stagingProofGuard(env: Record<string, string | undefined>, config: { crons?: unknown[]; buildCommand?: string }) {
  const errors = [...validateMcpStaging(env, config).errors];
  const require = (condition: unknown, message: string) => { if (!condition) errors.push(message); };
  for (const [key, expected] of Object.entries({
    BRSTEEL_DEPLOYMENT_ENV: 'staging',
    BRSTEEL_STAGING_VERCEL_PROJECT_ID: STAGING.vercel,
    VERCEL_PROJECT_ID: STAGING.vercel,
    BRSTEEL_STAGING_ORIGIN: STAGING.origin,
    APP_ORIGIN: STAGING.origin,
    MCP_PUBLIC_URL: STAGING.resource,
    BRSTEEL_STAGING_FIREBASE_PROJECT_ID: STAGING.firebase,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: STAGING.firebase,
    BRSTEEL_STAGING_SUPABASE_PROJECT_REF: STAGING.supabase,
    SUPABASE_URL: STAGING.supabaseUrl,
    MCP_ENABLED: 'true', MCP_OAUTH_ENABLED: 'true', MCP_WRITES_ENABLED: 'false',
  })) require(env[key] === expected, `Exact dedicated staging value required for ${key}.`);
  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    if (/EMULATOR|^(?:GOOGLE_APPLICATION_CREDENTIALS|FIREBASE_CONFIG|GOOGLE_API_USE_MTLS_ENDPOINT|GOOGLE_API_USE_MTLS|GOOGLE_API_USE_CLIENT_CERTIFICATE|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|http_proxy|https_proxy|all_proxy)$/.test(key)) {
      errors.push(`Remove alternate credentials, emulator or network override ${key}.`);
    }
  }
  const userId = env.MCP_STAGING_VERIFY_USER_ID ?? '';
  require(/^staging-proof-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(userId), 'MCP_STAGING_VERIFY_USER_ID must be staging-proof-<random UUIDv4>.');
  require(env.MCP_ALLOWED_USER_IDS === userId && Boolean(userId), 'The proof requires MCP_ALLOWED_USER_IDS to equal its one temporary user ID.');
  let credential: { project_id: string; client_email: string; private_key: string } | undefined;
  try {
    const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY ?? '');
    require(parsed.type === 'service_account' && parsed.project_id === STAGING.firebase
      && typeof parsed.client_email === 'string' && parsed.client_email.endsWith(`@${STAGING.firebase}.iam.gserviceaccount.com`)
      && createPrivateKey(parsed.private_key).asymmetricKeyType === 'rsa', 'Exact dedicated Firebase service account required.');
    require(!parsed.universe_domain || parsed.universe_domain === 'googleapis.com', 'Service account universe must be googleapis.com.');
    require(!parsed.token_uri || parsed.token_uri === 'https://oauth2.googleapis.com/token', 'Service account token URL must be the Google OAuth endpoint.');
    credential = parsed;
  } catch { errors.push('Dedicated Firebase service-account JSON is invalid.'); }
  return { errors, userId, credential: errors.length ? undefined : credential };
}
