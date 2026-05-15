/**
 * POST /api/ml/chat/conversations/{packId}/send
 *
 * Body JSON:
 *   {
 *     accountId?: string;          // default: conta primária
 *     text: string;                // <=350 chars, ISO-8859-1
 *     attachments?: string[];      // keys retornadas por /attachments
 *     toUserId?: string|number;    // override do destinatário
 *   }
 *
 * Comportamento:
 *   - Carrega a conversa do Firestore para descobrir buyerId e siteId.
 *   - Aplica a regra de Agent IA (nova arq. MLB/MLC) automaticamente.
 *   - Faz POST /messages/packs/{}/sellers/{}, depois re-sincroniza a conversa.
 */

import { NextResponse } from 'next/server';
import { getPackMessages, sendMessageToBuyer, resolveDestinationUserId } from '@/services/ml/messaging';
import { syncConversation } from '@/services/ml/chat-sync';
import { getMlToken } from '@/services/mercadolivre';
import { getPrimaryMlAccountIdAdmin } from '@/services/firestore-admin';
import { adminDb } from '@/lib/firebase-admin';
import { ML_MESSAGE_MAX_LENGTH, ML_AGENT_USER_IDS } from '@/lib/ml-chat-types';
import { requirePagePermission } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ packId: string }> }
) {
  const auth = await requirePagePermission(request, '/atendimento/chat');
  if (!auth.ok) return auth.response;

  const { packId } = await params;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  const text: string = (body?.text || '').trim();
  if (!text) return NextResponse.json({ ok: false, error: 'text vazio' }, { status: 400 });
  if (text.length > ML_MESSAGE_MAX_LENGTH) {
    return NextResponse.json(
      { ok: false, error: `text excede ${ML_MESSAGE_MAX_LENGTH} caracteres` },
      { status: 400 }
    );
  }
  const attachments: string[] = Array.isArray(body?.attachments) ? body.attachments : [];

  const accountId: string = body?.accountId || (await getPrimaryMlAccountIdAdmin());

  // Carrega metadados da conversa (siteId, buyerId, conversationStatusPath).
  const convRef = adminDb.collection('mercadoLivreConversations').doc(packId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) {
    return NextResponse.json(
      { ok: false, error: 'Conversa não encontrada localmente. Sincronize primeiro.' },
      { status: 404 }
    );
  }
  const conv = convSnap.data() as any;
  const sellerId: number = Number(conv?.sellerId);
  if (!sellerId) {
    return NextResponse.json({ ok: false, error: 'sellerId ausente' }, { status: 400 });
  }
  const siteId: string = conv?.siteId || 'MLB';

  // Decide destinatário: nova arquitetura → Agent ID; senão buyerId.
  // Quando a conversa estiver bloqueada, abortamos com erro claro.
  if (conv?.status === 'blocked') {
    return NextResponse.json(
      { ok: false, error: `Conversa bloqueada: ${conv?.substatus || 'sem motivo'}` },
      { status: 409 }
    );
  }

  let toUserId: string | number | undefined = body?.toUserId;
  if (!toUserId) {
    // Heurística:
    // 1) Se a última msg do comprador veio do Agent (toIsAgent) → responder ao Agent.
    // 2) Se conversationStatusPath sugere nova arq. → Agent.
    // 3) Caso contrário → buyerId real.
    const buyerId = conv?.buyerId;
    if (buyerId && ML_AGENT_USER_IDS[siteId] && String(buyerId) === String(ML_AGENT_USER_IDS[siteId])) {
      toUserId = ML_AGENT_USER_IDS[siteId];
    } else {
      toUserId =
        resolveDestinationUserId({
          siteId,
          conversationStatusPath: conv?.conversationStatusPath,
          buyerId,
        }) ?? buyerId;
    }
  }
  if (!toUserId) {
    return NextResponse.json({ ok: false, error: 'Destinatário não resolvido' }, { status: 400 });
  }

  // Escrita otimista: grava mensagem pendente no Firestore.
  const pendingId = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const pendingRef = convRef.collection('messages').doc(pendingId);
  await pendingRef.set({
    id: pendingId,
    packId,
    accountId,
    sellerId,
    siteId,
    direction: 'out',
    fromUserId: sellerId,
    toUserId,
    toIsAgent:
      !!ML_AGENT_USER_IDS[siteId] && String(toUserId) === String(ML_AGENT_USER_IDS[siteId]),
    text,
    attachments: [],
    status: 'pending',
    dates: { created: new Date().toISOString() },
    sortKey: Date.now(),
    pendingClient: true,
    syncedAt: Date.now(),
    updatedAt: Date.now(),
  });

  try {
    const token = await getMlToken(accountId);
    await sendMessageToBuyer({
      packId,
      sellerId,
      toUserId,
      text,
      attachments,
      token,
    });
    await getPackMessages({ packId, sellerId, token, markAsRead: true }).catch(() => undefined);
    // Re-sincroniza para puxar a mensagem real (com ID definitivo do ML).
    const result = await syncConversation({ packId, accountId, sellerId });
    await convRef.set(
      {
        queueStatus: 'waiting_customer',
        firstUnreadAt: null,
        slaDueAt: null,
        lastHumanReplyAt: Date.now(),
        updatedAt: Date.now(),
      },
      { merge: true }
    );
    // Apaga o doc pendente (a mensagem real já foi gravada com o ID do ML).
    await pendingRef.delete().catch(() => undefined);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    // Marca a mensagem pendente como falha (para a UI exibir e oferecer retry).
    await pendingRef
      .set({ sendError: e?.message || String(e), pendingClient: true }, { merge: true })
      .catch(() => undefined);
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 502 }
    );
  }
}
