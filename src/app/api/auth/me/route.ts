import { NextResponse } from 'next/server';
import { findUserByEmail, getSessionFromRequest, loadAppAccessSettings } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const stored = await findUserByEmail(session.user.email);
  if (!stored) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const user = {
    id: stored.id,
    name: stored.name,
    email: stored.email,
    role: stored.role,
    mustChangePassword: !!stored.mustChangePassword || !stored.passwordHash,
  };
  const access = await loadAppAccessSettings();
  return NextResponse.json({ ok: true, user, ...access });
}
