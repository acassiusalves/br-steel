/**
 * GET/PATCH /api/ml/questions/{questionId}
 */

import { NextResponse } from 'next/server';
import { getPrimaryMlAccountIdAdmin } from '@/services/firestore-admin';
import { requirePagePermission } from '@/lib/server-auth';
import { toFirestoreJson } from '@/lib/firestore-json';
import {
  loadQuestionDoc,
  syncQuestion,
  updateQuestionDoc,
} from '@/services/ml/questions';
import type { MlQuestionQueueStatus } from '@/lib/ml-question-types';

export const dynamic = 'force-dynamic';

const ALLOWED_QUEUE_STATUSES: MlQuestionQueueStatus[] = ['new', 'open', 'answered', 'ignored'];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ questionId: string }> }
) {
  const auth = await requirePagePermission(request, '/atendimento/chat');
  if (!auth.ok) return auth.response;

  const { questionId } = await params;
  const url = new URL(request.url);
  const accountId = url.searchParams.get('accountId') || (await getPrimaryMlAccountIdAdmin());
  const sync = url.searchParams.get('sync') === '1';

  try {
    if (sync) await syncQuestion({ questionId, accountId });
    const question = await loadQuestionDoc(questionId, accountId);
    if (!question) {
      return NextResponse.json({ ok: false, error: 'Pergunta não encontrada' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, question: toFirestoreJson(question) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function PATCH(
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
  const update: Parameters<typeof updateQuestionDoc>[0] = { questionId, accountId };

  if (body.queueStatus !== undefined) {
    if (!ALLOWED_QUEUE_STATUSES.includes(body.queueStatus)) {
      return NextResponse.json({ ok: false, error: 'queueStatus inválido' }, { status: 400 });
    }
    update.queueStatus = body.queueStatus;
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

  try {
    const question = await updateQuestionDoc(update);
    if (!question) {
      return NextResponse.json({ ok: false, error: 'Pergunta não encontrada' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, question: toFirestoreJson(question) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
