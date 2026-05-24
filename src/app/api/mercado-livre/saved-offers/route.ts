import { NextResponse, type NextRequest } from 'next/server';
import { requirePagePermission } from '@/lib/server-auth';
import {
  deleteMercadoLivreSavedOffer,
  loadMercadoLivreSavedOffers,
  saveMercadoLivreOffer,
} from '@/services/mercado-livre-catalog-search';
import type { MercadoLivreSearchItem } from '@/types/mercado-livre-catalog-search';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const permission = await requirePagePermission(request, '/buscar-mercado-livre');
  if (!permission.ok) return permission.response;

  try {
    const offers = await loadMercadoLivreSavedOffers();
    return NextResponse.json({ ok: true, offers });
  } catch (error) {
    console.error('[mercado-livre/saved-offers] Falha ao carregar ofertas:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Falha ao carregar ofertas salvas.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const permission = await requirePagePermission(request, '/buscar-mercado-livre');
  if (!permission.ok) return permission.response;

  try {
    const body = (await request.json().catch(() => ({}))) as { item?: MercadoLivreSearchItem };
    if (!body.item?.id || !body.item.title) {
      return NextResponse.json({ ok: false, error: 'Oferta inválida para salvar.' }, { status: 400 });
    }

    const offer = await saveMercadoLivreOffer(body.item);
    return NextResponse.json({ ok: true, offer });
  } catch (error) {
    console.error('[mercado-livre/saved-offers] Falha ao salvar oferta:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Falha ao salvar oferta.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const permission = await requirePagePermission(request, '/buscar-mercado-livre');
  if (!permission.ok) return permission.response;

  try {
    const offerKey = request.nextUrl.searchParams.get('offerKey')?.trim();
    if (!offerKey) {
      return NextResponse.json({ ok: false, error: 'Informe a oferta para remover.' }, { status: 400 });
    }

    await deleteMercadoLivreSavedOffer(offerKey);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[mercado-livre/saved-offers] Falha ao remover oferta:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Falha ao remover oferta salva.' },
      { status: 500 }
    );
  }
}
