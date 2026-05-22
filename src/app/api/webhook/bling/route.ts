import { NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { doc, setDoc, getDoc, collection, addDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { saveSalesOrders } from '@/services/order-service';
import { invalidateStockCache } from '@/app/actions';
import { enrichOrderWithInvoice } from '@/services/bling-invoice-service';

// Bling API configuration
const BLING_API_BASE = 'https://api.bling.com.br/Api/v3';

// Firestore document references
const credentialsDocRef = doc(db, "appConfig", "blingCredentials");
const webhookStatusDocRef = doc(db, "appConfig", "webhookStatus");

// Debug: salva todos os webhooks recebidos para análise
async function logWebhookDebug(data: any) {
  try {
    await addDoc(collection(db, 'webhookDebugLogs'), {
      ...data,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error('Erro ao salvar log de debug:', e);
  }
}

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

// Cache para situações do Bling (mapeamento id -> nome)
let situacoesCache: Map<number, string> | null = null;
let situacoesCacheTime: number = 0;
const SITUACOES_CACHE_TTL = 1000 * 60 * 60; // 1 hora

// Busca todas as situações de pedidos de venda do Bling
async function fetchSituacoes(): Promise<Map<number, string>> {
  // Retornar cache se válido
  if (situacoesCache && Date.now() - situacoesCacheTime < SITUACOES_CACHE_TTL) {
    return situacoesCache;
  }

  try {
    const url = `${BLING_API_BASE}/situacoes/modulos/98310`;  // 98310 = módulo de pedidos de venda
    console.log('📋 [WEBHOOK] Buscando situações de pedidos de venda...');
    const response = await blingFetch(url);

    const mapa = new Map<number, string>();

    if (response?.data && Array.isArray(response.data)) {
      for (const sit of response.data) {
        if (sit.id && sit.nome) {
          mapa.set(sit.id, sit.nome);
        }
      }
      console.log(`✅ [WEBHOOK] ${mapa.size} situações carregadas`);
    }

    situacoesCache = mapa;
    situacoesCacheTime = Date.now();
    return mapa;
  } catch (error: any) {
    console.error('❌ [WEBHOOK] Erro ao buscar situações:', error.message);
    // Retornar cache antigo se existir, ou mapa vazio
    return situacoesCache || new Map();
  }
}

// Adiciona o nome da situação ao pedido se não existir
async function enrichOrderWithSituacaoNome(order: any): Promise<any> {
  if (!order?.situacao?.id) {
    return order;
  }

  // Se já tem nome, não precisa buscar
  if (order.situacao.nome) {
    return order;
  }

  const situacoes = await fetchSituacoes();
  const nome = situacoes.get(order.situacao.id);

  if (nome) {
    console.log(`📋 [WEBHOOK] Situação ${order.situacao.id} = "${nome}"`);
    return {
      ...order,
      situacao: {
        ...order.situacao,
        nome,
      },
    };
  }

  console.warn(`⚠️ [WEBHOOK] Situação ${order.situacao.id} não encontrada no mapeamento`);
  return order;
}

// Fetch product details from Bling API to get SKU
async function fetchProductDetails(productId: number): Promise<{ codigo: string; nome: string } | null> {
  try {
    const url = `${BLING_API_BASE}/produtos/${productId}`;
    console.log(`🔍 [WEBHOOK-ESTOQUE] Buscando detalhes do produto ${productId}...`);
    const response = await blingFetch(url);
    const produto = response?.data;
    if (produto) {
      console.log(`✅ [WEBHOOK-ESTOQUE] Produto encontrado: ${produto.codigo} - ${produto.nome}`);
      return { codigo: produto.codigo, nome: produto.nome };
    }
    return null;
  } catch (error: any) {
    console.error(`❌ [WEBHOOK-ESTOQUE] Erro ao buscar produto ${productId}:`, error.message);
    return null;
  }
}

// Handle stock webhook event
async function handleStockWebhook(payload: any, event: string): Promise<{ processed: number }> {
  const action = getEventAction(event);
  console.log(`📦 [WEBHOOK-ESTOQUE] Processando evento de estoque (ação: ${action})`);

  // Formato v3 do Bling: { event, data: { produto: { id }, quantidade, saldoVirtualTotal, ... } }
  const data = payload.data;

  if (!data) {
    console.warn('⚠️ [WEBHOOK-ESTOQUE] Payload sem campo data');
    return { processed: 0 };
  }

  // Extrair dados do payload v3
  const produtoId = data.produto?.id;
  const saldoVirtual = data.saldoVirtualTotal ?? data.deposito?.saldoVirtual ?? 0;

  if (!produtoId) {
    console.warn('⚠️ [WEBHOOK-ESTOQUE] Payload sem ID do produto');
    return { processed: 0 };
  }

  console.log(`📦 [WEBHOOK-ESTOQUE] Produto ID: ${produtoId}, Saldo Virtual: ${saldoVirtual}`);

  // Buscar detalhes do produto (SKU e nome) na API do Bling
  const produtoDetails = await fetchProductDetails(produtoId);

  if (!produtoDetails || !produtoDetails.codigo) {
    console.warn(`⚠️ [WEBHOOK-ESTOQUE] Não foi possível obter SKU para produto ${produtoId}`);

    // Salvar com ID como fallback temporário
    await setDoc(stockStatusDocRef, {
      lastUpdate: new Date().toISOString(),
      lastEvent: event,
      lastProcessed: 0,
      lastError: `Produto ${produtoId} não encontrado na API`,
      totalReceived: ((await getDoc(stockStatusDocRef)).data()?.totalReceived || 0) + 1,
    });

    return { processed: 0 };
  }

  const sku = produtoDetails.codigo;
  const nome = produtoDetails.nome;

  const stockData = {
    sku,
    nome,
    estoqueAtual: saldoVirtual,
    produtoId,
    depositos: data.deposito ? [data.deposito] : [],
    webhookReceivedAt: new Date().toISOString(),
    lastEvent: event,
  };

  // Salvar no Firebase - collection stockUpdates
  const stockDocRef = doc(db, 'stockUpdates', sku);
  await setDoc(stockDocRef, stockData, { merge: true });

  console.log(`✅ [WEBHOOK-ESTOQUE] SKU ${sku}: estoque = ${saldoVirtual}`);

  // Atualizar status do webhook de estoque
  const statusSnap = await getDoc(stockStatusDocRef);
  const currentStatus = statusSnap.exists() ? statusSnap.data() : { totalReceived: 0 };

  await setDoc(stockStatusDocRef, {
    lastUpdate: new Date().toISOString(),
    lastEvent: event,
    lastProcessed: 1,
    lastSku: sku,
    lastStock: saldoVirtual,
    totalReceived: (currentStatus.totalReceived || 0) + 1,
  });

  // Invalidar cache de estoque
  invalidateStockCache();

  return { processed: 1 };
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

    // DEBUG: Salva TODOS os webhooks recebidos para análise
    let parsedForDebug: any = null;
    try {
      parsedForDebug = JSON.parse(rawBody);
    } catch {
      parsedForDebug = { rawBody: rawBody.substring(0, 1000) };
    }
    await logWebhookDebug({
      source: 'bling-webhook',
      event: parsedForDebug?.event || 'unknown',
      hasSignature: !!signature,
      payload: parsedForDebug,
      headers: {
        contentType: request.headers.get('content-type'),
        userAgent: request.headers.get('user-agent'),
      },
    });

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
      let orderDetails = await fetchOrderDetails(orderId);

      if (!orderDetails) {
        console.warn(`⚠️ [WEBHOOK] Pedido ${orderId} não encontrado na API`);
        return NextResponse.json({
          success: false,
          message: 'Pedido não encontrado na API',
          event,
          processedIn: `${Date.now() - startTime}ms`,
        });
      }

      // Enriquecer com nome da situação (API v3 não retorna o nome)
      orderDetails = await enrichOrderWithSituacaoNome(orderDetails);

      const invoiceEnrichment = await enrichOrderWithInvoice(
        orderDetails,
        (url) => blingFetch(url),
        {
          fetchXml: process.env.BLING_FETCH_INVOICE_XML_ON_WEBHOOK !== '0',
          skipExistingXml: true,
          source: 'bling-webhook',
        }
      );
      orderDetails = invoiceEnrichment.order;

      if (
        invoiceEnrichment.stats.invoiceDetailsFetched > 0 ||
        invoiceEnrichment.stats.invoiceXmlFetched > 0 ||
        invoiceEnrichment.stats.invoiceErrors > 0 ||
        invoiceEnrichment.stats.invoiceXmlErrors > 0
      ) {
        console.log(
          `📄 [WEBHOOK] NF-e: detalhes=${invoiceEnrichment.stats.invoiceDetailsFetched}, xml=${invoiceEnrichment.stats.invoiceXmlFetched}, erros=${invoiceEnrichment.stats.invoiceErrors + invoiceEnrichment.stats.invoiceXmlErrors}`
        );
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
