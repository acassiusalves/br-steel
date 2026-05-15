/**
 * Tipos para o módulo de Chat Pós-Venda do Mercado Livre.
 *
 * Documentação oficial:
 *   - https://developers.mercadolivre.com.br/pt_br/mensagens-post-venda
 *   - https://developers.mercadolivre.com.br/pt_br/mensagens-pendentes
 *   - https://developers.mercadolivre.com.br/pt_br/mensagens-bloqueadas
 *
 * Modelo no Firestore:
 *   mercadoLivreConversations/{packId}             ← metadados da conversa
 *     └─ messages/{messageId}                       ← mensagens (subcoleção)
 */

/**
 * Substatus possíveis de uma conversa bloqueada (lista oficial da doc).
 * Mantemos como string aberta para suportar novos códigos sem quebrar.
 */
export type MlConversationSubstatus =
  | 'blocked_by_time'
  | 'blocked_by_buyer'
  | 'blocked_by_mediation'
  | 'blocked_by_fulfillment'
  | 'blocked_by_payment'
  | 'blocked_by_conversation_initiated_by_seller'
  | 'blocked_by_conversation_use_message_api'
  | 'blocked_by_conversation_initiated_by_seller_limited'
  | 'blocked_by_cancelled_order'
  | 'blocked_by_cancelled_order_by_fraud'
  | 'blocked_by_mediation_fbm'
  | 'blocked_by_conversation_expired'
  | 'blocked_by_refund'
  | 'blocked_by_claim_change_closed'
  | 'blocked_by_claim_change_open'
  | 'blocked_by_deactivated_account'
  | 'blocked_by_restrictions'
  | 'blocked_by_cancelled_order_hidden'
  | 'blocked_by_message_pending_review'
  | 'blocked_by_return_to_buyer_fulfillment'
  | 'blocked_by_ai_assistant'
  | 'blocked_by_ai_assistant_expired'
  | 'blocked_by_ai_assistant_contact_closed'
  | string;

export type MlConversationStatus = 'active' | 'blocked' | string;

export type MlSupportQueueStatus =
  | 'new'
  | 'open'
  | 'waiting_customer'
  | 'resolved'
  | 'ignored';

export type MlSupportPriority = 'low' | 'normal' | 'high' | 'urgent';

/** Status de moderação aplicado pelo ML em uma mensagem. */
export type MlMessageModerationStatus =
  | 'clean'
  | 'pending'
  | 'rejected'
  | 'non_moderated'
  | 'NON_MODERATED'
  | 'IN_MODERATION'
  | string;

/** Status geral da mensagem retornado pela API. */
export type MlMessageStatus =
  | 'available'
  | 'moderated'
  | 'rejected'
  | 'pending_translation'
  | 'IN_MODERATION'
  | string;

/** Anexo conforme retornado pelo ML. */
export interface MlAttachment {
  /** Filename do ML (também é a "key" usada no POST de envio). */
  filename: string;
  original_filename?: string;
  type?: string; // mime/type
  size?: number;
  potential_security_threat?: boolean;
  creation_date?: string;
}

/** Estrutura de mensagem persistida no Firestore (já normalizada). */
export interface MlChatMessageDoc {
  /** ID único do ML (também é o ID do documento). */
  id: string;
  packId: string;
  accountId: string; // conta interna (mercadoLivreAccounts/{accountId})
  sellerId: number;  // user_id do vendedor (nossa conta)
  siteId: string;    // ex.: 'MLB'

  /** Direção da mensagem em relação ao vendedor. */
  direction: 'in' | 'out';

  fromUserId: number | string | null;
  toUserId: number | string | null;

  /** True quando 'to' é o Agent de IA (nova arquitetura MLB ≥ 2026-02). */
  toIsAgent?: boolean;

  text: string;
  attachments?: MlAttachment[];

  status?: MlMessageStatus;
  moderation?: {
    status?: MlMessageModerationStatus;
    reason?: string | null;
    source?: string | null;
    moderationDate?: string | null;
  };

  /** Datas relevantes (ISO strings) — `read` é null até o destinatário ler. */
  dates: {
    created?: string | null;
    received?: string | null;
    available?: string | null;
    notified?: string | null;
    read?: string | null;
  };

  /** Ordem para sort estável (ms epoch). */
  sortKey: number;

  /** Indica que foi enviada otimisticamente pelo cliente e ainda não confirmada. */
  pendingClient?: boolean;
  /** Erro de envio (apenas para mensagens out com pendingClient). */
  sendError?: string | null;

  /** Carimbos internos. */
  syncedAt: number; // Date.now()
  updatedAt: number;
}

