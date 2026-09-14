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

/**
 * Teto explícito, não o padrão da plataforma: uma execução sem checkpoint enfileira as 104 semanas da
 * janela de retenção, e é o próprio plano que manda deixar esse passe para o script de backfill.
 * `rollUpPendingWeeks` para antes disso pelo orçamento dela e grava o checkpoint a cada semana, então
 * o teto aqui é a rede de segurança, não o mecanismo.
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  // Fecha fechado, como o bling-webhook-drain: este cron aplica gravações de negócio.
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'Cron não configurado.' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    if (await readCoreWriteMode() !== 'open') {
      return NextResponse.json({ ok: true, suspended: true, weeks: [], skus: 0, remaining: 0 });
    }
    // `remaining > 0` significa que o orçamento acabou antes das semanas: o checkpoint já guardou o
    // que fechou e a execução seguinte continua daí — nada aqui precisa ser refeito à mão.
    const { weeks, skus, remaining } = await rollUpPendingWeeks();
    return NextResponse.json({ ok: true, suspended: false, weeks, skus, remaining });
  } catch (error) {
    // Nunca devolver a mensagem crua do driver: pode carregar payload ou credencial.
    console.error('[CRON-SKU-ROLLUP]', error);
    return NextResponse.json({ ok: false, error: 'Falha ao consolidar as semanas.' }, { status: 500 });
  }
}
