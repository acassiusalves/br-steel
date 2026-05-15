import { NextResponse } from 'next/server';
import {
  createSessionToken,
  findUserByEmail,
  loadAppAccessSettings,
  sessionCookieHeader,
  verifyPassword,
} from '@/lib/server-auth';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!email || !password) {
    return NextResponse.json({ ok: false, error: 'E-mail e senha são obrigatórios.' }, { status: 400 });
  }

  const user = await findUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash, user.passwordSalt)) {
    return NextResponse.json({ ok: false, error: 'Usuário ou senha inválidos.' }, { status: 401 });
  }

  const sessionUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
  await setDoc(doc(db, 'users', user.id), { lastLogin: new Date().toISOString() }, { merge: true })
    .catch(() => undefined);
  const token = createSessionToken(sessionUser);
  const access = await loadAppAccessSettings();
  const response = NextResponse.json({
    ok: true,
    user: {
      ...sessionUser,
      mustChangePassword: !!user.mustChangePassword || !user.passwordHash,
    },
    ...access,
  });
  response.headers.set('Set-Cookie', sessionCookieHeader(token));
  return response;
}