/** Documento de conversa no Firestore. */
export interface MlChatConversationDoc {
  /** ID do pacote (também é o ID do documento). */
  packId: string;
  /** accountId interno da conta ML deste vendedor. */
  accountId: string;
  /** user_id do vendedor (igual ao da conta ML). */
  sellerId: number;
  /** site_id (MLB, MLA, MLC, …) — herdado da primeira mensagem. */
  siteId?: string;
  /** user_id do comprador (ou Agent IA na nova arq.). */
  buyerId?: number | string | null;
  /** Nome/nickname do comprador, quando conhecido. */
  buyerName?: string | null;
  buyerEmail?: string | null;

  /** Lista de orders associadas ao pacote. */
  orderIds?: string[];
  /** Títulos dos itens associados ao pedido/pacote, quando resolvidos. */
  itemTitles?: string[];

  /** Última mensagem - usado para listagem ordenada. */
  lastMessageAt?: number | null; // ms epoch
  lastMessagePreview?: string;
  lastMessageDirection?: 'in' | 'out';

  /** Contagem de mensagens não lidas (vindas do comprador). */
  unreadCount: number;

  /** Status da conversa segundo ML. */
  status: MlConversationStatus;
  substatus?: MlConversationSubstatus | null;
  statusDate?: string | null;
  conversationStatusPath?: string | null;
  /** Permite UI desabilitar input quando status_update_allowed = false. */
  statusUpdateAllowed?: boolean;

  claimId?: string | number | null;
  shippingId?: string | number | null;

  /** Limites informados pela API. */
  sellerMaxMessageLength?: number;
  buyerMaxMessageLength?: number;

  /** Metadados internos para operação da fila de atendimento. */
  queueStatus?: MlSupportQueueStatus;
  priority?: MlSupportPriority;
  tags?: string[];
  assignedTo?: {
    id?: string | null;
    name?: string | null;
    email?: string | null;
  } | null;
  firstUnreadAt?: number | null;
  lastCustomerMessageAt?: number | null;
  lastHumanReplyAt?: number | null;
  slaDueAt?: number | null;
  ai?: {
    summary?: string;
    intent?: string;
    urgency?: MlSupportPriority;
    confidence?: number;
    suggestedReply?: string;
    nextAction?: string;
    risks?: string[];
    needsHumanReview?: boolean;
    status?: 'ready' | 'needs_review' | 'error';
    lastError?: string | null;
    updatedAt?: number;
  };

  /** Última sincronização com o ML. */
  syncedAt: number;
  updatedAt: number;
  createdAt: number;
}

/** Resposta crua do endpoint /messages/packs/{}/sellers/{} (para tipagem do cliente HTTP). */
export interface MlMessagesPackResponse {
  paging?: { limit: number; offset: number; total: number };
  conversation_status?: {
    path?: string;
    status?: string;
    substatus?: string | null;
    status_date?: string | null;
    status_update_allowed?: boolean;
    claim_id?: string | number | null;
    claim_ids?: Array<string | number> | null;
    shipping_id?: string | number | null;
  };
  messages?: Array<{
    id: string;
    site_id?: string;
    client_id?: number;
    from?: {
      user_id?: number | string;
      email?: string;
      name?: string;
    };
    to?: {
      user_id?: number | string;
    };
    status?: string;
    subject?: string | null;
    text?: string;
    message_date?: {
      received?: string | null;
      available?: string | null;
      notified?: string | null;
      created?: string | null;
      read?: string | null;
    };
    message_moderation?: {
      status?: string;
      reason?: string | null;
      source?: string | null;
      moderation_date?: string | null;
      by?: string | null;
    };
    message_attachments?: MlAttachment[] | null;
    message_resources?: Array<{ id: string; name: string }>;
    conversation_first_message?: boolean;
  }>;
  seller_max_message_length?: number;
  buyer_max_message_length?: number;
}

/** Resposta crua de /messages/unread?role=seller */
export interface MlUnreadResponse {
  user_id: number | string;
  results: Array<{
    resource: string; // ex.: "/packs/2000000089077943/sellers/415458330"
    count: number;
  }>;
}

/**
 * IDs dos Agentes de IA por site (nova arquitetura a partir de 02/02/2026).
 * Para MLB/MLC, o POST de envio deve usar o Agent como `to.user_id` (ML
 * encaminha ao comprador real).
 */
export const ML_AGENT_USER_IDS: Record<string, number> = {
  MLC: 3020819166,
  MCO: 3037204123,
  MLM: 3037204279,
  MLA: 3037674934,
  MLB: 3037675074,
  MLU: 3037204685,
};

/** Limite máximo de caracteres por mensagem (vendedor). */
export const ML_MESSAGE_MAX_LENGTH = 350;

/** Tamanho máximo de anexo, em bytes. */
export const ML_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** Extensões aceitas para anexo. */
export const ML_ATTACHMENT_ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'pdf', 'txt'] as const;
