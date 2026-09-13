/**
 * GET /api/cron/bling-webhook-drain
 *
 * Retoma entregas do Bling que ficaram na fila: um evento cujo processamento falhou fica em `failed`
 * com a causa, e sem este cron a recuperação dependeria de o Bling reentregar por conta própria.
 *
 * Durante a janela de manutenção do corte de fonte o dreno fica suspenso: `drainWebhookEvents`
 * consulta o modo do núcleo e devolve `suspended` sem aplicar nada, e os eventos acumulam.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { drainWebhookEvents } from '@/server/ingest/webhook-queue';
import { processDelivery } from '@/app/api/webhook/bling/route';

export const dynamic = 'force-dynamic';

const delivery = z.object({ event: z.string().min(1).max(100), data: z.record(z.unknown()) });

export async function GET(request: Request) {
  // Fecha fechado, ao contrário dos crons mais antigos: este aplica gravações de negócio.
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'Cron não configurado.' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await drainWebhookEvents(25, async queued => {
      const { event, data } = delivery.parse(queued.payload);
      await processDelivery(event, data, queued.payload);
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    // Nunca devolver a mensagem crua do driver: pode carregar payload ou credencial.
    console.error('[CRON-BLING-DRAIN]', error);
    return NextResponse.json({ ok: false, error: 'Falha ao drenar a fila.' }, { status: 500 });
  }
}
