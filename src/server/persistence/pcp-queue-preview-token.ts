import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { signServerPayload } from '@/lib/server-signature';
import { OperationError } from '@/server/operations/common';
import type { BatchInput, PreviewInput } from './pcp-orders-contract';
import type { WriteActor } from './write-audit';

const signPreview = (payload: string) => signServerPayload(`brsteel/pcp-bling-queue-preview:${payload}`);
const TTL_MS = 2 * 60 * 60 * 1000;

function fingerprint(input: PreviewInput, actor: WriteActor) {
  return JSON.stringify([actor.userId, actor.source, input.policy, input.kind, input.from, input.to, input.factor]);
}

export function issueQueuePreviewToken(input: PreviewInput, actor: WriteActor, sheetIds: readonly string[]): string {
  const payload = Buffer.from(JSON.stringify({
    request: fingerprint(input, actor), expiresAt: Date.now() + TTL_MS, sheetIds,
  })).toString('base64url');
  return `${payload}.${signPreview(payload)}`;
}

export function validateQueuePreview(input: BatchInput, actor: WriteActor): void {
  const stale = new OperationError('QUEUE_PREVIEW_INVALID', 'Calcule uma nova prévia da fila antes de gerar o lote.', 409);
  const [payload, signature, surplus] = input.previewToken?.split('.') ?? [];
  if (!payload || !signature || surplus !== undefined || !/^[\w-]+$/.test(payload)) throw stale;
  const received = Buffer.from(signature);
  const expected = Buffer.from(signPreview(payload));
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw stale;
  const { request, expiresAt, sheetIds } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    request: string; expiresAt: number; sheetIds: string[];
  };
  if (request !== fingerprint(input, actor) || expiresAt <= Date.now()) throw stale;
  const allowed = new Set(sheetIds);
  if (input.items.some(item => !allowed.has(item.sheetId))) {
    throw new OperationError('QUEUE_ITEM_UNAVAILABLE', 'A prévia da fila exige ficha com roteiro e saldo confirmado para cada item do lote.', 409);
  }
}
