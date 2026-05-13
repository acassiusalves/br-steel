/**
 * GET /api/ml/chat/conversations/{packId}?accountId=...
 *   Força um refresh da conversa específica direto no ML (sem marcar como lida).
 *   Útil quando o usuário abre uma conversa pela primeira vez.
 *
 * POST /api/ml/chat/conversations/{packId}?accountId=...&markRead=1
 *   Mesma coisa, mas marca como lida (chama o GET sem mark_as_read=false).
 */

import { NextResponse } from 'next/server';
import { syncConversation } from '@/services/ml/chat-sync';
import { getPackMessages } from '@/services/ml/messaging';
import { getMlToken } from '@/services/mercadolivre';
import { getPrimaryMlAccountIdAdmin } from '@/services/firestore-admin';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

async function resolveSellerId(accountId: string): Promise<number | null> {
  try {
    const snap = await adminDb.collection('mercadoLivreAccounts').doc(accountId).get();
    if (!snap.exists) return null;
    const data = snap.data() as any;
    return Number(data?.userId || data?.sellerId) || null;
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ packId: string }> }
) {
  const { packId } = await params;
  const url = new URL(request.url);
  const accountId = url.searchParams.get('accountId') || (await getPrimaryMlAccountIdAdmin());

  try {
    const sellerId = await resolveSellerId(accountId);
    if (!sellerId) {
      return NextResponse.json({ ok: false, error: 'sellerId não resolvido' }, { status: 400 });
    }
    const result = await syncConversation({ packId, accountId, sellerId });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ packId: string }> }
) {
  const { packId } = await params;
  const url = new URL(request.url);
  const accountId = url.searchParams.get('accountId') || (await getPrimaryMlAccountIdAdmin());
  const markRead = url.searchParams.get('markRead') === '1';

  try {
    const sellerId = await resolveSellerId(accountId);
    if (!sellerId) {
      return NextResponse.json({ ok: false, error: 'sellerId não resolvido' }, { status: 400 });
    }
    if (markRead) {
      // Chama o GET no ML que efetivamente marca como lidas, e depois sincroniza.
      const token = await getMlToken(accountId);
      await getPackMessages({ packId, sellerId, token, markAsRead: true });
    }
    const result = await syncConversation({ packId, accountId, sellerId });
    return NextResponse.json({ ok: true, ...result, markedAsRead: markRead });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
