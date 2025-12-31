import { NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { saveSalesOrders } from '@/services/order-service';
import { invalidateStockCache } from '@/app/actions';

// Bling API configuration
const BLING_API_BASE = 'https://api.bling.com.br/Api/v3';

// Firestore document references
const credentialsDocRef = doc(db, "appConfig", "blingCredentials");
const webhookStatusDocRef = doc(db, "appConfig", "webhookStatus");

// Types
type BlingCredentials = {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
};

// Verify HMAC-SHA256 signature
function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;

  // Bling envia no formato "sha256=<hash>" - precisamos extrair apenas o hash
  const actualSignature = signature.startsWith('sha256=')
    ? signature.slice(7)
    : signature;

  const expectedSignature = createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  // Timing-safe comparison
  if (actualSignature.length !== expectedSignature.length) return false;

  let result = 0;
  for (let i = 0; i < actualSignature.length; i++) {
    result |= actualSignature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }
  return result === 0;
}

// Check if event is an order event
// Bling v1 usa: pedido_venda.created, pedido_venda.updated, pedido_venda.deleted
function isOrderEvent(event: string): boolean {
  return (
    event.startsWith('pedido_venda.') ||  // Bling v1 - formato correto
    event.startsWith('pedidos.vendas.') ||
    event.startsWith('order.')
  );
}

// Check if event is a stock event
// Bling v1 usa: estoque.created, estoque.updated, estoque.deleted
function isStockEvent(event: string): boolean {
  return (
    event.startsWith('estoque.') ||  // Bling v1 - formato correto
    event.startsWith('stock.')
  );
}

// Extract action from event name
function getEventAction(event: string): string {
  const parts = event.split('.');
  return parts[parts.length - 1] || '';
}

// Get Bling credentials from Firestore
async function getFullBlingCredentials(): Promise<BlingCredentials> {
  const snap = await getDoc(credentialsDocRef);
  const saved = snap.exists() ? (snap.data() as BlingCredentials) : {};
  return {
    clientId: saved.clientId || process.env.BLING_CLIENT_ID,
    clientSecret: saved.clientSecret || process.env.BLING_CLIENT_SECRET,
    accessToken: saved.accessToken,
    refreshToken: saved.refreshToken,
    expiresAt: saved.expiresAt,
  };
}

// Refresh access token
async function refreshAccessToken(): Promise<BlingCredentials> {
  const creds = await getFullBlingCredentials();
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    throw new Error('Credenciais do Bling incompletas para renovar o token.');
  }

  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: String(creds.refreshToken),
  });

  const res = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basic}`,
      'Accept': '1.0',
    },
    body: body.toString(),
    cache: 'no-store',
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Refresh falhou (${res.status}): ${json?.error?.description || res.statusText}`);
  }

  const update: Partial<BlingCredentials> = {};
  if (json.access_token) update.accessToken = json.access_token;
  if (json.refresh_token) update.refreshToken = json.refresh_token;
  if (json.expires_in) update.expiresAt = Date.now() + Number(json.expires_in) * 1000;

  await setDoc(credentialsDocRef, update, { merge: true });
  return { ...creds, ...update };
}

// Fetch with automatic token refresh
async function blingFetch(url: string): Promise<any> {
  let creds = await getFullBlingCredentials();
  const skewMs = 60 * 1000;

  // Check if token needs refresh
  const needsRefresh = !creds.expiresAt || (Date.now() + skewMs >= creds.expiresAt);
  if (needsRefresh) {
    console.log('🔑 [WEBHOOK] Token próximo de expirar, renovando...');
    try {
      creds = await refreshAccessToken();
    } catch (e) {
      console.error('❌ [WEBHOOK] Falha ao renovar token:', e);
    }
  }

  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${creds.accessToken}`,
    },
    cache: 'no-store',
  });

  const text = await res.text();

  // Handle token invalid
  if (res.status === 401 || (res.status === 400 && /invalid_token|token expir/i.test(text))) {
    console.log('🔄 [WEBHOOK] Token inválido, tentando renovar...');
    creds = await refreshAccessToken();

    const retryRes = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${creds.accessToken}`,
      },
      cache: 'no-store',
    });

    const retryText = await retryRes.text();
    if (!retryRes.ok) {
      throw new Error(`Erro do Bling (${retryRes.status}): ${retryText}`);
    }
    return JSON.parse(retryText);
  }

  if (!res.ok) {
    throw new Error(`Erro do Bling (${res.status}): ${text}`);
  }

  return JSON.parse(text);
}

