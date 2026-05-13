/**
 * Cliente HTTP para a API de Mensageria Pós-Venda do Mercado Livre.
 *
 * Documentação:
 *   - https://developers.mercadolivre.com.br/pt_br/mensagens-post-venda
 *   - https://developers.mercadolivre.com.br/pt_br/mensagens-pendentes
 *
 * Convenções:
 *   - Sempre injetar `?tag=post_sale` (obrigatório nos endpoints de mensageria).
 *   - Não fazemos retry agressivo aqui — o caller decide (rate limit 500 rpm).
 *   - GET de pacote NÃO marca como lido (`mark_as_read=false`) por padrão.
 */

import { ML_AGENT_USER_IDS, type MlMessagesPackResponse, type MlUnreadResponse } from '@/lib/ml-chat-types';

const ML_API_BASE = 'https://api.mercadolibre.com';

function withTagPostSale(url: URL) {
  if (!url.searchParams.get('tag')) url.searchParams.set('tag', 'post_sale');
  return url;
}

async function mlFetch<T>(
  pathOrUrl: string,
  init: RequestInit & { token: string }
): Promise<T> {
  const url = pathOrUrl.startsWith('http') ? new URL(pathOrUrl) : new URL(`${ML_API_BASE}${pathOrUrl}`);
  withTagPostSale(url);

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${init.token}`);

  const res = await fetch(url, {
    ...init,
    headers,
    cache: 'no-store',
  });

  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');

  if (!res.ok) {
    const errBody = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '');
    const msg =
      (errBody && typeof errBody === 'object' && 'message' in errBody && (errBody as any).message) ||
      (typeof errBody === 'string' && errBody) ||
      res.statusText;
    const err = new Error(`ML API ${res.status}: ${msg}`);
    (err as any).status = res.status;
    (err as any).body = errBody;
    throw err;
  }

  if (isJson) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

/**
 * Obtém todas as mensagens de uma conversa (pack/seller).
 *
 * Por padrão NÃO marca como lidas. Para marcar como lidas, passe `markAsRead: true`.
 *
 * Doc: https://developers.mercadolivre.com.br/pt_br/mensagens-post-venda#Obter-mensagens-de-um-pacote
 */
export async function getPackMessages(opts: {
  packId: string;
  sellerId: string | number;
  token: string;
  markAsRead?: boolean;
  limit?: number;
  offset?: number;
}): Promise<MlMessagesPackResponse> {
  const { packId, sellerId, token, markAsRead = false, limit, offset } = opts;
  const url = new URL(`${ML_API_BASE}/messages/packs/${encodeURIComponent(packId)}/sellers/${encodeURIComponent(String(sellerId))}`);
  if (!markAsRead) url.searchParams.set('mark_as_read', 'false');
  if (typeof limit === 'number') url.searchParams.set('limit', String(limit));
  if (typeof offset === 'number') url.searchParams.set('offset', String(offset));
  return mlFetch<MlMessagesPackResponse>(url.toString(), { method: 'GET', token });
}

/**
 * Obtém detalhes de uma mensagem específica pelo ID.
 *
 * Útil para resolver o `pack_id` (vindo do `message_resources`) quando o
 * webhook entrega apenas um `message_id` como resource.
 */
export async function getMessageById(opts: {
  messageId: string;
  token: string;
}): Promise<MlMessagesPackResponse> {
  return mlFetch<MlMessagesPackResponse>(
    `/messages/${encodeURIComponent(opts.messageId)}`,
    { method: 'GET', token: opts.token }
  );
}

/**
 * Envia uma mensagem ao comprador.
 *
 * IMPORTANTE — nova arquitetura (a partir de 02/02/2026):
 *   - Para MLB e MLC, `to.user_id` deve ser o ID do Agente do site
 *     (ML_AGENT_USER_IDS), e NÃO o user_id real do comprador, quando a
 *     conversa estiver sendo intermediada por agente IA. Caso a conta
 *     ainda esteja na arquitetura antiga, use o user_id do comprador.
 *
 * Doc: https://developers.mercadolivre.com.br/pt_br/mensagens-post-venda#Enviar-mensagem-para-o-comprador
 */
export async function sendMessageToBuyer(opts: {
  packId: string;
  sellerId: string | number;
  toUserId: string | number;
  text: string;
  attachments?: string[]; // filenames retornados pelo upload
  token: string;
}): Promise<unknown> {
  const { packId, sellerId, toUserId, text, attachments, token } = opts;
  const body: Record<string, unknown> = {
    from: { user_id: String(sellerId) },
    to: { user_id: String(toUserId) },
    text,
  };
  if (attachments && attachments.length > 0) body.attachments = attachments;

  return mlFetch<unknown>(
    `/messages/packs/${encodeURIComponent(packId)}/sellers/${encodeURIComponent(String(sellerId))}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      token,
    }
  );
}

