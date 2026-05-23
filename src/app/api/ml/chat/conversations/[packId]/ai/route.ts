/**
 * POST /api/ml/chat/conversations/{packId}/ai
 *
 * Gera uma sugestão de atendimento com Gemini/Genkit. A resposta não é enviada
 * ao Mercado Livre; ela fica salva na conversa para revisão humana.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { mlSupportAssistantFlow } from '@/ai/flows/ml-support-assistant';
import { getPrimaryMlAccountIdAdmin } from '@/services/firestore-admin';
import type { MlChatConversationDoc, MlChatMessageDoc } from '@/lib/ml-chat-types';
import { requirePagePermission } from '@/lib/server-auth';
import { buildConversationSupportContext, type MlSupportContext } from '@/services/ml/support-context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function buildAiContextUsed(supportContext: MlSupportContext) {
  const listing = supportContext.listing;
  return {
    productTitle: listing?.title || supportContext.items[0]?.title || null,
    itemId: listing?.itemId || supportContext.primaryItemId || null,
    sellerSku: listing?.sellerSku || supportContext.items[0]?.sellerSku || null,
    stock: listing?.availableQuantity ?? null,
    status: listing?.status || null,
    orderTotalAmount: supportContext.order.totalAmount ?? null,
    matchedBy: supportContext.matchedBy || null,
    alerts: supportContext.alerts
      .filter((alert) => alert.severity !== 'positive')
      .slice(0, 4)
      .map((alert) => alert.title),
    generatedAt: Date.now(),
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ packId: string }> }
) {
  const auth = await requirePagePermission(request, '/atendimento/chat');
  if (!auth.ok) return auth.response;

  const { packId } = await params;
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const accountId = body?.accountId || (await getPrimaryMlAccountIdAdmin());
  const convRef = adminDb.collection('mercadoLivreConversations').doc(packId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) {
    return NextResponse.json({ ok: false, error: 'Conversa não encontrada' }, { status: 404 });
  }

  const conv = { ...(convSnap.data() as MlChatConversationDoc), packId };
  if (accountId && conv.accountId && String(accountId) !== String(conv.accountId)) {
    return NextResponse.json(
      { ok: false, error: 'Conversa não pertence à conta informada' },
      { status: 403 }
    );
  }

  try {
    const supportContext = await buildConversationSupportContext(conv);
    const msgSnap = await convRef
      .collection('messages')
      .orderBy('sortKey', 'desc')
      .limit(30)
      .get();
    const messages = msgSnap.docs
      .map((d) => d.data() as MlChatMessageDoc)
      .reverse()
      .map((m) => ({
        direction: m.direction,
        text: m.text || '',
        createdAt: m.dates?.created || m.dates?.received || null,
        moderationStatus: m.moderation?.status || null,
      }));

    const suggestion = await mlSupportAssistantFlow({
      conversation: {
        packId,
        buyerName: conv.buyerName || null,
        status: conv.status || null,
        substatus: conv.substatus || null,
        shippingId: conv.shippingId || null,
        claimId: conv.claimId || null,
        sellerMaxMessageLength: conv.sellerMaxMessageLength || null,
        queueStatus: conv.queueStatus || null,
        priority: conv.priority || null,
      },
      supportContext,
      messages,
    });

    await convRef.set(
      {
        ai: {
          ...suggestion,
          status: suggestion.needsHumanReview ? 'needs_review' : 'ready',
          contextUsed: buildAiContextUsed(supportContext),
          lastError: null,
          updatedAt: Date.now(),
        },
        updatedAt: Date.now(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, suggestion });
  } catch (e: any) {
    const message = e?.message || String(e);
    await convRef
      .set(
        {
          ai: {
            status: 'error',
            lastError: message,
            updatedAt: Date.now(),
          },
          updatedAt: Date.now(),
        },
        { merge: true }
      )
      .catch(() => undefined);

    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
