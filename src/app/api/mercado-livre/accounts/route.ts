import { NextResponse, type NextRequest } from 'next/server';
import { requirePagePermission } from '@/lib/server-auth';
import { listMercadoLivreAccountSummaries } from '@/services/mercado-livre-catalog-search';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const permission = await requirePagePermission(request, '/buscar-mercado-livre');
  if (!permission.ok) return permission.response;

  try {
    const accounts = await listMercadoLivreAccountSummaries();
    return NextResponse.json({ ok: true, accounts });
  } catch (error) {
    console.error('[mercado-livre/accounts] Falha ao listar contas:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Falha ao listar contas do Mercado Livre.' },
      { status: 500 }
    );
  }
}
