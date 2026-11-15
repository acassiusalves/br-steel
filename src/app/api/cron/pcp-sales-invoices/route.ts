/**
 * GET /api/cron/pcp-sales-invoices
 *
 * A cada 15 minutos, copia do Bling as NF-e de saída dos últimos 120 dias (cabeçalho e itens), de onde o
 * gerador de OP tira os vendidos e a média semanal. Só lê o Bling; grava apenas a cópia em brsteel_pcp.
 * A primeira cópia leva algumas execuções: cada uma lê os itens que couberem em 4 minutos.
 */
import { NextResponse } from 'next/server';
import { salesInvoiceRepository } from '@/server/persistence/sales-invoices';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'Cron não configurado.' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const synced = await salesInvoiceRepository.sync({ userId: 'cron', source: 'web', clientId: null, idempotencyKey: null }, { budgetMs: 240_000 });
    return NextResponse.json({ ok: true, ...synced.data });
  } catch (error) {
    console.error('[CRON pcp-sales-invoices] Falha:', error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: 'Falha ao copiar as notas fiscais do Bling.' }, { status: 500 });
  }
}
