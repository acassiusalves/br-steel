import { NextResponse } from 'next/server';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  findUserByEmail,
  getSessionFromRequest,
  hashPassword,
  sessionCookieHeader,
  createSessionToken,
  verifyPassword,
} from '@/lib/server-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(request: Request) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  const name = String(body?.name || '').trim();
  const currentPassword = String(body?.currentPassword || '');
  const newPassword = String(body?.newPassword || '');
  if (!name) return NextResponse.json({ ok: false, error: 'Nome é obrigatório.' }, { status: 400 });

  const stored = await findUserByEmail(session.user.email);
  if (!stored) {
    return NextResponse.json({ ok: false, error: 'Usuário não encontrado.' }, { status: 404 });
  }

  const update: Record<string, unknown> = {
    name,
    updatedAt: new Date().toISOString(),
  };
  const effectiveMustChangePassword = !!stored.mustChangePassword || !stored.passwordHash;

  if (newPassword) {
    if (newPassword.length < 6) {
      return NextResponse.json(
        { ok: false, error: 'A nova senha deve ter pelo menos 6 caracteres.' },
        { status: 400 }
      );
    }
    if (!effectiveMustChangePassword && !verifyPassword(currentPassword, stored.passwordHash, stored.passwordSalt)) {
      return NextResponse.json({ ok: false, error: 'Senha atual inválida.' }, { status: 401 });
    }
    const { hash, salt } = hashPassword(newPassword);
    update.passwordHash = hash;
    update.passwordSalt = salt;
    update.mustChangePassword = false;
  }

  await setDoc(doc(db, 'users', stored.id), update, { merge: true });

  const user = {
    id: stored.id,
    name,
    email: stored.email,
    role: stored.role,
    mustChangePassword: newPassword ? false : effectiveMustChangePassword,
  };
  const response = NextResponse.json({ ok: true, user });
  response.headers.set(
    'Set-Cookie',
    sessionCookieHeader(
      createSessionToken({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      })
    )
  );
  return response;
}
