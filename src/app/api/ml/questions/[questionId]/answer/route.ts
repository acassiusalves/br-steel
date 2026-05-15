/**
 * POST /api/ml/questions/{questionId}/answer
 */

import { NextResponse } from 'next/server';
import { getPrimaryMlAccountIdAdmin } from '@/services/firestore-admin';
import { requirePagePermission } from '@/lib/server-auth';
import { toFirestoreJson } from '@/lib/firestore-json';
import { answerQuestion } from '@/services/ml/questions';
import { ML_QUESTION_ANSWER_MAX_LENGTH } from '@/lib/ml-question-types';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ questionId: string }> }
) {
  const auth = await requirePagePermission(request, '/atendimento/chat');
  if (!auth.ok) return auth.response;

  const { questionId } = await params;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  const accountId = body?.accountId
    ? String(body.accountId)
    : await getPrimaryMlAccountIdAdmin();
  const text = String(body?.text || '').trim();

  if (!text) {
    return NextResponse.json({ ok: false, error: 'Resposta vazia' }, { status: 400 });
  }
  if (text.length > ML_QUESTION_ANSWER_MAX_LENGTH) {
    return NextResponse.json(
      { ok: false, error: `Resposta maior que ${ML_QUESTION_ANSWER_MAX_LENGTH} caracteres` },
      { status: 400 }
    );
  }

  try {
    const result = await answerQuestion({ questionId, accountId, text });
    return NextResponse.json({
      ok: true,
      question: toFirestoreJson(result.question),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
