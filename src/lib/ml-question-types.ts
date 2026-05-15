/**
 * Tipos para perguntas pré-venda do Mercado Livre.
 *
 * Modelo no Firestore:
 *   mercadoLivreQuestions/{questionId}
 */

export const ML_QUESTION_ANSWER_MAX_LENGTH = 2000;

export type MlQuestionStatus =
  | 'UNANSWERED'
  | 'ANSWERED'
  | 'CLOSED_UNANSWERED'
  | 'UNDER_REVIEW'
  | 'BANNED'
  | 'DELETED'
  | 'DISABLED'
  | string;

export type MlQuestionQueueStatus = 'new' | 'open' | 'answered' | 'ignored';

export interface MlQuestionDoc {
  id: string;
  accountId: string;
  sellerId?: number | string | null;
  buyerId?: number | string | null;
  buyerName?: string | null;
  buyerEmail?: string | null;

  itemId?: string | null;
  itemTitle?: string | null;
  itemPermalink?: string | null;
  thumbnail?: string | null;

  text: string;
  status: MlQuestionStatus;
  answerText?: string | null;
  answerStatus?: string | null;
  answeredAt?: string | null;

  queueStatus?: MlQuestionQueueStatus;
  assignedTo?: {
    id?: string | null;
    name?: string | null;
    email?: string | null;
  } | null;

  sortKey: number;
  dateCreated?: string | null;
  sourceEventId?: string | null;

  syncedAt: number;
  updatedAt: number;
  createdAt?: number;
}

export interface MlQuestionSearchResponse {
  total?: number;
  limit?: number;
  offset?: number;
  questions?: any[];
}
