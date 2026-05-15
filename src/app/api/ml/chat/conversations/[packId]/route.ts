/**
 * GET /api/ml/chat/conversations/{packId}?accountId=...
 *   Retorna a conversa e mensagens locais. Use sync=1 para forçar refresh no ML
 *   sem marcar como lida.
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
import type {
  MlChatConversationDoc,
  MlChatMessageDoc,
  MlSupportPriority,
  MlSupportQueueStatus,
} from '@/lib/ml-chat-types';
import { requirePagePermission } from '@/lib/server-auth';
import { toFirestoreJson } from '@/lib/firestore-json';

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

async function loadConversationPayload(packId: string, accountId?: string | null) {
  const convRef = adminDb.collection('mercadoLivreConversations').doc(packId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) {
    return { status: 404, body: { ok: false, error: 'Conversa não encontrada' } };
  }

  const conversation = {
    ...toFirestoreJson(convSnap.data() as MlChatConversationDoc),
    packId: convSnap.id,
  };

  if (accountId && conversation.accountId && String(accountId) !== String(conversation.accountId)) {
    return {
      status: 403,
      body: { ok: false, error: 'Conversa não pertence à conta informada' },
    };
  }

  const messagesSnap = await convRef
    .collection('messages')
    .orderBy('sortKey', 'asc')
    .limit(500)
    .get();

  const messages = messagesSnap.docs.map((d) => ({
    ...toFirestoreJson(d.data() as MlChatMessageDoc),
    id: (d.data() as MlChatMessageDoc).id || d.id,
  }));

  return {
    status: 200,
    body: { ok: true, conversation, messages },
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ packId: string }> }
) {
  const auth = await requirePagePermission(request, '/atendimento/chat');
  if (!auth.ok) return auth.response;

  const { packId } = await params;
  const url = new URL(request.url);
  const accountId = url.searchParams.get('accountId') || (await getPrimaryMlAccountIdAdmin());
  const sync = url.searchParams.get('sync') === '1';

  try {
    let syncResult: Awaited<ReturnType<typeof syncConversation>> | null = null;
    if (sync) {
      const sellerId = await resolveSellerId(accountId);
      if (!sellerId) {
        return NextResponse.json({ ok: false, error: 'sellerId não resolvido' }, { status: 400 });
      }
      syncResult = await syncConversation({ packId, accountId, sellerId });
    }
    const payload = await loadConversationPayload(packId, accountId);
    return NextResponse.json(
      { ...payload.body, sync: syncResult || undefined },
      { status: payload.status }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ packId: string }> }
) {
  const auth = await requirePagePermission(request, '/atendimento/chat');
  if (!auth.ok) return auth.response;

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
    if (markRead) {
      await adminDb
        .collection('mercadoLivreConversations')
        .doc(packId)
        .set(
          {
            queueStatus: 'open',
            firstUnreadAt: null,
            slaDueAt: null,
            updatedAt: Date.now(),
          },
          { merge: true }
        );
    }
    const payload = await loadConversationPayload(packId, accountId);
    return NextResponse.json(
      { ...payload.body, sync: result, markedAsRead: markRead },
      { status: payload.status }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function PATCH(
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

  const allowedStatuses: MlSupportQueueStatus[] = [
    'new',
    'open',
    'waiting_customer',
    'resolved',
    'ignored',
  ];
  const allowedPriorities: MlSupportPriority[] = ['low', 'normal', 'high', 'urgent'];
  const update: Record<string, unknown> = { updatedAt: Date.now() };
  const accountId = body?.accountId ? String(body.accountId) : null;
  const convSnap = await adminDb.collection('mercadoLivreConversations').doc(packId).get();
  if (!convSnap.exists) {
    return NextResponse.json({ ok: false, error: 'Conversa não encontrada' }, { status: 404 });
  }

  if (accountId) {
    const conv = convSnap.data() as MlChatConversationDoc | undefined;
    if (conv?.accountId && String(conv.accountId) !== accountId) {
      return NextResponse.json(
        { ok: false, error: 'Conversa não pertence à conta informada' },
        { status: 403 }
      );
    }
  }

  if (body.queueStatus !== undefined) {
    if (!allowedStatuses.includes(body.queueStatus)) {
      return NextResponse.json({ ok: false, error: 'queueStatus inválido' }, { status: 400 });
    }
    update.queueStatus = body.queueStatus;
    if (['waiting_customer', 'resolved', 'ignored'].includes(body.queueStatus)) {
      update.firstUnreadAt = null;
      update.slaDueAt = null;
    }
  }

  if (body.priority !== undefined) {
    if (!allowedPriorities.includes(body.priority)) {
      return NextResponse.json({ ok: false, error: 'priority inválida' }, { status: 400 });
    }
    update.priority = body.priority;
  }

  if (body.assignedTo !== undefined) {
    if (body.assignedTo === null) {
      update.assignedTo = null;
    } else if (typeof body.assignedTo === 'object') {
      update.assignedTo = {
        id: body.assignedTo.id ? String(body.assignedTo.id) : null,
        name: body.assignedTo.name ? String(body.assignedTo.name) : null,
        email: body.assignedTo.email ? String(body.assignedTo.email) : null,
      };
    } else {
      return NextResponse.json({ ok: false, error: 'assignedTo inválido' }, { status: 400 });
    }
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) {
      return NextResponse.json({ ok: false, error: 'tags inválidas' }, { status: 400 });
    }
    update.tags = body.tags
      .map((tag: unknown) => String(tag || '').trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  await adminDb.collection('mercadoLivreConversations').doc(packId).set(update, { merge: true });
  const payload = await loadConversationPayload(packId, accountId);
  return NextResponse.json({ ...payload.body, update }, { status: payload.status });
}