/**
 * Faz o upload de um anexo. Retorna a "key" (filename) que deve ser
 * referenciada na chamada de envio de mensagem.
 *
 * Limites: 25 MB, formatos JPG/PNG/PDF/TXT. Anexos não vinculados a uma
 * mensagem em 48h são removidos automaticamente pelo ML.
 *
 * Doc: https://developers.mercadolivre.com.br/pt_br/mensagens-post-venda#Carregar-e-salvar-um-anexo
 */
export async function uploadAttachment(opts: {
  file: Blob | File;
  filename?: string;
  siteId: string; // ex.: 'MLB'
  token: string;
}): Promise<{ id: string }> {
  const { file, filename, siteId, token } = opts;
  const form = new FormData();
  form.append('file', file, filename);

  const url = new URL(`${ML_API_BASE}/messages/attachments`);
  url.searchParams.set('site_id', siteId);
  withTagPostSale(url);

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Falha no upload de anexo: ${res.status} ${body}`);
  }

  return (await res.json()) as { id: string };
}

/**
 * Lista todas as conversas (do vendedor) com mensagens não lidas.
 * Use como mecanismo de "backfill" caso uma notificação tenha se perdido.
 *
 * Doc: https://developers.mercadolivre.com.br/pt_br/mensagens-pendentes#Mensagens-ainda-n%C3%A3o-lidas
 */
export async function getUnreadConversations(opts: {
  token: string;
  role?: 'seller' | 'buyer';
}): Promise<MlUnreadResponse> {
  const url = new URL(`${ML_API_BASE}/messages/unread`);
  url.searchParams.set('role', opts.role || 'seller');
  return mlFetch<MlUnreadResponse>(url.toString(), { method: 'GET', token: opts.token });
}

/**
 * Decide o user_id correto para o campo `to.user_id` ao enviar uma mensagem.
 *
 * Regra: se o site estiver na nova arquitetura (MLB/MLC a partir de 02/02/2026)
 * e a conversa estiver sendo intermediada por agente, devolve o Agent user_id;
 * caso contrário, devolve o `buyerId` original.
 *
 * Heurística simples: se `conversation_status.path` contém
 * "/conversations/" significa que está na nova arq. (path tipificado).
 */
export function resolveDestinationUserId(opts: {
  siteId: string;
  conversationStatusPath?: string | null;
  buyerId?: string | number | null;
}): string | number | undefined {
  const { siteId, conversationStatusPath, buyerId } = opts;
  const isNewArch =
    !!conversationStatusPath && conversationStatusPath.includes('/conversations/');
  if (isNewArch && ML_AGENT_USER_IDS[siteId]) {
    return ML_AGENT_USER_IDS[siteId];
  }
  return buyerId ?? undefined;
}

/**
 * Resolve `pack_id` a partir de um `order_id`.
 *
 * Quando a notificação de webhook é de "messages" e o `resource` é um
 * `message_id`, a melhor estratégia é usar getMessageById para extrair o
 * `pack_id` de `message_resources`. Para os casos em que só temos `order_id`
 * (ex.: notificação orders_v2), usamos /orders/{id} para obter o `pack_id`.
 */
export async function getPackIdFromOrder(opts: {
  orderId: string | number;
  token: string;
}): Promise<{ packId: string; sellerId?: number; buyerId?: number } | null> {
  try {
    const data = await mlFetch<any>(`/orders/${opts.orderId}`, {
      method: 'GET',
      token: opts.token,
    });
    const packId = data?.pack_id ? String(data.pack_id) : String(opts.orderId);
    return {
      packId,
      sellerId: data?.seller?.id,
      buyerId: data?.buyer?.id,
    };
  } catch (e) {
    console.warn('[ml/messaging] getPackIdFromOrder falhou', e);
    return null;
  }
}
