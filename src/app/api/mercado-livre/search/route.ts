import { NextResponse, type NextRequest } from 'next/server';
import { requirePagePermission } from '@/lib/server-auth';
import {
  loadMercadoLivrePublishedPresence,
  parseSearchPayload,
  runMercadoLivreCatalogSearch,
} from '@/services/mercado-livre-catalog-search';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const permission = await requirePagePermission(request, '/buscar-mercado-livre');
  if (!permission.ok) return permission.response;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const payload = parseSearchPayload(body);

    if (!payload.accountId) {
      return NextResponse.json({ ok: false, error: 'Selecione uma conta do Mercado Livre.' }, { status: 400 });
    }

    if (!payload.query) {
      return NextResponse.json({ ok: false, error: 'Informe um termo, ID ou URL para buscar.' }, { status: 400 });
    }

    const search = await runMercadoLivreCatalogSearch({
      ...payload,
      accountId: payload.accountId,
      query: payload.query,
    });
    const publishedPresence = await loadMercadoLivrePublishedPresence(search.results);

    return NextResponse.json({ ok: true, ...search, publishedPresence });
  } catch (error) {
    console.error('[mercado-livre/search] Falha na busca:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Falha ao buscar no Mercado Livre.' },
      { status: 500 }
    );
  }
}
