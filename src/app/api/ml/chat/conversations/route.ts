/**
 * GET  /api/ml/chat/conversations
 *   Sincroniza (backfill) e/ou lista as conversas com mensagens não lidas
 *   para uma conta ML específica.
 *
 *   Query params:
 *     - accountId (opcional)  ML accountId interno; default: primário.
 *     - backfill=1            força chamada ao ML para sincronizar tudo agora.
 *
 *   Nota: a UI normalmente lê o Firestore via onSnapshot (cliente). Esta rota
 *   serve para forçar uma sincronização sob demanda.
 */

import { NextResponse } from 'next/server';
import { backfillUnreadForAccount } from '@/services/ml/chat-sync';
import { getPrimaryMlAccountIdAdmin } from '@/services/firestore-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('accountId') || (await getPrimaryMlAccountIdAdmin());
  const backfill = url.searchParams.get('backfill') === '1';

  if (!backfill) {
    return NextResponse.json({ ok: true, hint: 'use ?backfill=1 para sincronizar' });
  }

  try {
    const result = await backfillUnreadForAccount(accountId);
    return NextResponse.json({ ok: true, accountId, ...result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
