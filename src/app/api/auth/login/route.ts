import { NextResponse } from 'next/server';
import {
  createSessionToken,
  findUserByEmail,
  loadAppAccessSettings,
  sessionCookieHeader,
  verifyPassword,
} from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { isKnownRole, publicUser } from '@/server/access/users';
import { rejectCrossOrigin } from '@/server/access/request';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || email.length > 254 || !password || password.length > 1024) {
    return NextResponse.json({ ok: false, error: 'E-mail e senha são obrigatórios.' }, { status: 400 });
  }

  const user = await findUserByEmail(email);
  if (!user || user.active === false || !isKnownRole(user.role) || !verifyPassword(password, user.passwordHash, user.passwordSalt)) {
    return NextResponse.json({ ok: false, error: 'Usuário ou senha inválidos.' }, { status: 401 });
  }

  await adminDb.collection('users').doc(user.id).update({ lastLogin: new Date().toISOString() });
  const token = createSessionToken(user, user.authVersion);
  const access = await loadAppAccessSettings();
  const response = NextResponse.json({
    ok: true,
    user: publicUser(user),
    ...access,
  });
  response.headers.set('Set-Cookie', sessionCookieHeader(token));
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
