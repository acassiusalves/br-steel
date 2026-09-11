import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { rejectCrossOrigin } from '@/server/access/request';
import { clearBridgeCookieHeader } from './cookies';
import { OAuthError } from './errors';
export async function oauthJson(action: () => Promise<NextResponse>) {
  try {
    const response = await action();
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    const known = error instanceof OAuthError ? error : error instanceof z.ZodError
      ? new OAuthError('INVALID_INPUT', 'Solicitação inválida.', 400)
      : new OAuthError('PROVIDER_UNAVAILABLE', 'Não foi possível concluir a solicitação. Tente novamente.', 503);
    const response = NextResponse.json({ ok: false, code: known.code, error: known.message }, { status: known.status, headers: { 'Cache-Control': 'no-store' } });
    if (known.status === 401) response.headers.append('Set-Cookie', clearBridgeCookieHeader());
    return response;
  }
}
export async function readOAuthBody(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) throw new OAuthError('ORIGIN_DENIED', 'Origem não autorizada.', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new OAuthError('INVALID_INPUT', 'Envie uma solicitação JSON.', 400);
  const reader = request.body?.getReader();
  if (!reader) throw new OAuthError('INVALID_INPUT', 'Solicitação vazia.', 400);
  let size = 0; const parts: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 64 * 1024) { await reader.cancel(); throw new OAuthError('BODY_TOO_LARGE', 'Solicitação muito grande.', 413); }
    parts.push(value);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown; }
  catch { throw new OAuthError('INVALID_INPUT', 'JSON inválido.', 400); }
}
