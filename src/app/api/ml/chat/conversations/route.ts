/**
 * GET  /api/ml/chat/conversations
 *   Lista conversas locais e, opcionalmente, sincroniza mensagens não lidas
 *   para uma conta ML específica.
 *
 *   Query params:
 *     - accountId (opcional)  ML accountId interno; default: primário.
 *     - backfill=1            força chamada ao ML para sincronizar tudo agora.
 *
 *   A UI de atendimento consome esta rota em vez de ler o Firestore direto,
 *   mantendo o controle de acesso no servidor.
 */

import { NextResponse } from 'next/server';
import { backfillUnreadForAccount } from '@/services/ml/chat-sync';
import { getPrimaryMlAccountIdAdmin } from '@/services/firestore-admin';
import { requirePagePermission } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import type { MlChatConversationDoc } from '@/lib/ml-chat-types';
import { toFirestoreJson } from '@/lib/firestore-json';

export const dynamic = 'force-dynamic';

async function listConversations(accountId: string, maxRows: number) {
  const snap = await adminDb
    .collection('mercadoLivreConversations')
    .where('accountId', '==', accountId)
    .orderBy('lastMessageAt', 'desc')
    .limit(maxRows)
    .get();

  return snap.docs.map((d) => ({
    ...toFirestoreJson(d.data() as MlChatConversationDoc),
    packId: d.id,
  }));
}

export async function GET(request: Request) {
  const auth = await requirePagePermission(request, '/atendimento/chat');
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const accountId = url.searchParams.get('accountId') || (await getPrimaryMlAccountIdAdmin());
  const backfill = url.searchParams.get('backfill') === '1';
  const maxRows = Math.min(Math.max(Number(url.searchParams.get('limit') || 250), 1), 500);

  try {
    const result = backfill ? await backfillUnreadForAccount(accountId) : null;
    const conversations = await listConversations(accountId, maxRows);
    return NextResponse.json({
      ok: true,
      accountId,
      conversations,
      ...(result || { hint: 'use ?backfill=1 para sincronizar' }),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
