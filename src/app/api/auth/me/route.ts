import { NextResponse } from 'next/server';
import { getSessionFromRequest, loadAppAccessSettings } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const access = await loadAppAccessSettings();
  return NextResponse.json({ ok: true, user: session.user, ...access });
}
