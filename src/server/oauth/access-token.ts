import 'server-only';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { loadAppAccessSettings } from '@/lib/server-auth';
import { findUserById, isKnownRole, publicUser } from '@/server/access/users';
import type { AccessContext } from '@/server/access/types';
import { boundIdentity } from './identity-bridge';
import { connectionId, connectionRef, type Connection } from './grants';
import { getOAuthConfig } from './config';
import { OAuthError } from './errors';

const claimsSchema = z.object({
  sub: z.string().uuid(), client_id: z.string().uuid(),
  iat: z.number().int().nonnegative(), exp: z.number().int().positive(),
});
const rejected = () => new OAuthError('INVALID_TOKEN', 'A conexão expirou ou não está autorizada.', 401);
let cachedKeys: { issuer: string; keys: ReturnType<typeof createRemoteJWKSet> } | undefined;

/** Entry point for bearer tokens: signature, issuer and audience are checked before local authorization. */
export async function validateOAuthAccessToken(token: string): Promise<AccessContext> {
  const config = getOAuthConfig();
  try {
    if (token.length > 16384) throw rejected();
    if (cachedKeys?.issuer !== config.issuer) {
      cachedKeys = { issuer: config.issuer, keys: createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`), { timeoutDuration: 5000 }) };
    }
    const { payload } = await jwtVerify(token, cachedKeys.keys, {
      algorithms: ['ES256', 'RS256'], issuer: config.issuer, audience: config.resource,
      requiredClaims: ['sub', 'client_id', 'iat', 'exp'],
    });
    return await authorizeOAuthClaims(payload);
  } catch { throw rejected(); }
}

/** Internal authorization step. Only pass claims whose signature, issuer and audience have already been verified. */
export async function authorizeOAuthClaims(payload: JWTPayload): Promise<AccessContext> {
  getOAuthConfig();
  const result = claimsSchema.safeParse(payload);
  if (!result.success) throw rejected();
  const claims = result.data;
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now || claims.iat > now || claims.exp <= claims.iat) throw rejected();
  const identity = (await adminDb.collection('mcpIdentities').doc(claims.sub).get()).data();
  if (!identity || identity.disabledAt || typeof identity.userId !== 'string') throw rejected();
  const [binding, user, grantDoc, settings] = await Promise.all([
    boundIdentity(identity.userId), findUserById(identity.userId),
    connectionRef(connectionId(claims.sub, claims.client_id)).get(), loadAppAccessSettings(),
  ]);
  const grant = grantDoc.data() as Connection | undefined;
  if (!binding || binding.sub !== claims.sub || !user || user.active === false || !isKnownRole(user.role)
    || publicUser(user).mustChangePassword || !grant || grant.status !== 'active'
    || grant.userId !== user.id || grant.sub !== claims.sub || grant.clientId !== claims.client_id
    || grant.authVersion !== user.authVersion || !Number.isSafeInteger(grant.validAfter)
    || claims.iat < grant.validAfter || !Array.isArray(grant.capabilities)) throw rejected();
  return { ...settings, actor: { userId: user.id, role: user.role, source: 'mcp', clientId: claims.client_id },
    active: true, mustChangePassword: false, capabilities: grant.capabilities };
}
