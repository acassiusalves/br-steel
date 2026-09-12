import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { rejectCrossOrigin } from '@/server/access/request';
import { OperationError, serialize } from './common';
export async function operationJson(action: () => Promise<unknown>) {
  try { return NextResponse.json({ ok: true, ...serialize(await action()) as object }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) {
    const known = error instanceof OperationError ? error : error instanceof z.ZodError
      ? new OperationError('INVALID_INPUT', 'Dados inválidos. Confira os campos e tente novamente.')
      : new OperationError('UNAVAILABLE', 'Não foi possível concluir a operação. Tente novamente.', 503);
    return NextResponse.json({ ok: false, code: known.code, error: known.message }, { status: known.status, headers: { 'Cache-Control': 'no-store' } });
  }
}
export async function readOperationBody(request: Request): Promise<unknown> {
  if (rejectCrossOrigin(request)) throw new OperationError('ORIGIN_DENIED', 'Origem não autorizada.', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new OperationError('INVALID_INPUT', 'Envie uma solicitação JSON.');
  const reader = request.body?.getReader(); if (!reader) throw new OperationError('INVALID_INPUT', 'Solicitação vazia.');
  const parts: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
    if (size > 256 * 1024) { await reader.cancel(); throw new OperationError('TOO_LARGE', 'Solicitação muito grande.', 413); } parts.push(value); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new OperationError('INVALID_INPUT', 'JSON inválido.'); }
}
