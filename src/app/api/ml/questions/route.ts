/**
 * GET /api/ml/questions
 *   Lista perguntas pré-venda locais e, opcionalmente, busca novas no ML.
 */

import { NextResponse } from 'next/server';
import { getPrimaryMlAccountIdAdmin } from '@/services/firestore-admin';
import { requirePagePermission } from '@/lib/server-auth';
import { toFirestoreJson } from '@/lib/firestore-json';
import {
  backfillQuestionsForAccount,
  listQuestionDocs,
} from '@/services/ml/questions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requirePagePermission(request, '/atendimento/chat');
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const accountId = url.searchParams.get('accountId') || (await getPrimaryMlAccountIdAdmin());
  const backfill = url.searchParams.get('backfill') === '1';
  const status = url.searchParams.get('status') || 'UNANSWERED';
  const maxRows = Math.min(Math.max(Number(url.searchParams.get('limit') || 250), 1), 500);

  try {
    const result = backfill
      ? await backfillQuestionsForAccount(accountId, { status, limit: Math.min(maxRows, 100) })
      : null;
    const questions = await listQuestionDocs(accountId, maxRows);
    return NextResponse.json({
      ok: true,
      accountId,
      questions: toFirestoreJson(questions),
      ...(result || { hint: 'use ?backfill=1 para sincronizar' }),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
