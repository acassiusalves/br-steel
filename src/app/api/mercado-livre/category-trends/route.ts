import { NextResponse, type NextRequest } from 'next/server';
import { requirePagePermission } from '@/lib/server-auth';
import { loadMercadoLivreCategoryTrends } from '@/services/mercado-livre-catalog-search';

export const runtime = 'nodejs';

const responseCache = new Map<string, { expiresAt: number; data: Awaited<ReturnType<typeof loadMercadoLivreCategoryTrends>> }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function POST(request: NextRequest) {
  const permission = await requirePagePermission(request, '/buscar-mercado-livre');
  if (!permission.ok) return permission.response;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const accountId = asTrimmedString(body.accountId);
    const categoryId = asTrimmedString(body.categoryId);

    if (!accountId) {
      return NextResponse.json({ ok: false, error: 'Selecione uma conta do Mercado Livre.' }, { status: 400 });
    }

    if (!categoryId) {
      return NextResponse.json({ ok: false, error: 'Informe a categoria para consultar tendências.' }, { status: 400 });
    }

    const cacheKey = `${accountId}:${categoryId}`;
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({ ok: true, ...cached.data, cached: true });
    }

    const data = await loadMercadoLivreCategoryTrends({ accountId, categoryId });
    responseCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data });

    return NextResponse.json({ ok: true, ...data, cached: false });
  } catch (error) {
    console.error('[mercado-livre/category-trends] Falha ao buscar tendências:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Falha ao buscar tendências da categoria.' },
      { status: 500 }
    );
  }
}
