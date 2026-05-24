import { NextResponse, type NextRequest } from 'next/server';
import { requirePagePermission } from '@/lib/server-auth';
import { loadMercadoLivreCompetitors } from '@/services/mercado-livre-catalog-search';
import type { MercadoLivreVisitsWindow } from '@/types/mercado-livre-catalog-search';

export const runtime = 'nodejs';

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseVisitsWindow(value: unknown): MercadoLivreVisitsWindow {
  const parsed = asOptionalNumber(value);
  if (parsed === 1 || parsed === 3 || parsed === 7 || parsed === 15 || parsed === 30) return parsed;
  return 7;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = asOptionalNumber(value);
  if (parsed === null) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export async function POST(request: NextRequest) {
  const permission = await requirePagePermission(request, '/buscar-mercado-livre');
  if (!permission.ok) return permission.response;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const accountId = asTrimmedString(body.accountId);
    const catalogProductId = asTrimmedString(body.catalogProductId);

    if (!accountId) {
      return NextResponse.json({ ok: false, error: 'Selecione uma conta do Mercado Livre.' }, { status: 400 });
    }

    if (!catalogProductId) {
      return NextResponse.json({ ok: false, error: 'Informe o ID do catálogo.' }, { status: 400 });
    }

    const response = await loadMercadoLivreCompetitors({
      accountId,
      catalogProductId,
      days: parseVisitsWindow(body.days),
      limit: clampNumber(body.limit, 15, 1, 25),
    });

    return NextResponse.json({ ok: true, ...response });
  } catch (error) {
    console.error('[mercado-livre/competitors] Falha ao buscar concorrentes:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Falha ao buscar concorrentes do Mercado Livre.' },
      { status: 500 }
    );
  }
}
