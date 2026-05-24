import { NextResponse, type NextRequest } from 'next/server';
import { requirePagePermission } from '@/lib/server-auth';
import { loadMercadoLivreVisitsRefresh } from '@/services/mercado-livre-catalog-search';
import type {
  MercadoLivreVisitsRefreshEntry,
  MercadoLivreVisitsWindow,
} from '@/types/mercado-livre-catalog-search';

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseVisitsWindow(value: unknown): MercadoLivreVisitsWindow {
  const parsed = asOptionalNumber(value);
  if (parsed === 1 || parsed === 3 || parsed === 7 || parsed === 15 || parsed === 30) return parsed;
  return 7;
}

function parseEntries(value: unknown): MercadoLivreVisitsRefreshEntry[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      const record = asRecord(entry);
      const itemKey = asTrimmedString(record.itemKey);
      const id = asTrimmedString(record.id);
      const sourceType = record.sourceType === 'item' ? 'item' : record.sourceType === 'catalog' ? 'catalog' : null;
      if (!itemKey || !id || !sourceType) return null;

      const parsed: MercadoLivreVisitsRefreshEntry = {
        itemKey,
        id,
        sourceType,
        referenceItemId: asTrimmedString(record.referenceItemId),
        catalogProductId: asTrimmedString(record.catalogProductId),
        offerItemIds: Array.isArray(record.offerItemIds)
          ? record.offerItemIds.map(asTrimmedString).filter((itemId): itemId is string => Boolean(itemId))
          : [],
      };
      return parsed;
    })
    .filter((entry): entry is MercadoLivreVisitsRefreshEntry => Boolean(entry))
    .slice(0, 50);
}

export async function POST(request: NextRequest) {
  const permission = await requirePagePermission(request, '/buscar-mercado-livre');
  if (!permission.ok) return permission.response;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const accountId = asTrimmedString(body.accountId);
    const entries = parseEntries(body.entries);

    if (!accountId) {
      return NextResponse.json({ ok: false, error: 'Selecione uma conta do Mercado Livre.' }, { status: 400 });
    }

    if (entries.length === 0) {
      return NextResponse.json({ ok: false, error: 'Informe ao menos um item para atualizar visitas.' }, { status: 400 });
    }

    const response = await loadMercadoLivreVisitsRefresh({
      accountId,
      days: parseVisitsWindow(body.days),
      entries,
    });

    return NextResponse.json({ ok: true, ...response });
  } catch (error) {
    console.error('[mercado-livre/visits] Falha ao atualizar visitas:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Falha ao atualizar visitas do Mercado Livre.' },
      { status: 500 }
    );
  }
}
