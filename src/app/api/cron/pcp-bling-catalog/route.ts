/**
 * GET /api/cron/pcp-bling-catalog
 *
 * Todo dia às 6h (horário de Brasília), copia do Bling o estoque mínimo, o máximo e o formato dos SKUs
 * da linha oficial, que o gerador de OP usa na política mín/máx. Só lê o Bling; grava apenas a cópia
 * em brsteel_pcp.bling_products.
 */
import { NextResponse } from 'next/server';
import { productionOrderRepository } from '@/server/persistence/pcp-orders';

export const dynamic = 'force-dynamic';
// ~71 detalhes de produto a ~2,5 por segundo no limite do Bling.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'Cron não configurado.' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const synced = await productionOrderRepository.syncBlingCatalog({ userId: 'cron', source: 'web', clientId: null, idempotencyKey: null });
    return NextResponse.json({ ok: true, ...synced.data });
  } catch (error) {
    console.error('[CRON pcp-bling-catalog] Falha:', error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: 'Falha ao copiar o cadastro do Bling.' }, { status: 500 });
  }
}
