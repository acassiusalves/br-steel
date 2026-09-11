import 'server-only';
import { createHash } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { getOAuthConfig } from './config';
import { OAuthError } from './errors';
import type { ProviderSession } from './types';
import type { SessionPayload } from '@/lib/server-auth';
export const OAUTH_COOKIE = 'brsteel_oauth_session';
function key() { return createHash('sha256').update(`brsteel-oauth-cookie:${getOAuthConfig().cookieSecret}`).digest(); }
export async function sealBridgeSession(session: ProviderSession, local: SessionPayload) {
  const expiration = Math.min(session.expires_at, Math.floor(local.exp / 1000), Math.floor(Date.now() / 1000) + 600);
  const value = await new EncryptJWT({ ...session, userId: local.user.id, authVersion: local.authVersion })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).setIssuer('brsteel-consent').setAudience('brsteel-web')
    .setIssuedAt().setExpirationTime(expiration).encrypt(key());
  if (value.length > 3800) throw new OAuthError('SESSION_SIZE', 'Não foi possível preparar a sessão do conector.', 503);
  return value;
}
export function bridgeCookieHeader(value: string) {
  return `${OAUTH_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
export function clearBridgeCookieHeader() {
  return `${OAUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
export async function openBridgeSession(request: Request, local: SessionPayload): Promise<ProviderSession> {
  const cookie = (request.headers.get('cookie') || '').split(';').map(p => p.trim()).find(p => p.startsWith(`${OAUTH_COOKIE}=`));
  try {
    if (!cookie) throw new Error('missing');
    const value = cookie.slice(OAUTH_COOKIE.length + 1);
    if (value.length > 3800) throw new Error('size');
    const { payload } = await jwtDecrypt(value, key(), { issuer: 'brsteel-consent', audience: 'brsteel-web', keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'] });
    if (payload.userId !== local.user.id || payload.authVersion !== local.authVersion
      || typeof payload.sub !== 'string' || typeof payload.access_token !== 'string' || typeof payload.refresh_token !== 'string'
      || typeof payload.expires_at !== 'number' || payload.expires_at <= Date.now() / 1000) throw new Error('mismatch');
    return { sub: payload.sub, access_token: payload.access_token, refresh_token: payload.refresh_token, expires_at: payload.expires_at };
  } catch { throw new OAuthError('BRIDGE_MISMATCH', 'A sessão do conector expirou ou pertence a outro usuário. Inicie novamente.', 401); }
}
