/**
 * POST /api/ml/chat/attachments
 *
 * Faz upload de um anexo para a API de mensageria do ML.
 *
 * Form-data:
 *   - file:        Blob (obrigatório). Max 25MB. JPG/PNG/PDF/TXT.
 *   - accountId:   string (opcional, default: primária)
 *   - siteId:      string (opcional, default: 'MLB')
 *
 * Resposta: { ok: true, id: '<filename>' }  // use esse id em "attachments" do send
 */

import { NextResponse } from 'next/server';
import { uploadAttachment } from '@/services/ml/messaging';
import { getMlToken } from '@/services/mercadolivre';
import { getPrimaryMlAccountIdAdmin } from '@/services/firestore-admin';
import {
  ML_ATTACHMENT_ALLOWED_EXTS,
  ML_ATTACHMENT_MAX_BYTES,
} from '@/lib/ml-chat-types';
import { requirePagePermission } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = await requirePagePermission(request, '/atendimento/chat');
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'multipart inválido' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ ok: false, error: 'campo "file" ausente' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: 'arquivo vazio' }, { status: 400 });
  }
  if (file.size > ML_ATTACHMENT_MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: 'arquivo maior que 25 MB' },
      { status: 413 }
    );
  }

  const filename = (file as File).name || 'attachment.bin';
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (!ML_ATTACHMENT_ALLOWED_EXTS.includes(ext as any)) {
    return NextResponse.json(
      { ok: false, error: `extensão .${ext} não permitida (use JPG/PNG/PDF/TXT)` },
      { status: 415 }
    );
  }

  const accountId = (form.get('accountId') as string) || (await getPrimaryMlAccountIdAdmin());
  const siteId = (form.get('siteId') as string) || 'MLB';

  try {
    const token = await getMlToken(accountId);
    const result = await uploadAttachment({ file, filename, siteId, token });
    return NextResponse.json({ ok: true, id: result.id, filename: result.id });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 502 }
    );
  }
}
