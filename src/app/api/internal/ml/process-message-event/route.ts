/**
 * POST /api/internal/ml/process-message-event
 *
 * Endpoint interno que processa um único evento de webhook do tópico
 * "messages". Pode ser chamado:
 *   - manualmente (debug)
 *   - pelo cron drainPendingMessageEvents
 *   - fire-and-forget logo após o webhook handler (otimização futura)
 *
 * Body JSON: { _id: string }   — ID do documento em mercadoLivreWebhookEvents
 *
 * Em produção, este endpoint deveria ser protegido (auth header / IP allowlist).
 * Aqui assume-se que ele só é exposto por rotas internas (mesmo deploy).
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { processMessagesWebhookEvent } from '@/services/ml/chat-sync';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'json inválido' }, { status: 400 });
  }
  const id: string = body?._id || body?.id;
  if (!id) return NextResponse.json({ ok: false, error: 'falta _id' }, { status: 400 });

  const ref = adminDb.collection('mercadoLivreWebhookEvents').doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ ok: false, error: 'evento não encontrado' }, { status: 404 });
  }
  const ev = snap.data() as any;
  if (ev.topic !== 'messages') {
    return NextResponse.json(
      { ok: false, error: `topic ${ev.topic} não suportado por esta rota` },
      { status: 400 }
    );
  }
  if (!ev.accountId) {
    return NextResponse.json({ ok: false, error: 'evento sem accountId' }, { status: 400 });
  }

  await ref.update({ status: 'processing' });
  try {
    const result = await processMessagesWebhookEvent({
      resource: ev.resource,
      userId: ev.user_id,
      accountId: ev.accountId,
    });
    if (result.ok) {
      await ref.update({ status: 'processed', processedAt: Date.now() });
      return NextResponse.json({ ok: true, packId: result.packId });
    } else {
      await ref.update({
        status: 'failed',
        processingError: result.reason,
        processedAt: Date.now(),
      });
      return NextResponse.json({ ok: false, error: result.reason }, { status: 500 });
    }
  } catch (e: any) {
    await ref.update({
      status: 'failed',
      processingError: String(e?.message || e),
      processedAt: Date.now(),
    });
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
