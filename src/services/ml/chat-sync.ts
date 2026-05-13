/**
 * Sincronização das mensagens pós-venda do ML com o Firestore.
 *
 * Estratégia:
 *   1. Recebemos um evento (webhook ou cron) referente a uma conversa.
 *   2. Consultamos o ML via GET /messages/packs/{pack}/sellers/{seller}
 *      com mark_as_read=false.
 *   3. Fazemos upsert de cada mensagem em
 *      mercadoLivreConversations/{packId}/messages/{messageId} e atualizamos
 *      os metadados em mercadoLivreConversations/{packId}.
 *
 * O cliente da UI escuta esses documentos via onSnapshot, garantindo
 * atualização em tempo real após a sincronização.
 */

import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getPackMessages, getMessageById, getUnreadConversations } from './messaging';
import { getMlToken } from '@/services/mercadolivre';
import type {
  MlChatConversationDoc,
  MlChatMessageDoc,
  MlMessagesPackResponse,
} from '@/lib/ml-chat-types';

const CONVERSATIONS_COLL = 'mercadoLivreConversations';

function toEpoch(iso?: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Normaliza a resposta crua do ML para os documentos a serem gravados.
 */
function buildConversationDocs(args: {
  packId: string;
  accountId: string;
  sellerId: number;
  resp: MlMessagesPackResponse;
  buyerHint?: { id?: string | number | null; name?: string | null; email?: string | null };
}): { conv: Partial<MlChatConversationDoc>; messages: MlChatMessageDoc[] } {
  const { packId, accountId, sellerId, resp, buyerHint } = args;
  const now = Date.now();
  const cs = resp.conversation_status || {};
  const rawMessages = resp.messages || [];

  let buyerId: string | number | null = buyerHint?.id ?? null;
  let buyerName: string | null = buyerHint?.name ?? null;
  let buyerEmail: string | null = buyerHint?.email ?? null;
  for (const m of rawMessages) {
    const fromId = m.from?.user_id;
    if (fromId && String(fromId) !== String(sellerId)) {
      if (!buyerId) buyerId = fromId;
      if (!buyerName && m.from?.name) buyerName = m.from.name;
      if (!buyerEmail && m.from?.email) buyerEmail = m.from.email;
      break;
    }
  }

  const messages: MlChatMessageDoc[] = rawMessages.map((m) => {
    const fromId = m.from?.user_id ?? null;
    const toId = m.to?.user_id ?? null;
    const direction: 'in' | 'out' = String(fromId) === String(sellerId) ? 'out' : 'in';
    const created = m.message_date?.created || m.message_date?.received || null;
    const sortKey = toEpoch(created);
    return {
      id: m.id,
      packId,
      accountId,
      sellerId,
      siteId: m.site_id || 'MLB',
      direction,
      fromUserId: fromId,
      toUserId: toId,
      text: m.text || '',
      attachments: m.message_attachments || [],
      status: m.status,
      moderation: m.message_moderation
        ? {
            status: m.message_moderation.status,
            reason: m.message_moderation.reason ?? null,
            source: m.message_moderation.source ?? null,
            moderationDate: m.message_moderation.moderation_date ?? null,
          }
        : undefined,
      dates: {
        created: m.message_date?.created ?? null,
        received: m.message_date?.received ?? null,
        available: m.message_date?.available ?? null,
        notified: m.message_date?.notified ?? null,
        read: m.message_date?.read ?? null,
      },
      sortKey,
      syncedAt: now,
      updatedAt: now,
    };
  });

  const sorted = [...messages].sort((a, b) => a.sortKey - b.sortKey);
  const last = sorted[sorted.length - 1];
  const unreadCount = messages.filter((m) => m.direction === 'in' && !m.dates.read).length;

  const firstMsgSite = rawMessages.find((m) => m.site_id)?.site_id;
  const conv: Partial<MlChatConversationDoc> = {
    packId,
    accountId,
    sellerId,
    siteId: firstMsgSite,
    buyerId,
    buyerName,
    buyerEmail,
    status: (cs.status as any) || 'active',
    substatus: (cs.substatus as any) || null,
    statusDate: cs.status_date || null,
    statusUpdateAllowed: cs.status_update_allowed ?? false,
    claimId: (cs.claim_id ?? cs.claim_ids?.[0]) ?? null,
    shippingId: cs.shipping_id ?? null,
    lastMessageAt: last?.sortKey || null,
    lastMessagePreview: last?.text?.slice(0, 160) || '',
    lastMessageDirection: last?.direction,
    unreadCount,
    sellerMaxMessageLength: resp.seller_max_message_length,
    buyerMaxMessageLength: resp.buyer_max_message_length,
    syncedAt: now,
    updatedAt: now,
  };

  return { conv, messages };
}

/**
 * Sincroniza uma conversa específica do ML para o Firestore.
 */
export async function syncConversation(opts: {
  packId: string;
  accountId: string;
  sellerId: number;
}): Promise<{ conversation: Partial<MlChatConversationDoc>; messagesCount: number }> {
  const token = await getMlToken(opts.accountId);
  const resp = await getPackMessages({
    packId: opts.packId,
    sellerId: opts.sellerId,
    token,
    markAsRead: false,
  });

  const { conv, messages } = buildConversationDocs({
    packId: opts.packId,
    accountId: opts.accountId,
    sellerId: opts.sellerId,
    resp,
  });

  const batch = adminDb.batch();
  const convRef = adminDb.collection(CONVERSATIONS_COLL).doc(opts.packId);
  batch.set(
    convRef,
    {
      ...conv,
      createdAt: FieldValue.serverTimestamp() as any,
    },
    { merge: true }
  );

  for (const m of messages) {
    const msgRef = convRef.collection('messages').doc(m.id);
    batch.set(msgRef, m, { merge: true });
  }

  await batch.commit();

  return { conversation: conv, messagesCount: messages.length };
}

/**
 * Processa um evento de webhook do tópico "messages".
 *
 * O `resource` pode vir como:
 *   - "/messages/{message_id}"  (string com prefixo)
 *   - "{message_id}"            (apenas o ID — visto na doc oficial)
 *   - "/packs/{pack}/sellers/{seller}/conversations/{type}" (nova arq.)
 */
export async function processMessagesWebhookEvent(opts: {
  resource: string;
  userId: number | string;
  accountId: string;
}): Promise<{ ok: true; packId: string } | { ok: false; reason: string }> {
  const { resource, userId, accountId } = opts;

  const newArchMatch = /\/packs\/([^/]+)\/sellers\/([^/]+)/.exec(resource);
  if (newArchMatch) {
    const packId = newArchMatch[1];
    const sellerId = Number(newArchMatch[2]) || Number(userId);
    await syncConversation({ packId, accountId, sellerId });
    return { ok: true, packId };
  }

  const cleaned = resource.replace(/^\/?messages\//, '').replace(/^\//, '');
  if (!cleaned) return { ok: false, reason: 'resource_vazio' };

  try {
    const token = await getMlToken(accountId);
    const msg = await getMessageById({ messageId: cleaned, token });
    const m = msg.messages?.[0];
    if (!m) return { ok: false, reason: 'mensagem_sem_dados' };

    const pack = m.message_resources?.find((r) => r.name === 'packs');
    const seller =
      m.message_resources?.find((r) => r.name === 'sellers') ||
      m.message_resources?.find((r) => r.name === 'seller');

    const packId = pack?.id;
    const sellerId =
      Number(seller?.id) ||
      (String(m.from?.user_id) === String(userId)
        ? Number(m.from?.user_id)
        : Number(m.to?.user_id)) ||
      Number(userId);

    if (!packId) return { ok: false, reason: 'pack_id_ausente' };
    await syncConversation({ packId: String(packId), accountId, sellerId });
    return { ok: true, packId: String(packId) };
  } catch (e: any) {
    return { ok: false, reason: `falha_get_message: ${e?.message || e}` };
  }
}

/**
 * Backfill — lista conversas com não-lidas de uma conta e sincroniza cada uma.
 */
export async function backfillUnreadForAccount(accountId: string): Promise<{
  scanned: number;
  synced: number;
  errors: number;
}> {
  const token = await getMlToken(accountId);
  const unread = await getUnreadConversations({ token, role: 'seller' });
  let synced = 0;
  let errors = 0;
  const sellerId = Number(unread.user_id);

  for (const r of unread.results || []) {
    const m = /\/packs\/([^/]+)\/sellers\/([^/]+)/.exec(r.resource);
    if (!m) continue;
    const packId = m[1];
    const sId = Number(m[2]) || sellerId;
    try {
      await syncConversation({ packId, accountId, sellerId: sId });
      synced++;
    } catch (e) {
      console.error('[chat-sync] backfill falhou', { packId, e });
      errors++;
    }
  }
  return { scanned: (unread.results || []).length, synced, errors };
}

/**
 * Drena eventos do webhook (topic=messages, status=received), processando
 * até `limit` eventos. Usado pelo cron.
 */
export async function drainPendingMessageEvents(opts: { limit?: number } = {}): Promise<{
  processed: number;
  failed: number;
}> {
  const limit = opts.limit ?? 50;
  const snap = await adminDb
    .collection('mercadoLivreWebhookEvents')
    .where('topic', '==', 'messages')
    .where('status', '==', 'received')
    .orderBy('receivedAt', 'asc')
    .limit(limit)
    .get();

  let processed = 0;
  let failed = 0;

  for (const doc of snap.docs) {
    const ev = doc.data() as any;
    if (!ev.accountId) {
      await doc.ref.update({
        status: 'ignored',
        processingError: 'sem accountId',
        processedAt: Date.now(),
      });
      continue;
    }
    await doc.ref.update({ status: 'processing' });
    try {
      const result = await processMessagesWebhookEvent({
        resource: ev.resource,
        userId: ev.user_id,
        accountId: ev.accountId,
      });
      if (result.ok) {
        await doc.ref.update({ status: 'processed', processedAt: Date.now() });
        processed++;
      } else {
        await doc.ref.update({
          status: 'failed',
          processingError: result.reason,
          processedAt: Date.now(),
        });
        failed++;
      }
    } catch (e: any) {
      await doc.ref.update({
        status: 'failed',
        processingError: String(e?.message || e),
        processedAt: Date.now(),
      });
      failed++;
    }
  }

  return { processed, failed };
}
