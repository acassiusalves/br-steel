import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireWebContext } from '@/server/operations/context';
import { requireOperation, OperationError } from '@/server/operations/common';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    requireOperation(await requireWebContext(request), 'vendas:read');
    const snapshot = await adminDb.collection('appConfig').doc('syncProgress').get();
    return NextResponse.json({ progress: snapshot.data() ?? null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ progress: null, error: 'Não foi possível consultar a sincronização.' }, { status: error instanceof OperationError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
