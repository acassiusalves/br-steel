// app/api/webhook/mercadolivre/route.ts
//
// Endpoint público (HTTPS) que recebe notificações de webhook do Mercado Livre.
//
// Documentação oficial:
//   https://developers.mercadolivre.com.br/en_us/products-receive-notifications
//
// Requisitos da plataforma:
//   - Responder 200 OK em <500ms (caso contrário, ML desativa o tópico).
//   - ML faz até 8 tentativas de redelivery em janela de 1 hora.
//   - Boa prática: enfileirar/persistir e processar de forma assíncrona.
//
// Estratégia desta implementação:
//   1. Persiste o evento bruto em `mercadoLivreWebhookEvents/{_id}` com status='received'
//   2. Valida `application_id` contra credenciais salvas (apenas log/aviso, NÃO rejeita)
//   3. Retorna 200 imediatamente
//   4. (Opcional / fase futura) processador assíncrono lê eventos com status='received'
//      e busca os dados via API do ML usando o `resource`.
//
// Configuração no painel ML Developers:
//   - Callback URL: https://<seu-dominio>/api/webhook/mercadolivre
//   - Topics ativados conforme necessidade (orders_v2, items, questions, ...)
//
// Segurança: ML não envia HMAC. A defesa é via IP whitelist + verificação de
// `application_id`. Lista oficial de IPs ML (atualizar conforme docs):
//   54.88.218.97, 18.215.140.160, 18.213.114.129, 18.206.34.84

