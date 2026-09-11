import 'server-only';
import { NextResponse } from 'next/server';

export function rejectCrossOrigin(request: Request) {
  const expected = new URL(process.env.APP_ORIGIN || request.url).origin;
  if (request.headers.get('origin') !== expected) {
    return NextResponse.json({ ok: false, error: 'Origem não autorizada.' }, { status: 403 });
  }
}