// Fetch order details from Bling API
async function fetchOrderDetails(orderId: number): Promise<any> {
  const url = `${BLING_API_BASE}/pedidos/vendas/${orderId}`;
  console.log(`📦 [WEBHOOK] Buscando detalhes do pedido ${orderId}...`);

  const response = await blingFetch(url);
  return response?.data || null;
}

// Update webhook status in Firestore
async function updateWebhookStatus(orderId: number, event: string): Promise<void> {
  const snap = await getDoc(webhookStatusDocRef);
  const current = snap.exists() ? snap.data() : { totalReceived: 0 };

  await setDoc(webhookStatusDocRef, {
    lastUpdate: new Date().toISOString(),
    lastOrderId: orderId,
    lastEvent: event,
    totalReceived: (current.totalReceived || 0) + 1,
  });
}

// Firestore reference for stock updates
const stockStatusDocRef = doc(db, "appConfig", "stockWebhookStatus");

// Handle stock webhook event
async function handleStockWebhook(payload: any, event: string): Promise<{ processed: number }> {
  const action = getEventAction(event);
  console.log(`📦 [WEBHOOK-ESTOQUE] Processando evento de estoque (ação: ${action})`);

  // O payload do Bling v1 pode vir em diferentes formatos
  // Formato 1: { retorno: { estoques: [...] } }
  // Formato 2: { data: { ... } } (formato novo)
  let estoques: any[] = [];

  if (payload.retorno?.estoques) {
    estoques = payload.retorno.estoques;
  } else if (payload.data?.estoques) {
    estoques = payload.data.estoques;
  } else if (payload.data) {
    // Pode ser um único item
    estoques = [{ estoque: payload.data }];
  }

  console.log(`📦 [WEBHOOK-ESTOQUE] ${estoques.length} item(s) de estoque recebido(s)`);

  let processed = 0;
  for (const item of estoques) {
    const estoque = item.estoque || item;
    const sku = estoque.codigo || estoque.sku || estoque.id;

    if (!sku) {
      console.warn('⚠️ [WEBHOOK-ESTOQUE] Item sem SKU/código, ignorando');
      continue;
    }

    const stockData = {
      sku,
      nome: estoque.nome || '',
      estoqueAtual: estoque.estoqueAtual ?? estoque.quantidade ?? 0,
      depositos: estoque.depositos || [],
      webhookReceivedAt: new Date().toISOString(),
      lastEvent: event,
    };

    // Salvar no Firebase - collection stockUpdates
    const stockDocRef = doc(db, 'stockUpdates', sku);
    await setDoc(stockDocRef, stockData, { merge: true });

    console.log(`✅ [WEBHOOK-ESTOQUE] SKU ${sku}: estoque = ${stockData.estoqueAtual}`);
    processed++;
  }

  // Atualizar status do webhook de estoque
  const statusSnap = await getDoc(stockStatusDocRef);
  const currentStatus = statusSnap.exists() ? statusSnap.data() : { totalReceived: 0 };

  await setDoc(stockStatusDocRef, {
    lastUpdate: new Date().toISOString(),
    lastEvent: event,
    lastProcessed: processed,
    totalReceived: (currentStatus.totalReceived || 0) + 1,
  });

  // Invalidar cache de estoque
  invalidateStockCache();

  return { processed };
}

// Handle order deleted event
async function handleOrderDeleted(orderId: number): Promise<void> {
  console.log(`🗑️ [WEBHOOK] Marcando pedido ${orderId} como excluído...`);

  const orderDocRef = doc(db, 'salesOrders', String(orderId));
  const orderSnap = await getDoc(orderDocRef);

  if (orderSnap.exists()) {
    // Option 1: Mark as deleted (soft delete)
    await setDoc(orderDocRef, {
      deleted: true,
      deletedAt: new Date().toISOString(),
    }, { merge: true });

    // Option 2: Hard delete (uncomment if preferred)
    // await deleteDoc(orderDocRef);
  }
}

