import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { requireAdministrator } from '@/server/access/current-user';
import { getFullBlingCredentials } from './bling';
const COOKIE = 'brsteel_bling_state';
export async function beginBlingConnection() {
  const user = await requireAdministrator();
  const credentials = await getFullBlingCredentials();
  if (!credentials.clientId) throw new Error('Salve o Client ID do Bling antes de conectar.');
  const state = randomBytes(32).toString('base64url');
  (await cookies()).set(COOKIE, `${user.id}:${state}`, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/callback/bling', maxAge: 600 });
  const url = new URL('https://www.bling.com.br/Api/v3/oauth/authorize');
  url.searchParams.set('response_type', 'code'); url.searchParams.set('client_id', credentials.clientId); url.searchParams.set('state', state);
  return url.toString();
}
export async function consumeBlingConnection(state: string | null) {
  const user = await requireAdministrator();
  const jar = await cookies(); const actual = jar.get(COOKIE)?.value;
  const expected = `${user.id}:${state ?? ''}`;
  if (!state || !actual || actual.length !== expected.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) throw new Error('Autorização expirada. Gere um novo link de conexão.');
  jar.set(COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/callback/bling', maxAge: 0 });
}
