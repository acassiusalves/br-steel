/**
 * GET /api/cron/ml-messages-drain
 *
 * Cron que drena eventos do tópico "messages" pendentes em
 * mercadoLivreWebhookEvents (status='received'), processando-os em batch.
 *
 * Recomendado: executar a cada 1 minuto via vercel.json/crons.
 */

import { NextResponse } from 'next/server';
import { drainPendingMessageEvents } from '@/services/ml/chat-sync';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Vercel Cron envia header Authorization: Bearer <CRON_SECRET> se configurado.
  // Mantemos uma checagem básica e fail-open quando não há secret.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization') || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }
  try {
    const result = await drainPendingMessageEvents({ limit: 100 });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
