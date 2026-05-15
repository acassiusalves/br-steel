/**
 * Sincronização das perguntas pré-venda do Mercado Livre com o Firestore.
 *
 * Docs oficiais:
 *   - https://developers.mercadolivre.com.br/devcenter/perguntas-e-respostas
 *   - https://developers.mercadolivre.com.br/pt_br/relatorios-de-faturamento/gerenciamento-perguntas-respostas
 */

import { adminDb } from '@/lib/firebase-admin';
import { getMlToken } from '@/services/mercadolivre';
import type {
  MlQuestionDoc,
  MlQuestionQueueStatus,
  MlQuestionSearchResponse,
  MlQuestionStatus,
} from '@/lib/ml-question-types';
import { ML_QUESTION_ANSWER_MAX_LENGTH } from '@/lib/ml-question-types';

const ML_API_BASE = 'https://api.mercadolibre.com';
const QUESTIONS_COLL = 'mercadoLivreQuestions';
const WEBHOOK_EVENTS_COLL = 'mercadoLivreWebhookEvents';

function toEpoch(iso?: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function cleanString(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  ) as T;
}

async function mlFetch<T>(
  pathOrUrl: string,
  init: RequestInit & { token: string }
): Promise<T> {
  const url = pathOrUrl.startsWith('http') ? new URL(pathOrUrl) : new URL(`${ML_API_BASE}${pathOrUrl}`);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${init.token}`);

  const res = await fetch(url, {
    ...init,
    headers,
    cache: 'no-store',
  });

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!res.ok) {
    const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '');
    const message =
      (body && typeof body === 'object' && 'message' in body && (body as any).message) ||
      (typeof body === 'string' && body) ||
      res.statusText;
    const err = new Error(`ML API ${res.status}: ${message}`);
    (err as any).status = res.status;
    (err as any).body = body;
    throw err;
  }

  if (isJson) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

async function resolveSellerId(accountId: string): Promise<number | string | null> {
  const snap = await adminDb.collection('mercadoLivreAccounts').doc(accountId).get();
  if (!snap.exists) return null;
  const data = snap.data() as any;
  return data?.sellerId ?? data?.userId ?? null;
}

function readQuestionId(resource: string): string {
  return resource.replace(/^\/?questions\//, '').replace(/^\//, '').trim();
}

function readBuyerName(raw: any): string | null {
  return (
    cleanString(raw?.buyer?.nickname) ||
    cleanString(raw?.from?.nickname) ||
    cleanString(raw?.buyer?.name) ||
    cleanString(raw?.from?.name) ||
    cleanString([raw?.buyer?.first_name, raw?.buyer?.last_name].filter(Boolean).join(' ')) ||
    cleanString([raw?.from?.first_name, raw?.from?.last_name].filter(Boolean).join(' ')) ||
    null
  );
}

function inferQueueStatus(
  rawStatus: MlQuestionStatus,
  existing?: MlQuestionDoc
): MlQuestionQueueStatus {
  const status = String(rawStatus || '').toUpperCase();
  if (status === 'ANSWERED') return 'answered';
  if (['CLOSED_UNANSWERED', 'BANNED', 'DELETED', 'DISABLED'].includes(status)) {
    return existing?.queueStatus || 'ignored';
  }
  return existing?.queueStatus && existing.queueStatus !== 'answered'
    ? existing.queueStatus
    : 'new';
}

function normalizeQuestion(args: {
  raw: any;
  accountId: string;
  item?: any | null;
  existing?: MlQuestionDoc;
  sourceEventId?: string | null;
}): MlQuestionDoc {
  const { raw, accountId, item, existing, sourceEventId } = args;
  const now = Date.now();
  const id = String(raw?.id ?? existing?.id ?? '');
  const status = String(raw?.status || existing?.status || 'UNANSWERED') as MlQuestionStatus;
  const answer = raw?.answer || null;
  const dateCreated = cleanString(raw?.date_created) || existing?.dateCreated || null;
  const itemId = cleanString(raw?.item_id || raw?.item?.id) || existing?.itemId || null;
  const buyerId =
    raw?.buyer_id ??
    raw?.buyer?.id ??
    raw?.from?.id ??
    existing?.buyerId ??
    null;

  return stripUndefined({
    id,
    accountId,
    sellerId: raw?.seller_id ?? raw?.seller?.id ?? existing?.sellerId ?? null,
    buyerId,
    buyerName: readBuyerName(raw) || existing?.buyerName || null,
    buyerEmail:
      cleanString(raw?.buyer?.email) ||
      cleanString(raw?.from?.email) ||
      existing?.buyerEmail ||
      null,
    itemId,
    itemTitle:
      cleanString(item?.title) ||
      cleanString(raw?.item?.title) ||
      existing?.itemTitle ||
      itemId,
    itemPermalink:
      cleanString(item?.permalink) ||
      cleanString(raw?.item?.permalink) ||
      existing?.itemPermalink ||
      null,
    thumbnail:
      cleanString(item?.secure_thumbnail) ||
      cleanString(item?.thumbnail) ||
      cleanString(raw?.item?.thumbnail) ||
      existing?.thumbnail ||
      null,
    text: cleanString(raw?.text) || existing?.text || '',
    status,
    answerText: cleanString(answer?.text) || existing?.answerText || null,
    answerStatus: cleanString(answer?.status) || existing?.answerStatus || null,
    answeredAt: cleanString(answer?.date_created) || existing?.answeredAt || null,
    queueStatus: inferQueueStatus(status, existing),
    assignedTo: existing?.assignedTo || null,
    sortKey: toEpoch(dateCreated) || existing?.sortKey || now,
    dateCreated,
    sourceEventId: sourceEventId || existing?.sourceEventId || null,
    syncedAt: now,
    updatedAt: now,
    createdAt: existing?.createdAt || now,
  });
}

async function getItemDetails(opts: {
  itemId?: string | null;
  token: string;
}): Promise<any | null> {
  if (!opts.itemId) return null;
  try {
    return await mlFetch<any>(`/items/${encodeURIComponent(opts.itemId)}`, {
      method: 'GET',
      token: opts.token,
    });
  } catch (e: any) {
    const status = Number(e?.status || 0);
    if (status && status !== 404) {
      console.warn('[ml/questions] getItemDetails falhou', {
        itemId: opts.itemId,
        error: e?.message || e,
      });
    }
    return null;
  }
}

export async function getQuestionById(opts: {
  questionId: string | number;
  token: string;
}): Promise<any> {
  const url = new URL(`${ML_API_BASE}/questions/${encodeURIComponent(String(opts.questionId))}`);
  url.searchParams.set('api_version', '4');
  return mlFetch<any>(url.toString(), { method: 'GET', token: opts.token });
}

export async function listReceivedQuestions(opts: {
  accountId: string;
  sellerId?: string | number | null;
  status?: string | null;
  limit?: number;
  offset?: number;
}): Promise<MlQuestionSearchResponse> {
  const token = await getMlToken(opts.accountId);
  const sellerId = opts.sellerId ?? (await resolveSellerId(opts.accountId));
  if (!sellerId) throw new Error('sellerId não resolvido para buscar perguntas');

  const limit = Math.min(Math.max(Number(opts.limit || 50), 1), 100);
  const offset = Math.max(Number(opts.offset || 0), 0);
  const url = new URL(`${ML_API_BASE}/questions/search`);
  url.searchParams.set('seller_id', String(sellerId));
  url.searchParams.set('api_version', '4');
  url.searchParams.set('sort_fields', 'date_created');
  url.searchParams.set('sort_types', 'DESC');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  if (opts.status && opts.status !== 'all') {
    url.searchParams.set('status', opts.status);
  }

  try {
    return await mlFetch<MlQuestionSearchResponse>(url.toString(), {
      method: 'GET',
      token,
    });
  } catch (e: any) {
    if (Number(e?.status || 0) === 404) {
      return { total: 0, limit, offset, questions: [] };
    }
    throw e;
  }
}

export async function syncQuestion(opts: {
  questionId: string | number;
  accountId: string;
  sourceEventId?: string | null;
  rawQuestion?: any;
}): Promise<{ question: MlQuestionDoc }> {
  const token = await getMlToken(opts.accountId);
  const raw = opts.rawQuestion || (await getQuestionById({ questionId: opts.questionId, token }));
  const id = String(raw?.id || opts.questionId);
  const ref = adminDb.collection(QUESTIONS_COLL).doc(id);
  const existingSnap = await ref.get();
  const existing = existingSnap.exists ? (existingSnap.data() as MlQuestionDoc) : undefined;
  const itemId = cleanString(raw?.item_id || raw?.item?.id) || existing?.itemId || null;
  const item = await getItemDetails({ itemId, token });
  const question = normalizeQuestion({
    raw: { ...raw, id },
    accountId: opts.accountId,
    item,
    existing,
    sourceEventId: opts.sourceEventId,
  });
  await ref.set(question, { merge: true });
  return { question };
}

export async function backfillQuestionsForAccount(
  accountId: string,
  opts: { status?: string | null; limit?: number } = {}
): Promise<{ scanned: number; synced: number; errors: number }> {
  const response = await listReceivedQuestions({
    accountId,
    status: opts.status || 'UNANSWERED',
    limit: opts.limit || 50,
  });
  const questions = response.questions || [];
  let synced = 0;
  let errors = 0;

  for (const raw of questions) {
    const id = raw?.id;
    if (!id) continue;
    try {
      await syncQuestion({ questionId: id, accountId, rawQuestion: raw });
      synced++;
    } catch (e) {
      console.error('[ml/questions] backfill falhou', { questionId: id, e });
      errors++;
    }
  }

  return { scanned: questions.length, synced, errors };
}

export async function listQuestionDocs(
  accountId: string,
  maxRows = 250
): Promise<MlQuestionDoc[]> {
  const snap = await adminDb
    .collection(QUESTIONS_COLL)
    .where('accountId', '==', accountId)
    .limit(Math.min(Math.max(maxRows, 1), 500))
    .get();

  return snap.docs
    .map((doc) => ({ ...(doc.data() as MlQuestionDoc), id: doc.id }))
    .sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));
}

export async function loadQuestionDoc(
  questionId: string,
  accountId?: string | null
): Promise<MlQuestionDoc | null> {
  const snap = await adminDb.collection(QUESTIONS_COLL).doc(questionId).get();
  if (!snap.exists) return null;
  const question = { ...(snap.data() as MlQuestionDoc), id: snap.id };
  if (accountId && String(question.accountId) !== String(accountId)) return null;
  return question;
}

export async function updateQuestionDoc(opts: {
  questionId: string;
  accountId: string;
  queueStatus?: MlQuestionQueueStatus;
  assignedTo?: MlQuestionDoc['assignedTo'];
}): Promise<MlQuestionDoc | null> {
  const existing = await loadQuestionDoc(opts.questionId, opts.accountId);
  if (!existing) return null;

  const update: Record<string, unknown> = { updatedAt: Date.now() };
  if (opts.queueStatus !== undefined) update.queueStatus = opts.queueStatus;
  if (opts.assignedTo !== undefined) update.assignedTo = opts.assignedTo;

  await adminDb.collection(QUESTIONS_COLL).doc(opts.questionId).set(update, { merge: true });
  return loadQuestionDoc(opts.questionId, opts.accountId);
}

export async function answerQuestion(opts: {
  questionId: string | number;
  accountId: string;
  text: string;
}): Promise<{ question: MlQuestionDoc; raw: any }> {
  const text = opts.text.trim();
  if (!text) throw new Error('Resposta vazia');
  if (text.length > ML_QUESTION_ANSWER_MAX_LENGTH) {
    throw new Error(`Resposta maior que ${ML_QUESTION_ANSWER_MAX_LENGTH} caracteres`);
  }

  const token = await getMlToken(opts.accountId);
  const numericQuestionId = Number(opts.questionId);
  const raw = await mlFetch<any>('/answers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question_id: Number.isFinite(numericQuestionId) ? numericQuestionId : opts.questionId,
      text,
    }),
    token,
  });
  const synced = await syncQuestion({
    questionId: String(raw?.id || opts.questionId),
    accountId: opts.accountId,
    rawQuestion: raw,
  });
  return { question: synced.question, raw };
}

export async function processQuestionsWebhookEvent(opts: {
  resource: string;
  userId: number | string;
  accountId: string;
  eventId?: string | null;
}): Promise<{ ok: true; questionId: string } | { ok: false; reason: string }> {
  const questionId = readQuestionId(opts.resource);
  if (!questionId) return { ok: false, reason: 'question_id_ausente' };

  try {
    await syncQuestion({
      questionId,
      accountId: opts.accountId,
      sourceEventId: opts.eventId || null,
    });
    return { ok: true, questionId };
  } catch (e: any) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export async function drainPendingQuestionEvents(opts: { limit?: number } = {}): Promise<{
  processed: number;
  failed: number;
}> {
  const limit = opts.limit ?? 50;
  const snap = await adminDb
    .collection(WEBHOOK_EVENTS_COLL)
    .where('topic', '==', 'questions')
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
      const result = await processQuestionsWebhookEvent({
        resource: ev.resource,
        userId: ev.user_id,
        accountId: ev.accountId,
        eventId: doc.id,
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