// POST - Receive webhook events from Bling
export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    const rawBody = await request.text();
    const signature = request.headers.get('X-Bling-Signature-256') ||
                     request.headers.get('X-Bling-Signature');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📨 [WEBHOOK] Evento recebido do Bling');
    console.log('═══════════════════════════════════════════════════════════');

    // Verify signature if secret is configured
    const webhookSecret = process.env.BLING_WEBHOOK_SECRET;
    if (webhookSecret && signature) {
      if (!verifySignature(rawBody, signature, webhookSecret)) {
        console.error('❌ [WEBHOOK] Assinatura inválida');
        return NextResponse.json({ error: 'Assinatura inválida' }, { status: 401 });
      }
      console.log('✅ [WEBHOOK] Assinatura verificada');
    }

    // Parse payload
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      console.error('❌ [WEBHOOK] JSON inválido');
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }

    const { event, data } = payload;
    console.log(`📋 [WEBHOOK] Evento: ${event}`);
    console.log(`📋 [WEBHOOK] Dados: ${JSON.stringify(data).substring(0, 200)}...`);

    if (!event || !data) {
      console.error('❌ [WEBHOOK] Payload incompleto');
      return NextResponse.json({ error: 'Payload incompleto' }, { status: 400 });
    }

    // Process order events
    if (isOrderEvent(event)) {
      const orderId = data.id;
      const action = getEventAction(event);

      if (!orderId) {
        console.error('❌ [WEBHOOK] ID do pedido não informado');
        return NextResponse.json({ error: 'ID do pedido não informado' }, { status: 400 });
      }

      console.log(`📦 [WEBHOOK] Processando pedido ${orderId} (ação: ${action})`);

      if (action === 'deleted') {
        await handleOrderDeleted(orderId);
        await updateWebhookStatus(orderId, event);

        return NextResponse.json({
          success: true,
          message: `Pedido ${orderId} marcado como excluído`,
          event,
          processedIn: `${Date.now() - startTime}ms`,
        });
      }

      // Fetch complete order details
      const orderDetails = await fetchOrderDetails(orderId);

      if (!orderDetails) {
        console.warn(`⚠️ [WEBHOOK] Pedido ${orderId} não encontrado na API`);
        return NextResponse.json({
          success: false,
          message: 'Pedido não encontrado na API',
          event,
          processedIn: `${Date.now() - startTime}ms`,
        });
      }

      // Save order to Firestore with webhook source flag
      const orderWithSource = {
        ...orderDetails,
        webhookSource: true,
        webhookReceivedAt: new Date().toISOString(),
      };

      await saveSalesOrders([orderWithSource]);
      await updateWebhookStatus(orderId, event);

      // Invalida o cache de estoque para garantir dados atualizados na próxima requisição
      invalidateStockCache();

      console.log(`✅ [WEBHOOK] Pedido ${orderDetails.numero || orderId} salvo com sucesso`);
      console.log(`⏱️ [WEBHOOK] Processado em ${Date.now() - startTime}ms`);

      return NextResponse.json({
        success: true,
        message: `Pedido ${orderDetails.numero || orderId} processado`,
        event,
        orderId,
        processedIn: `${Date.now() - startTime}ms`,
      });
    }

    // Process stock events
    if (isStockEvent(event)) {
      console.log(`📦 [WEBHOOK] Processando evento de estoque: ${event}`);

      const result = await handleStockWebhook(payload, event);

      console.log(`✅ [WEBHOOK] Estoque processado: ${result.processed} item(s)`);
      console.log(`⏱️ [WEBHOOK] Processado em ${Date.now() - startTime}ms`);

      return NextResponse.json({
        success: true,
        message: `Estoque processado: ${result.processed} item(s)`,
        event,
        processed: result.processed,
        processedIn: `${Date.now() - startTime}ms`,
      });
    }

    // Event not supported
    console.log(`ℹ️ [WEBHOOK] Evento ${event} não suportado, ignorando`);
    return NextResponse.json({
      success: true,
      message: 'Evento não processado',
      event,
      processedIn: `${Date.now() - startTime}ms`,
    });

  } catch (error: any) {
    console.error('═══════════════════════════════════════════════════════════');
    console.error('❌ [WEBHOOK] ERRO AO PROCESSAR EVENTO');
    console.error(`❌ [WEBHOOK] Mensagem: ${error.message}`);
    console.error(`❌ [WEBHOOK] Stack: ${error.stack}`);
    console.error('═══════════════════════════════════════════════════════════');

    // Always return 200 to prevent infinite retries from Bling
    return NextResponse.json({
      success: false,
      error: error.message,
      processedIn: `${Date.now() - startTime}ms`,
    });
  }
}

// GET - Health check endpoint
export async function GET() {
  const webhookStatus = await getDoc(webhookStatusDocRef);
  const statusData = webhookStatus.exists() ? webhookStatus.data() : null;

  return NextResponse.json({
    status: 'ok',
    message: 'Webhook do Bling está ativo',
    timestamp: new Date().toISOString(),
    supportedEvents: [
      'pedido_venda.created',
      'pedido_venda.updated',
      'pedido_venda.deleted',
      'estoque.created',
      'estoque.updated',
      'estoque.deleted',
    ],
    signatureVerification: !!process.env.BLING_WEBHOOK_SECRET,
    lastWebhook: statusData ? {
      lastUpdate: statusData.lastUpdate,
      lastOrderId: statusData.lastOrderId,
      lastEvent: statusData.lastEvent,
      totalReceived: statusData.totalReceived,
    } : null,
  });
}
