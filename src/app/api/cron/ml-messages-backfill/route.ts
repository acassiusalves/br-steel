/**
 * GET /api/cron/ml-messages-backfill
 *
 * Cron de redundância: lista /messages/unread?role=seller para cada conta ML
 * ativa e sincroniza qualquer conversa que ainda esteja com mensagens não
 * lidas no ML (cobre eventuais notificações perdidas).
 *
 * Recomendado: executar a cada 5 minutos.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { backfillUnreadForAccount } from '@/services/ml/chat-sync';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization') || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const snap = await adminDb.collection('mercadoLivreAccounts').get();
    const results: any[] = [];
    for (const d of snap.docs) {
      const data = d.data() as any;
      // Pula contas obviamente sem credenciais
      if (!data?.refreshToken && !data?.accessToken) continue;
      try {
        const r = await backfillUnreadForAccount(d.id);
        results.push({ accountId: d.id, ...r });
      } catch (e: any) {
        results.push({ accountId: d.id, error: e?.message || String(e) });
      }
    }
    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
