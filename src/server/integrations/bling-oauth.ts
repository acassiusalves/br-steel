import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { requireAdministrator } from '@/server/access/current-user';
import { getFullBlingCredentials } from './bling';
const COOKIE = 'brsteel_bling_state';

/**
 * Conexão com o Bling em um clique, como no Mercado Livre: o Client ID e o Client Secret do app vêm das
 * variáveis de ambiente (`BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`), o administrador clica em conectar, o
 * navegador vai para o Bling, a pessoa confirma o app e o Bling devolve para `/api/callback/bling`, que
 * grava os tokens. O link de retorno é o cadastrado no app do Bling.
 */
export type BlingAppStatus = { configured: boolean; source: 'env' | 'firestore' | 'none'; clientIdMasked?: string };

const mask = (value: string) => (value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : '…');

export async function blingAppStatus(): Promise<BlingAppStatus> {
  await requireAdministrator();
  const credentials = await getFullBlingCredentials();
  if (!credentials.clientId || !credentials.clientSecret) return { configured: false, source: 'none' };
  const source = process.env.BLING_CLIENT_ID && process.env.BLING_CLIENT_SECRET ? 'env' : 'firestore';
  return { configured: true, source, clientIdMasked: mask(credentials.clientId) };
}

export async function beginBlingConnection() {
  const user = await requireAdministrator();
  const credentials = await getFullBlingCredentials();
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new Error('O app do Bling não está configurado. Defina BLING_CLIENT_ID e BLING_CLIENT_SECRET nas variáveis de ambiente da Vercel.');
  }
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
