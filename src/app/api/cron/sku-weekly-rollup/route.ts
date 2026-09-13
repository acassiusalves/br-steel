/**
 * GET /api/cron/sku-weekly-rollup
 *
 * Fecha as semanas de demanda por SKU que ainda não foram consolidadas. Roda semanalmente, mas
 * processa tudo que estiver pendente desde o checkpoint: uma execução perdida se corrige sozinha na
 * seguinte, sem intervenção.
 *
 * Durante a janela de manutenção do corte de fonte o rollup fica suspenso e as semanas acumulam,
 * pelo mesmo motivo que o dreno de webhooks: nada de gravação de negócio com o núcleo bloqueado.
 */
import { NextResponse } from 'next/server';
import { rollUpPendingWeeks } from '@/server/persistence/firestore-sku-weekly-demand';
import { readCoreWriteMode } from '@/server/operations/maintenance';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Fecha fechado, como o bling-webhook-drain: este cron aplica gravações de negócio.
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'Cron não configurado.' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    if (await readCoreWriteMode() !== 'open') {
      return NextResponse.json({ ok: true, suspended: true, weeks: [], skus: 0 });
    }
    const { weeks, skus } = await rollUpPendingWeeks();
    return NextResponse.json({ ok: true, suspended: false, weeks, skus });
  } catch (error) {
    // Nunca devolver a mensagem crua do driver: pode carregar payload ou credencial.
    console.error('[CRON-SKU-ROLLUP]', error);
    return NextResponse.json({ ok: false, error: 'Falha ao consolidar as semanas.' }, { status: 500 });
  }
}