import { NextResponse, after } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import type {
  MlWebhookEvent,
  MlWebhookEventRecord,
  MercadoLivreCredentials,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

const ML_NOTIFICATION_IPS = new Set([
  '54.88.218.97',
  '18.215.140.160',
  '18.213.114.129',
  '18.206.34.84',
]);

/**
 * Secret compartilhado com a GCF Calculaqui (forwarder).
 * Quando definido, exige que o POST contenha o header
 * `X-BrSteel-Secret: <BR_STEEL_WEBHOOK_SECRET>`. Sem o header v\u00e1lido o
 * evento \u00e9 ignorado (retorna 200 mesmo assim, para n\u00e3o gerar redelivery).
 *
 * Os webhooks vindos diretamente do ML (sem passar pela GCF) n\u00e3o ter\u00e3o
 * esse header. Por isso, quando o secret est\u00e1 configurado, tamb\u00e9m
 * aceitamos requisi\u00e7\u00f5es vindas dos IPs oficiais do ML.
 */
const BR_STEEL_WEBHOOK_SECRET = process.env.BR_STEEL_WEBHOOK_SECRET || '';

/**
 * Resolve o accountId interno para o `user_id` do ML, consultando
 * `mercadoLivreAccounts` (campo `userId`). Retorna `undefined` se não
 * houver match — o evento ainda é gravado para auditoria.
 */
async function findAccountIdByUserId(userId: number | string): Promise<string | undefined> {
  const idStr = String(userId);
  // Caminho rápido: documento com ID = user_id (padrão usado pelo callback OAuth).
  const direct = await adminDb.collection('mercadoLivreAccounts').doc(idStr).get();
  if (direct.exists) return idStr;

  // Fallback: query pelo campo userId (caso o doc tenha outro ID, ex.: 'primary').
  const snap = await adminDb
    .collection('mercadoLivreAccounts')
    .where('userId', '==', userId)
    .limit(1)
    .get();
  if (!snap.empty) return snap.docs[0].id;

  // Tenta também como string
  const snapStr = await adminDb
    .collection('mercadoLivreAccounts')
    .where('userId', '==', idStr)
    .limit(1)
    .get();
  if (!snapStr.empty) return snapStr.docs[0].id;

  return undefined;
}

/**
 * Valida que `application_id` da notificação corresponde a algum app
 * registrado em `mercadoLivreAccounts`. Retorna `true` se conhecido (ou se a
 * verificação não pôde ser feita — fail-open propositalmente para não perder
 * eventos por configuração faltante).
 */
async function isKnownApplication(applicationId: number, accountId?: string): Promise<boolean> {
  try {
    if (accountId) {
      const snap = await adminDb.collection('mercadoLivreAccounts').doc(accountId).get();
      if (snap.exists) {
        const data = snap.data() as MercadoLivreCredentials;
        const appId = data.appId || data.clientId;
        if (appId && String(appId) === String(applicationId)) return true;
      }
    }
    // Tenta pelo campo (qualquer conta com este appId)
    const snap2 = await adminDb
      .collection('mercadoLivreAccounts')
      .where('appId', '==', String(applicationId))
      .limit(1)
      .get();
    if (!snap2.empty) return true;

    const snap3 = await adminDb
      .collection('mercadoLivreAccounts')
      .where('clientId', '==', String(applicationId))
      .limit(1)
      .get();
    return !snap3.empty;
  } catch (e) {
    console.warn('[ML WEBHOOK] Não foi possível validar application_id:', e);
    return true; // fail-open
  }
}

export async function POST(request: Request) {
  const receivedAt = Date.now();
  let payload: MlWebhookEvent | null = null;

  try {
    payload = (await request.json()) as MlWebhookEvent;
  } catch (e) {
    console.warn('[ML WEBHOOK] JSON inválido:', e);
    // ML espera 200; respondemos 200 e logamos para não acionar redelivery em loop.
    return NextResponse.json({ received: false, reason: 'invalid_json' }, { status: 200 });
  }

  if (!payload || !payload._id || !payload.topic || !payload.resource) {
    console.warn('[ML WEBHOOK] payload incompleto:', payload);
    return NextResponse.json({ received: false, reason: 'missing_fields' }, { status: 200 });
  }

  // IP check (apenas informativo; ML pode atualizar a lista a qualquer momento).
  const forwardedFor = request.headers.get('x-forwarded-for') || '';
  const remoteIp = forwardedFor.split(',')[0]?.trim();
  const ipKnown = remoteIp ? ML_NOTIFICATION_IPS.has(remoteIp) : false;
  if (remoteIp && !ipKnown) {
    console.warn(`[ML WEBHOOK] IP fora da whitelist: ${remoteIp} (topic=${payload.topic})`);
  }

  // Quando o secret est\u00e1 configurado, exigimos:
  //  - header X-BrSteel-Secret v\u00e1lido (vindo da GCF Calculaqui forwarder), OU
  //  - requisi\u00e7\u00e3o vinda dos IPs oficiais do ML (caso o callback aponte direto aqui).
  if (BR_STEEL_WEBHOOK_SECRET) {
    const headerSecret = request.headers.get('x-brsteel-secret') || '';
    const secretValid = headerSecret === BR_STEEL_WEBHOOK_SECRET;
    if (!secretValid && !ipKnown) {
      console.warn(
        `[ML WEBHOOK] Rejeitado: header X-BrSteel-Secret ausente/inv\u00e1lido e IP ${remoteIp} fora da whitelist ML.`
      );
      // Retorna 200 para que o ML/GCF n\u00e3o tente novamente em loop.
      return NextResponse.json({ received: false, reason: 'auth_failed' }, { status: 200 });
    }
  }

  console.log(
    `[ML WEBHOOK] topic=${payload.topic} resource=${payload.resource} ` +
    `user_id=${payload.user_id} app=${payload.application_id} attempts=${payload.attempts}`
  );

  try {
    const accountId = await findAccountIdByUserId(payload.user_id).catch(() => undefined);
    const knownApp = await isKnownApplication(payload.application_id, accountId);
    if (!knownApp) {
      console.warn(
        `[ML WEBHOOK] application_id ${payload.application_id} desconhecido. Evento será registrado mesmo assim.`
      );
    }

    const record: MlWebhookEventRecord = {
      ...payload,
      status: 'received',
      receivedAt,
      accountId,
    };

    // Idempotência: usa `_id` do ML como ID do doc. Reentregas sobrescrevem.
    await adminDb
      .collection('mercadoLivreWebhookEvents')
      .doc(payload._id)
      .set(record, { merge: true });

    // Processamento assíncrono pós-resposta para o tópico `messages`:
    // chamamos o sync da conversa imediatamente após retornar 200 ao ML.
    // Latência ML → UI cai de ~30-60s (cron) para ~1-2s.
    // O cron drainPendingMessageEvents continua como rede de seguran\u00e7a.
    if (payload.topic === 'messages' && accountId) {
      const eventId = payload._id;
      after(async () => {
        try {
          const { processMessagesWebhookEvent } = await import('@/services/ml/chat-sync');
          const ref = adminDb.collection('mercadoLivreWebhookEvents').doc(eventId);
          await ref.update({ status: 'processing' });
          const result = await processMessagesWebhookEvent({
            resource: payload.resource,
            userId: payload.user_id,
            accountId,
          });
          if (result.ok) {
            await ref.update({ status: 'processed', processedAt: Date.now() });
            console.log(`[ML WEBHOOK after()] processed packId=${result.packId} eventId=${eventId}`);
          } else {
            await ref.update({
              status: 'failed',
              processingError: result.reason,
              processedAt: Date.now(),
            });
            console.warn(`[ML WEBHOOK after()] failed reason=${result.reason} eventId=${eventId}`);
          }
        } catch (e: any) {
          console.error('[ML WEBHOOK after()] erro inesperado', e?.message || e);
          // Volta o status para 'received' para que o cron drain reprocesse.
          await adminDb
            .collection('mercadoLivreWebhookEvents')
            .doc(eventId)
            .update({ status: 'received', processingError: String(e?.message || e) })
            .catch(() => undefined);
        }
      });
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error: any) {
    console.error('[ML WEBHOOK] Falha ao persistir evento:', error?.message || error);
    // Retornamos 500 para que o ML faça redelivery (já que não conseguimos
    // gravar em Firestore — é um erro real do nosso lado).
    return NextResponse.json(
      { received: false, error: error?.message || 'persist_failure' },
      { status: 500 }
    );
  }
}

/** GET de health-check — útil para verificar configuração no painel ML. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'mercadolivre-webhook',
    expectedMethod: 'POST',
  });
}
