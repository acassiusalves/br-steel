
"use server";

import * as fs from 'fs/promises';
import * as path from 'path';
import { format, parseISO, startOfMonth, endOfMonth, eachMonthOfInterval, getMonth, getYear, differenceInDays } from 'date-fns';
import { collection, getDocs, doc, writeBatch, query, where, setDoc, getDoc, deleteField, addDoc, deleteDoc, orderBy, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

import { saveSalesOrders, filterNewOrders, getLastImportedOrderDate, orderExists, saveSalesOrdersOptimized, getImportedOrderIdsWithDetails } from '@/services/order-service';
import { updateSupplyBySku } from '@/services/supply-service';
import type { SaleOrder } from '@/types/sale-order';
import type { Supply } from '@/types/supply';
import { seedUsers as seedUsersService, getUsers as getUsersService, addUser as addUserService, deleteUser as deleteUserService } from '@/services/user-service';


// Bling API actions
type BlingCredentials = {
    clientId?: string;
    clientSecret?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
};


// --- Firestore-based Credential Storage ---

const credentialsDocRef = doc(db, "appConfig", "blingCredentials");
const syncProgressDocRef = doc(db, "appConfig", "syncProgress");

// --- Sync Progress Management ---
export type SyncProgress = {
    isRunning: boolean;
    currentStep: string;
    currentOrder: number;
    totalOrders: number;
    percentage: number;
    startedAt: string;
    updatedAt: string;
    phase: 'listing' | 'filtering' | 'fetching_details' | 'saving' | 'completed' | 'error';
    error?: string;
};

export async function updateSyncProgress(progress: Partial<SyncProgress>): Promise<void> {
    try {
        await setDoc(syncProgressDocRef, {
            ...progress,
            updatedAt: new Date().toISOString(),
        }, { merge: true });
    } catch (error) {
        console.error('Erro ao atualizar progresso da sincronização:', error);
    }
}

export async function getSyncProgress(): Promise<SyncProgress | null> {
    try {
        const snap = await getDoc(syncProgressDocRef);
        if (!snap.exists()) return null;
        return snap.data() as SyncProgress;
    } catch (error) {
        console.error('Erro ao obter progresso da sincronização:', error);
        return null;
    }
}

export async function clearSyncProgress(): Promise<void> {
    try {
        await setDoc(syncProgressDocRef, {
            isRunning: false,
            currentStep: '',
            currentOrder: 0,
            totalOrders: 0,
            percentage: 0,
            phase: 'completed',
            updatedAt: new Date().toISOString(),
        });
    } catch (error) {
        console.error('Erro ao limpar progresso da sincronização:', error);
    }
}

export async function disconnectBling(): Promise<void> {
  await setDoc(
    credentialsDocRef,
    {
      clientId: deleteField(),
      clientSecret: deleteField(),
      accessToken: deleteField(),
      refreshToken: deleteField(),
      expiresAt: deleteField(),
    },
    { merge: true }
  );
}

function asField(v?: string | null) {
  return v === '' || v == null ? deleteField() : v;
}

export async function saveBlingCredentials(partial: Partial<BlingCredentials>): Promise<void> {
  await setDoc(
    credentialsDocRef,
    {
      ...(partial.clientId       !== undefined ? { clientId: asField(partial.clientId) }       : {}),
      ...(partial.clientSecret   !== undefined ? { clientSecret: asField(partial.clientSecret) } : {}),
      ...(partial.accessToken    !== undefined ? { accessToken: asField(partial.accessToken) }   : {}),
      ...(partial.refreshToken   !== undefined ? { refreshToken: asField(partial.refreshToken) } : {}),
      ...(partial.expiresAt      !== undefined ? { expiresAt: partial.expiresAt ?? deleteField() } : {}),
    },
    { merge: true }
  );
}

export async function getBlingCredentials(): Promise<{
  clientId?: string;
  clientSecret?: string; // mascarado
  connected: boolean;
}> {
  const snap = await getDoc(credentialsDocRef);
  if (!snap.exists()) return { connected: false };

  const d = snap.data() as BlingCredentials;
  return {
    clientId: d.clientId,
    clientSecret: d.clientSecret ? '********' : undefined,
    connected: !!d.accessToken,
  };
}


/**
 * Fetches all Bling credentials, including secrets, for server-side use.
 * @returns The complete credentials object.
 */
async function getFullBlingCredentials(): Promise<BlingCredentials> {
  const snap = await getDoc(credentialsDocRef);
  const saved = snap.exists() ? (snap.data() as BlingCredentials) : {};
  return {
    clientId:     saved.clientId     || process.env.BLING_CLIENT_ID,
    clientSecret: saved.clientSecret || process.env.BLING_CLIENT_SECRET,
    accessToken:  saved.accessToken,
    refreshToken: saved.refreshToken,
    expiresAt:    saved.expiresAt,
  };
}


async function refreshAccessToken() {
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
      'Accept': '1.0', // obrigatório no Bling
    },
    body: body.toString(),
    cache: 'no-store',
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Refresh falhou (${res.status}): ${json?.error?.description || res.statusText}`);

  const update: Partial<BlingCredentials> = {};
  if (json.access_token) update.accessToken = json.access_token;
  if (json.refresh_token) update.refreshToken = json.refresh_token;
  if (json.expires_in)   update.expiresAt   = Date.now() + Number(json.expires_in) * 1000;

  await saveBlingCredentials(update);
  return { ...creds, ...update };
}

// Rate limiter: max 3 req/sec using a queue-based approach
// This ensures requests are truly serialized even when called in parallel
const MIN_REQUEST_INTERVAL = 400; // ~2.5 req/sec with extra safety margin

class RequestQueue {
  private queue: Array<{ resolve: () => void }> = [];
  private processing = false;
  private lastRequestTime = 0;

  async waitForTurn(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ resolve });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
      }

      this.lastRequestTime = Date.now();
      const item = this.queue.shift();
      if (item) {
        item.resolve();
      }
    }

    this.processing = false;
  }
}

const requestQueue = new RequestQueue();

async function blingFetchWithRefresh(url: string, init?: RequestInit, retryCount = 0): Promise<any> {
  // Rate limiting - wait for our turn in the queue
  await requestQueue.waitForTurn();

  const startTime = Date.now();

  let creds = await getFullBlingCredentials();
  const skewMs = 60 * 1000;

  const needsEarlyRefresh = !creds.expiresAt || (Date.now() + skewMs >= creds.expiresAt);
  if (needsEarlyRefresh) {
    console.log('🔑 [BLING API] Token próximo de expirar, renovando...');
    try { creds = await refreshAccessToken(); } catch (e) {
      console.error('❌ [BLING API] Falha ao renovar token:', e);
    }
  }

  const call = async (token: string) => {
    const res = await fetch(url, {
      ...init,
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(init?.headers || {}),
      },
      cache: 'no-store',
    });
    const text = await res.text();
    return { res, text };
  };

  let { res, text } = await call(String(creds.accessToken || ''));

  const maybeInvalid = (status: number, body: string) =>
    status === 401 || (status === 400 && /invalid_token|token expir|unauthorized/i.test(body));

  if (maybeInvalid(res.status, text)) {
    console.log('🔄 [BLING API] Token inválido, tentando renovar...');
    creds = await refreshAccessToken();
    ({ res, text } = await call(String(creds.accessToken || '')));
  }

  const elapsed = Date.now() - startTime;

  // Handle rate limit (429) with retry
  if (res.status === 429 && retryCount < 3) {
    const waitTime = Math.pow(2, retryCount + 1) * 1000; // Exponential backoff: 2s, 4s, 8s
    console.warn(`⚠️ [BLING API] Rate limit atingido, aguardando ${waitTime/1000}s antes de tentar novamente...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return blingFetchWithRefresh(url, init, retryCount + 1);
  }

  if (!res.ok) {
    let payload: any; try { payload = JSON.parse(text); } catch {}
    const msg = payload?.error?.description || res.statusText || text;
    console.error(`❌ [BLING API] Erro ${res.status} após ${elapsed}ms: ${msg}`);
    throw new Error(`Erro do Bling (${res.status}): ${msg}`);
  }

  if (retryCount === 0) {
    // Only log if not a retry (to avoid noise)
    // console.log(`✅ [BLING API] Resposta OK em ${elapsed}ms`);
  }

  try { return text ? JSON.parse(text) : null; }
  catch { throw new Error('A resposta da API do Bling não era um JSON válido.'); }
}


async function blingGetPaged(baseUrl: string) {
    console.log(`📄 [PAGINAÇÃO] Iniciando busca paginada: ${baseUrl.substring(0, 80)}...`);
    const allData: any[] = [];
    let page = 1;
    const limit = 100;

    while (true) {
        const url = new URL(baseUrl);
        url.searchParams.set('pagina', String(page));
        url.searchParams.set('limite', String(limit));

        console.log(`📄 [PAGINAÇÃO] Buscando página ${page}...`);

        try {
            const responseData = await blingFetchWithRefresh(url.toString());

            const dataOnPage = responseData.data || [];
            allData.push(...dataOnPage);

            console.log(`📄 [PAGINAÇÃO] Página ${page}: ${dataOnPage.length} itens (total acumulado: ${allData.length})`);

            if (dataOnPage.length < limit) {
                console.log(`📄 [PAGINAÇÃO] Fim da paginação - última página tinha ${dataOnPage.length} itens`);
                break;
            }
            page++;
        } catch (error: any) {
            console.error(`❌ [PAGINAÇÃO] Erro na página ${page}: ${error.message}`);
            throw error;
        }
    }

    console.log(`📄 [PAGINAÇÃO] Concluído! Total de ${allData.length} itens em ${page} página(s)`);
    return allData;
}


async function getBlingSalesOrdersOptimized({
    from,
    to,
    forceFullSync = false,
    useIntelligentDates = true
}: {
    from?: Date;
    to?: Date;
    forceFullSync?: boolean;
    useIntelligentDates?: boolean;
}) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🚀 [SYNC] INICIANDO SINCRONIZAÇÃO DE PEDIDOS');
    console.log(`🚀 [SYNC] Parâmetros: forceFullSync=${forceFullSync}, useIntelligentDates=${useIntelligentDates}`);
    console.log(`🚀 [SYNC] Período recebido: from=${from?.toISOString() || 'null'}, to=${to?.toISOString() || 'null'}`);
    console.log('═══════════════════════════════════════════════════════════');

    // Inicializar progresso
    await updateSyncProgress({
        isRunning: true,
        currentStep: 'Iniciando sincronização...',
        currentOrder: 0,
        totalOrders: 0,
        percentage: 0,
        startedAt: new Date().toISOString(),
        phase: 'listing',
    });

    const credentials = await getFullBlingCredentials();

    if (!credentials.accessToken) {
        console.error('❌ [SYNC] Token de acesso não encontrado!');
        await updateSyncProgress({
            isRunning: false,
            phase: 'error',
            error: 'Token de acesso não encontrado',
        });
        throw new Error('Token de acesso não encontrado. Faça a conexão com o Bling primeiro.');
    }
    console.log('✅ [SYNC] Token de acesso válido');

    let queryFrom = from;
    let queryTo = to;

    if (useIntelligentDates && !forceFullSync && !from) {
        console.log('🧠 [SYNC] Modo inteligente: buscando última data de importação...');
        const lastImportDate = await getLastImportedOrderDate();
        if (lastImportDate) {
            queryFrom = lastImportDate;
            console.log(`🔄 [SYNC] Sincronização incremental a partir de: ${queryFrom.toISOString()}`);
        } else {
            queryFrom = new Date();
            queryFrom.setDate(queryFrom.getDate() - 30);
            console.log(`🆕 [SYNC] Primeira importação - últimos 30 dias a partir de: ${queryFrom.toISOString()}`);
        }
    }

    if(!queryFrom) {
      queryFrom = new Date();
      queryFrom.setDate(queryFrom.getDate() - 30);
      console.log(`📅 [SYNC] Data inicial não definida, usando últimos 30 dias: ${queryFrom.toISOString()}`);
    }
    if (!queryTo) {
        queryTo = new Date();
        console.log(`📅 [SYNC] Data final não definida, usando hoje: ${queryTo.toISOString()}`);
    }

    const formatDate = (date: Date) => date.toISOString().split('T')[0];
    const baseUrl = `https://api.bling.com.br/Api/v3/pedidos/vendas?dataInicial=${formatDate(queryFrom)}&dataFinal=${formatDate(queryTo)}`;

    console.log('───────────────────────────────────────────────────────────');
    console.log(`📥 [SYNC] FASE 1: Listando pedidos de ${formatDate(queryFrom)} a ${formatDate(queryTo)}`);
    console.log('───────────────────────────────────────────────────────────');

    await updateSyncProgress({
        currentStep: 'Listando pedidos do Bling...',
        phase: 'listing',
    });

    try {
        const allOrders = await blingGetPaged(baseUrl);
        console.log(`📊 [SYNC] Total de pedidos encontrados no Bling: ${allOrders.length}`);

        // Atualizar imediatamente com o total de pedidos encontrados
        await updateSyncProgress({
            currentStep: `Encontrados ${allOrders.length} pedidos no Bling`,
            totalOrders: allOrders.length,
            percentage: 5,
        });

        if (allOrders.length === 0) {
            console.log('📭 [SYNC] Nenhum pedido encontrado no período');
            await updateSyncProgress({
                isRunning: false,
                currentStep: 'Nenhum pedido encontrado',
                percentage: 100,
                phase: 'completed',
            });
            return {
                data: [],
                summary: { total: 0, new: 0, existing: 0, processed: 0, created: 0, updated: 0 }
            };
        }

        console.log('───────────────────────────────────────────────────────────');
        console.log('🔍 [SYNC] FASE 2: Filtrando pedidos novos...');
        console.log('───────────────────────────────────────────────────────────');

        await updateSyncProgress({
            currentStep: `Filtrando ${allOrders.length} pedidos...`,
            totalOrders: allOrders.length,
            percentage: 10,
            phase: 'filtering',
        });

        const ordersToProcess = await filterNewOrders(allOrders);
        console.log(`📊 [SYNC] Pedidos novos/atualizados para processar: ${ordersToProcess.length}`);
        console.log(`📊 [SYNC] Pedidos já existentes no banco: ${allOrders.length - ordersToProcess.length}`);

        if (ordersToProcess.length === 0 && !forceFullSync) {
            console.log('✅ [SYNC] Todos os pedidos já estão atualizados no banco - nada a fazer');
            await updateSyncProgress({
                isRunning: false,
                currentStep: 'Todos os pedidos já estão atualizados',
                percentage: 100,
                phase: 'completed',
            });
            return {
                data: allOrders,
                summary: { total: allOrders.length, new: 0, existing: allOrders.length, processed: 0, created: 0, updated: 0 }
            };
        }

        const ordersToFetchDetails = forceFullSync ? allOrders : ordersToProcess;

        console.log('───────────────────────────────────────────────────────────');
        console.log(`📦 [SYNC] FASE 3: Buscando detalhes de ${ordersToFetchDetails.length} pedidos...`);
        console.log(`📦 [SYNC] Modo: ${forceFullSync ? 'COMPLETO (todos)' : 'INCREMENTAL (apenas novos)'}`);
        console.log('───────────────────────────────────────────────────────────');

        await updateSyncProgress({
            currentStep: `Buscando detalhes de ${ordersToFetchDetails.length} pedidos...`,
            totalOrders: ordersToFetchDetails.length,
            currentOrder: 0,
            percentage: 15,
            phase: 'fetching_details',
        });

        const ordersWithDetails = [];
        let processedCount = 0;
        let errorCount = 0;
        const totalToProcess = ordersToFetchDetails.length;

        for (const order of ordersToFetchDetails) {
            const currentIndex = processedCount + errorCount + 1;
            // Progresso vai de 15% a 95% durante busca de detalhes (80% do total)
            const progress = Math.round(15 + ((currentIndex / totalToProcess) * 80));

            // Atualizar progresso no Firestore a cada pedido para feedback em tempo real
            await updateSyncProgress({
                currentStep: `Processando pedido ${currentIndex} de ${totalToProcess}...`,
                currentOrder: currentIndex,
                percentage: progress,
            });

            try {
                if ((processedCount + errorCount) % 50 === 0 || processedCount + errorCount === 0) {
                    console.log(`📦 [SYNC] Progresso: ${progress}% (${currentIndex}/${totalToProcess}) - Processando pedido ${order.id}...`);
                }

                const detailsData = await blingFetchWithRefresh(`https://api.bling.com.br/Api/v3/pedidos/vendas/${order.id}`);
                if (detailsData && detailsData.data) {
                    ordersWithDetails.push(detailsData.data);
                    processedCount++;
                } else {
                    console.warn(`⚠️ [SYNC] Pedido ${order.id}: resposta sem dados, usando original`);
                    ordersWithDetails.push(order);
                    errorCount++;
                }
            } catch (error: any) {
                console.error(`❌ [SYNC] Erro no pedido ${order.id}: ${error.message}`);
                ordersWithDetails.push(order);
                errorCount++;
            }
        }

        console.log('───────────────────────────────────────────────────────────');
        console.log(`💾 [SYNC] FASE 4: Salvando ${ordersWithDetails.length} pedidos no Firebase...`);
        console.log(`💾 [SYNC] Detalhes obtidos com sucesso: ${processedCount}`);
        console.log(`💾 [SYNC] Erros ao obter detalhes: ${errorCount}`);
        console.log('───────────────────────────────────────────────────────────');

        await updateSyncProgress({
            currentStep: 'Salvando pedidos no banco de dados...',
            currentOrder: totalToProcess,
            percentage: 95,
            phase: 'saving',
        });

        const saveResult = await saveSalesOrdersOptimized(ordersWithDetails);

        console.log('═══════════════════════════════════════════════════════════');
        console.log('✅ [SYNC] SINCRONIZAÇÃO CONCLUÍDA!');
        console.log(`✅ [SYNC] Novos: ${saveResult.created} | Atualizados: ${saveResult.updated}`);
        console.log(`✅ [SYNC] Total processado: ${processedCount} | Erros: ${errorCount}`);
        console.log('═══════════════════════════════════════════════════════════');

        await updateSyncProgress({
            isRunning: false,
            currentStep: `Concluído! ${saveResult.created} novos, ${saveResult.updated} atualizados`,
            currentOrder: totalToProcess,
            totalOrders: totalToProcess,
            percentage: 100,
            phase: 'completed',
        });

        return {
            data: ordersWithDetails,
            summary: {
                total: allOrders.length,
                new: ordersToFetchDetails.length,
                existing: allOrders.length - ordersToFetchDetails.length,
                processed: processedCount,
                errors: errorCount,
                saved: saveResult.count,
                created: saveResult.created,
                updated: saveResult.updated
            }
        };

    } catch (error: any) {
        console.error('═══════════════════════════════════════════════════════════');
        console.error('❌ [SYNC] ERRO FATAL NA SINCRONIZAÇÃO!');
        console.error(`❌ [SYNC] Mensagem: ${error.message}`);
        console.error(`❌ [SYNC] Stack: ${error.stack}`);
        console.error('═══════════════════════════════════════════════════════════');

        await updateSyncProgress({
            isRunning: false,
            currentStep: `Erro: ${error.message}`,
            phase: 'error',
            error: error.message,
        });

        throw new Error(`Falha na importação: ${error.message}`);
    }
}


export async function smartSyncOrders(from?: Date, to?: Date) {
    console.log('🧠 Iniciando sincronização inteligente...');
    const result = await getBlingSalesOrdersOptimized({ 
        from,
        to,
        forceFullSync: false,
        useIntelligentDates: !from 
    });
    return result;
}

export async function fullSyncOrders(from?: Date, to?: Date) {
    console.log('🔄 Iniciando sincronização completa...');
    const result = await getBlingSalesOrdersOptimized({ 
        from, 
        to, 
        forceFullSync: true,
        useIntelligentDates: false 
    });
    return result;
}


export async function checkOrderNeedsUpdate(orderId: string): Promise<boolean> {
    try {
        const exists = await orderExists(orderId);
        if (!exists) {
            return true;
        }
        return false; 
    } catch (error) {
        console.error(`Erro ao verificar pedido ${orderId}:`, error);
        return true;
    }
}

export async function getBlingSalesOrders({ from, to }: { from?: Date, to?: Date } = {}) {
    const result = await getBlingSalesOrdersOptimized({ from, to, forceFullSync: true });
    return result;
}


export async function getBlingOrderDetails(orderId: string): Promise<any> {
    if (!orderId) {
        throw new Error('O ID do pedido é obrigatório.');
    }
    const url = `https://api.bling.com.br/Api/v3/pedidos/vendas/${orderId}`;
    try {
        const data = await blingFetchWithRefresh(url);
        if (data && data.data) {
           await saveSalesOrders([data.data]);
        }
        return data;
    } catch (error: any) {
        console.error(`Falha ao buscar detalhes do pedido ${orderId}:`, error);
        throw new Error(`Falha na comunicação com a API do Bling: ${error.message}`);
    }
}

export async function getBlingChannelByOrderId(orderId: string) {
  if (!orderId) {
    throw new Error('O ID do pedido é obrigatório.');
  }

  const orderResp = await blingFetchWithRefresh(
    `https://api.bling.com.br/Api/v3/pedidos/vendas/${orderId}`
  );

  const order = orderResp?.data ?? {};
  const lojaId = order?.loja?.id ?? null;
  const intermediador = order?.intermediador ?? null;

  const rastreio = String(order?.transporte?.volumes?.[0]?.codigoRastreamento || '');
  let marketplaceName: string | null = null;
  if (rastreio.startsWith('MEL')) {
    marketplaceName = 'Mercado Livre';
  } else if (intermediador?.nomeUsuario) {
    marketplaceName = `${intermediador.nomeUsuario}`;
  } else if (lojaId) {
    try {
        const lojaDetails = await blingFetchWithRefresh(`https://api.bling.com.br/Api/v3/lojas/${lojaId}`);
        marketplaceName = lojaDetails?.data?.nome;
    } catch (e) {
        console.warn(`Could not fetch store name for lojaId ${lojaId}`, e);
        marketplaceName = `Loja ID ${lojaId}`;
    }
  }


  return {
    lojaId,
    intermediador,
    marketplaceName,
    rawOrderData: order,
  };
}


export async function getBlingProducts(limit: number = 100): Promise<any> {
    const baseUrl = new URL('https://api.bling.com.br/Api/v3/produtos');
    baseUrl.searchParams.set('limite', String(limit));
    
    try {
        const products = await blingFetchWithRefresh(baseUrl.toString());
        return products;
    } catch (error: any) {
        console.error('Falha ao buscar produtos no Bling:', error);
        throw new Error(`Falha na comunicação com a API do Bling: ${error.message}`);
    }
}

export async function getBlingProductBySku(sku: string): Promise<any> {
    if (!sku) {
        throw new Error('O SKU do produto é obrigatório.');
    }
    const listUrl = `https://api.bling.com.br/Api/v3/produtos?codigo=${encodeURIComponent(sku)}`;
    try {
        const listData = await blingFetchWithRefresh(listUrl);
        const productFromList = listData?.data?.[0];

        if (!productFromList || !productFromList.id) {
            throw new Error(`Produto com SKU ${sku} não encontrado na listagem.`);
        }

        const detailUrl = `https://api.bling.com.br/Api/v3/produtos/${productFromList.id}`;
        const detailData = await blingFetchWithRefresh(detailUrl);
        
        return detailData;

    } catch (error: any) {
        console.error(`Falha ao buscar produto com SKU ${sku}:`, error);
        throw new Error(`Falha na comunicação com a API do Bling: ${error.message}`);
    }
}

export async function getLogisticsBySalesOrder(orderId: string): Promise<any> {
    if (!orderId) {
        throw new Error('O ID do pedido de venda é obrigatório.');
    }
    
    try {
        const orderDetails = await blingFetchWithRefresh(`https://api.bling.com.br/Api/v3/pedidos/vendas/${orderId}`);
        const invoiceId = orderDetails?.data?.notaFiscal?.id;

        if (!invoiceId) {
            throw new Error('Nota Fiscal não encontrada para este pedido. Não é possível rastrear.');
        }

        const shippingManifests = await blingFetchWithRefresh(`https://api.bling.com.br/Api/v3/logisticas/remessas?idsDocumentos[]=${invoiceId}`);
        const shippingObjects = shippingManifests?.data?.[0]?.objetos;

        if (!shippingObjects || shippingObjects.length === 0) {
            throw new Error('Nenhum objeto de logística encontrado para a nota fiscal deste pedido.');
        }
        
        const logisticsObjectId = shippingObjects[0]?.id;

        if (!logisticsObjectId) {
            throw new Error('ID do objeto de logística não encontrado na remessa.');
        }

        const logisticsDetails = await blingFetchWithRefresh(`https://api.bling.com.br/Api/v3/logisticas/objetos/${logisticsObjectId}`);
        
        return logisticsDetails;

    } catch (error: any) {
        console.error(`Falha na cadeia de busca de logística para o pedido ${orderId}:`, error);
        throw new Error(error.message);
    }
}

export type ProductStock = {
  produto: {
    id: number;
    codigo: string;
    nome: string;
  };
  deposito: {
    id: number;
    nome: string;
  };
  saldoFisico: number;
  saldoVirtual: number;
  saldoFisicoTotal: number;
  saldoVirtualTotal: number;
};

// Cache de estoque com TTL de 5 minutos
const stockCache: {
    data: ProductStock[] | null;
    timestamp: number;
    TTL: number;
} = {
    data: null,
    timestamp: 0,
    TTL: 5 * 60 * 1000 // 5 minutos
};

// Busca dados de estoque que vieram via webhook (Firebase)
// NOTA: Só retorna dados de webhooks REAIS do Bling (ignora testes)
async function getStockFromWebhook(): Promise<Map<string, { estoqueAtual: number; updatedAt: string }>> {
    const stockMap = new Map<string, { estoqueAtual: number; updatedAt: string }>();

    try {
        const stockUpdatesSnapshot = await getDocs(collection(db, 'stockUpdates'));

        stockUpdatesSnapshot.forEach(docSnapshot => {
            const data = docSnapshot.data();
            const sku = data.sku || docSnapshot.id;
            const lastEvent = data.lastEvent || '';

            // Ignora dados de teste - só usa webhooks reais do Bling
            if (lastEvent.includes('(test)')) {
                return; // skip this item
            }

            stockMap.set(sku, {
                estoqueAtual: data.estoqueAtual ?? 0,
                updatedAt: data.webhookReceivedAt || '',
            });
        });

        if (stockMap.size > 0) {
            console.log(`📦 [WEBHOOK-ESTOQUE] ${stockMap.size} SKUs com estoque via webhook real`);
        }
    } catch (error) {
        console.error('❌ [WEBHOOK-ESTOQUE] Erro ao buscar estoque do Firebase:', error);
    }

    return stockMap;
}

// Limpa todos os dados de estoque da collection stockUpdates (para testes)
export async function clearStockUpdates(): Promise<{ deleted: number }> {
    try {
        const stockUpdatesSnapshot = await getDocs(collection(db, 'stockUpdates'));
        const batch = writeBatch(db);
        let count = 0;

        stockUpdatesSnapshot.forEach(docSnapshot => {
            batch.delete(docSnapshot.ref);
            count++;
        });

        if (count > 0) {
            await batch.commit();
            console.log(`🗑️ [STOCK-UPDATES] Removidos ${count} documentos`);
        }

        return { deleted: count };
    } catch (error) {
        console.error('❌ [STOCK-UPDATES] Erro ao limpar:', error);
        return { deleted: 0 };
    }
}

// Função para invalidar o cache (chamada pelo webhook quando há atualização)
export async function invalidateStockCache(): Promise<void> {
    console.log('🗑️ [CACHE] Invalidando cache de estoque');
    stockCache.data = null;
    stockCache.timestamp = 0;
}

export async function getProductsStock(): Promise<{ data: ProductStock[], isSimulated?: boolean }> {
    // Verifica se há dados em cache válidos
    const now = Date.now();
    if (stockCache.data && (now - stockCache.timestamp) < stockCache.TTL) {
        const cacheAge = Math.round((now - stockCache.timestamp) / 1000);
        console.log(`📦 [CACHE] Retornando estoque do cache (idade: ${cacheAge}s)`);

        // Mesmo usando cache, verifica se há atualizações via webhook
        const webhookStock = await getStockFromWebhook();
        if (webhookStock.size > 0) {
            // Mescla dados do webhook com o cache
            const mergedData = stockCache.data.map(item => {
                const webhookData = webhookStock.get(item.produto.codigo);
                if (webhookData) {
                    return {
                        ...item,
                        saldoVirtualTotal: webhookData.estoqueAtual,
                        saldoVirtual: webhookData.estoqueAtual,
                    };
                }
                return item;
            });
            return { data: mergedData, isSimulated: false };
        }

        return { data: stockCache.data, isSimulated: false };
    }

    console.log('🚀 INICIANDO BUSCA DE ESTOQUE (cache expirado ou vazio)');

    // Busca dados do webhook em paralelo com a API
    const [webhookStock, apiResult] = await Promise.all([
        getStockFromWebhook(),
        (async () => {
            try {
                const stockUrl = 'https://api.bling.com.br/Api/v3/produtos';
                console.log('🔍 Tentando endpoint:', stockUrl);

                const stockData = await blingGetPaged(stockUrl);
                console.log('📦 Dados recebidos do estoque:', stockData?.length || 0, 'itens');

                if (stockData && stockData.length > 0) {
                    return stockData;
                }
            } catch (error: any) {
                console.log('❌ Erro no endpoint de estoque:', error.message);
            }
            return null;
        })()
    ]);

    if (apiResult && apiResult.length > 0) {
        console.log('✅ SUCESSO: DADOS REAIS DE ESTOQUE');

        const formattedData: ProductStock[] = apiResult.map((item: any) => {
            const sku = item.codigo || `PROD-${item.id}`;
            const webhookData = webhookStock.get(sku);

            // Se temos dados mais recentes do webhook, usa eles
            const saldoVirtualTotal = webhookData
                ? webhookData.estoqueAtual
                : (item.estoque?.saldoVirtualTotal || item.estoque?.saldoVirtual || 0);

            return {
                produto: {
                    id: item.id || 0,
                    codigo: sku,
                    nome: item.nome || 'Produto sem nome',
                },
                deposito: {
                    id: item.deposito?.id || 0,
                    nome: item.deposito?.nome || 'Depósito padrão',
                },
                saldoFisico: item.estoque?.saldoFisico || 0,
                saldoVirtual: saldoVirtualTotal,
                saldoFisicoTotal: item.estoque?.saldoFisicoTotal || item.estoque?.saldoFisico || 0,
                saldoVirtualTotal: saldoVirtualTotal,
            };
        });

        // Atualiza o cache
        stockCache.data = formattedData;
        stockCache.timestamp = now;
        console.log('💾 [CACHE] Estoque salvo no cache');

        if (webhookStock.size > 0) {
            console.log(`📦 [WEBHOOK] ${webhookStock.size} SKUs atualizados via webhook`);
        }

        return { data: formattedData, isSimulated: false };
    }

    console.log('🔄 Usando fallback - buscando produtos...');
    const productsData = await blingGetPaged('https://api.bling.com.br/Api/v3/produtos');
    if (productsData && productsData.length > 0) {
        console.log('⚠️ GERANDO DADOS SIMULADOS');

        const simulatedData: ProductStock[] = productsData.slice(0, 20).map((product: any) => ({
            produto: {
                id: product.id,
                codigo: product.codigo || `PROD-${product.id}`,
                nome: product.nome || 'Produto sem nome',
            },
            deposito: { id: 1, nome: 'Depósito Principal' },
            saldoFisico: Math.floor(Math.random() * 100),
            saldoVirtual: Math.floor(Math.random() * 100),
            saldoFisicoTotal: Math.floor(Math.random() * 100),
            saldoVirtualTotal: Math.floor(Math.random() * 100),
        }));

        return { data: simulatedData, isSimulated: true };
    }

    throw new Error('Nenhum dado encontrado');
}


export async function countImportedOrders(): Promise<number> {
    try {
        const ordersCollection = collection(db, 'salesOrders');
        const snapshot = await getDocs(ordersCollection);
        return snapshot.size;
    } catch (error) {
        console.error("Failed to count imported orders:", error);
        return 0;
    }
}

export async function getImportedOrderIds(): Promise<Set<string>> {
  try {
    const ordersCollection = collection(db, 'salesOrders');
    const q = query(ordersCollection);
    const snapshot = await getDocs(q);
    const ids = new Set<string>();
    snapshot.forEach(doc => {
      // Este método retorna todos os IDs, independentemente de terem detalhes ou não.
      ids.add(doc.id);
    });
    return ids;
  } catch (error) {
    console.error("Failed to get all imported order IDs:", error);
    return new Set();
  }
}

export async function getSalesDashboardData(
  { from, to }: { from?: Date, to?: Date }
): Promise<{
  totalRevenue: number;
  totalSales: number;
  averageTicket: number;
  uniqueCustomers: number;
  topProducts: { name: string, total: number, revenue: number }[];
  salesByState: { state: string, revenue: number }[];
  stats: {
      totalRevenue: { value: number, change: number };
      totalSales: { value: number, change: number };
      averageTicket: { value: number, change: number };
      uniqueCustomers: { value: number, change: number };
  }
}> {
  if (!from || !to) {
    throw new Error('É necessário um período (data de início e fim) para a consulta.');
  }

  const salesCollection = collection(db, 'salesOrders');
  const fromDateStr = format(from, 'yyyy-MM-dd');
  const toDateStr = format(to, 'yyyy-MM-dd');

  // Otimização: Query com filtros no Firestore em vez de filtrar em memória
  const q = query(
    salesCollection,
    where('data', '>=', fromDateStr),
    where('data', '<=', toDateStr)
  );

  const snapshot = await getDocs(q);

  const orders: SaleOrder[] = [];
  snapshot.forEach(doc => {
    const order = doc.data() as SaleOrder;
    // Agora só filtra por itens, pois a data já foi filtrada no query
    if(order.itens && order.itens.length > 0) {
      orders.push(order);
    }
  });

  const totalRevenue = orders.reduce((sum, order) => sum + (order.total || 0), 0);
  const totalSales = orders.length;
  const averageTicket = totalSales > 0 ? totalRevenue / totalSales : 0;
  
  const customerIds = new Set(orders.map(order => order.contato.id));
  const uniqueCustomers = customerIds.size;

  const productSales = new Map<string, { total: number, revenue: number }>();
  const stateSales = new Map<string, number>();

  orders.forEach(order => {
      order.itens?.forEach(item => {
          const productName = item.descricao || 'Produto sem nome';
          const currentData = productSales.get(productName) || { total: 0, revenue: 0 };
          currentData.total += item.quantidade;
          currentData.revenue += item.quantidade * item.valor;
          productSales.set(productName, currentData);
      });

      const state = order.transporte?.etiqueta?.uf || 'N/A';
      const currentRevenue = stateSales.get(state) || 0;
      stateSales.set(state, currentRevenue + (order.total || 0));
  });

  const topProducts = Array.from(productSales.entries())
      .map(([name, data]) => ({ name, total: data.total, revenue: data.revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
      
  const salesByState = Array.from(stateSales.entries())
      .map(([state, revenue]) => ({ state, revenue }))
      .sort((a, b) => b.revenue - a.revenue);
  

  const mockChange = () => parseFloat((Math.random() * 40 - 10).toFixed(1));

  return {
    totalRevenue,
    totalSales,
    averageTicket,
    uniqueCustomers,
    topProducts,
    salesByState,
    stats: {
        totalRevenue: { value: totalRevenue, change: mockChange() },
        totalSales: { value: totalSales, change: mockChange() },
        averageTicket: { value: averageTicket, change: mockChange() },
        uniqueCustomers: { value: uniqueCustomers, change: mockChange() },
    }
  };
}

export type ProductionDemand = {
  sku: string;
  description: string;
  orderCount: number;
  totalQuantitySold: number;
  weeklyAverage: number;
  corte: number;
  dobra: number;
  stockLevel?: number;
  stockMin?: number;
  stockMax?: number;
};

export async function getProductionDemand(
    { from, to }: { from?: Date, to?: Date }
): Promise<ProductionDemand[]> {
    if (!from || !to) {
        return [];
    }

    const fromDateStr = format(from, 'yyyy-MM-dd');
    const toDateStr = format(to, 'yyyy-MM-dd');

    console.log('═══════════════════════════════════════════════════════════');
    console.log(`📊 [PRODUÇÃO] Análise de demanda: ${fromDateStr} a ${toDateStr}`);
    console.log('═══════════════════════════════════════════════════════════');

    // Busca otimizada: filtra por data E notaFiscal.id no Firestore (server-side)
    // Isso reduz drasticamente a quantidade de dados transferidos
    const [salesSnapshot, stockDataResult, suppliesSnapshot] = await Promise.all([
        getDocs(query(
            collection(db, 'salesOrders'),
            where('data', '>=', fromDateStr),
            where('data', '<=', toDateStr)
        )),
        getProductsStock(),
        getDocs(query(collection(db, "supplies")))
    ]);

    console.log(`📊 [PRODUÇÃO] Pedidos no período (server-side): ${salesSnapshot.size}`);

    const stockMap = new Map<string, number>();
    stockDataResult.data.forEach(stockItem => {
        stockMap.set(stockItem.produto.codigo, stockItem.saldoVirtualTotal);
    });

    const supplyInfoMap = new Map<string, { stockMin?: number; stockMax?: number }>();
    suppliesSnapshot.forEach(d => {
        const s = d.data() as Supply;
        const key = (s?.codigo as string) || d.id;
        if (key) {
            supplyInfoMap.set(key, {
            stockMin: s?.estoqueMinimo,
            stockMax: s?.estoqueMaximo,
            });
        }
    });

    const days = differenceInDays(to, from) + 1;
    const weeks = Math.max(1, days / 7);

    const productDemand = new Map<string, {
        description: string,
        orderIds: Set<number>,
        totalQuantity: number
    }>();

    // Contadores para log
    let ordersWithNF = 0;

    salesSnapshot.forEach(doc => {
        const order = doc.data() as SaleOrder;

        // Filtra apenas pedidos com nota fiscal (o filtro de data já foi feito no Firestore)
        const hasNF = order.notaFiscal && order.notaFiscal.id;
        if (!hasNF) return;

        ordersWithNF++;

        // Processa itens do pedido
        order.itens?.forEach(item => {
            const sku = item.codigo || 'SKU_INDEFINIDO';
            const currentData = productDemand.get(sku) || {
                description: item.descricao,
                orderIds: new Set(),
                totalQuantity: 0
            };

            currentData.orderIds.add(order.id);
            currentData.totalQuantity += item.quantidade;
            productDemand.set(sku, currentData);
        });
    });

    console.log(`📊 [PRODUÇÃO] Pedidos com NF no período: ${ordersWithNF}`);

    const result = Array.from(productDemand.entries())
        .map(([sku, data]) => {
            const orderCount = data.orderIds.size;
            const weeklyAverage = data.totalQuantity / weeks;
            const corte = Math.floor(weeklyAverage * 2);
            const dobra = Math.floor(weeklyAverage * 1.5);
            const supplyInfo = supplyInfoMap.get(sku);

            return {
                sku,
                description: data.description,
                orderCount: orderCount,
                totalQuantitySold: data.totalQuantity,
                weeklyAverage: weeklyAverage,
                corte: corte,
                dobra: dobra,
                stockLevel: stockMap.get(sku),
                stockMin: supplyInfo?.stockMin,
                stockMax: supplyInfo?.stockMax,
            };
        })
        .sort((a, b) => b.weeklyAverage - a.weeklyAverage);

    return result;
}

/**
 * Função de diagnóstico para verificar datas dos pedidos no Firebase
 */
export async function debugOrderDates(): Promise<{
    total: number;
    withNF: number;
    dateDistribution: Record<string, number>;
    sampleDates: string[];
}> {
    const salesSnapshot = await getDocs(query(collection(db, 'salesOrders')));

    const dateDistribution: Record<string, number> = {};
    const sampleDates: string[] = [];
    let withNF = 0;

    salesSnapshot.forEach(doc => {
        const order = doc.data() as SaleOrder;
        const dateStr = order.data || 'undefined';
        const yearMonth = dateStr.substring(0, 7); // yyyy-MM

        dateDistribution[yearMonth] = (dateDistribution[yearMonth] || 0) + 1;

        if (order.notaFiscal?.id) withNF++;

        if (sampleDates.length < 10) {
            sampleDates.push(dateStr);
        }
    });

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 [DEBUG] Distribuição de datas dos pedidos:');
    Object.entries(dateDistribution)
        .sort(([a], [b]) => b.localeCompare(a))
        .forEach(([month, count]) => {
            console.log(`   ${month}: ${count} pedidos`);
        });
    console.log('═══════════════════════════════════════════════════════════');

    return {
        total: salesSnapshot.size,
        withNF,
        dateDistribution,
        sampleDates,
    };
}

/**
 * Busca dados de demanda de produção DIRETAMENTE do Bling
 * Isso evita problemas de divergência com dados locais do Firebase
 */
export async function getProductionDemandFromBling(
    { from, to }: { from?: Date, to?: Date }
): Promise<ProductionDemand[]> {
    if (!from || !to) {
        return [];
    }

    const formatDate = (d: Date) => d.toISOString().split('T')[0];
    const fromDateStr = formatDate(from);
    const toDateStr = formatDate(to);

    console.log('═══════════════════════════════════════════════════════════');
    console.log(`📊 [PRODUÇÃO BLING] Buscando demanda DIRETO do Bling`);
    console.log(`📊 [PRODUÇÃO BLING] Período: ${fromDateStr} a ${toDateStr}`);
    console.log('═══════════════════════════════════════════════════════════');

    // Buscar estoque e supplies em paralelo enquanto processamos os pedidos
    const [stockDataResult, suppliesSnapshot] = await Promise.all([
        getProductsStock(),
        getDocs(query(collection(db, "supplies")))
    ]);

    const stockMap = new Map<string, number>();
    stockDataResult.data.forEach(stockItem => {
        stockMap.set(stockItem.produto.codigo, stockItem.saldoVirtualTotal);
    });

    const supplyInfoMap = new Map<string, { stockMin?: number; stockMax?: number }>();
    suppliesSnapshot.forEach(d => {
        const s = d.data() as Supply;
        const key = (s?.codigo as string) || d.id;
        if (key) {
            supplyInfoMap.set(key, {
                stockMin: s?.estoqueMinimo,
                stockMax: s?.estoqueMaximo,
            });
        }
    });

    // Buscar pedidos do Bling
    const blingUrl = `https://api.bling.com.br/Api/v3/pedidos/vendas?dataInicial=${fromDateStr}&dataFinal=${toDateStr}`;

    console.log('📥 [PRODUÇÃO BLING] Listando todos os pedidos do período...');
    const allBlingOrders = await blingGetPaged(blingUrl);
    console.log(`📊 [PRODUÇÃO BLING] Total de pedidos no período: ${allBlingOrders.length}`);

    const productDemand = new Map<string, {
        description: string,
        orderIds: Set<number>,
        totalQuantity: number
    }>();

    let ordersWithNF = 0;
    let ordersProcessed = 0;
    let ordersWithItems = 0;

    // Debug específico para SKU de teste
    const DEBUG_SKU = 'CNUL440205140IN';
    const debugSkuOrders: { orderId: number, orderDate: string, nfId: number | null, qty: number }[] = [];

    console.log('📦 [PRODUÇÃO BLING] Buscando detalhes de cada pedido...');
    console.log('⚠️ Isso pode levar alguns minutos devido ao rate limit da API...');

    for (const order of allBlingOrders) {
        ordersProcessed++;

        if (ordersProcessed % 100 === 0) {
            console.log(`🔄 [PRODUÇÃO BLING] Progresso: ${ordersProcessed}/${allBlingOrders.length} pedidos...`);
        }

        try {
            const details = await blingFetchWithRefresh(`https://api.bling.com.br/Api/v3/pedidos/vendas/${order.id}`);
            const orderData = details?.data;

            if (!orderData) continue;

            // Verificar se tem nota fiscal
            const hasNF = orderData.notaFiscal && orderData.notaFiscal.id;
            if (!hasNF) continue;

            ordersWithNF++;

            if (!orderData.itens || orderData.itens.length === 0) continue;
            ordersWithItems++;

            // Processar itens do pedido
            orderData.itens.forEach((item: any) => {
                const sku = item.codigo || 'SKU_INDEFINIDO';
                const currentData = productDemand.get(sku) || {
                    description: item.descricao,
                    orderIds: new Set(),
                    totalQuantity: 0
                };

                currentData.orderIds.add(orderData.id);
                currentData.totalQuantity += item.quantidade || 0;
                productDemand.set(sku, currentData);

                // Debug para SKU específico
                if (sku === DEBUG_SKU) {
                    debugSkuOrders.push({
                        orderId: orderData.id,
                        orderDate: orderData.data,
                        nfId: orderData.notaFiscal?.id || null,
                        qty: item.quantidade || 0
                    });
                }
            });
        } catch (e: any) {
            console.warn(`⚠️ [PRODUÇÃO BLING] Erro ao buscar pedido ${order.id}: ${e.message}`);
        }
    }

    console.log('───────────────────────────────────────────────────────────');
    console.log(`📊 [PRODUÇÃO BLING] Total pedidos processados: ${ordersProcessed}`);
    console.log(`📊 [PRODUÇÃO BLING] Pedidos COM nota fiscal: ${ordersWithNF}`);
    console.log(`📊 [PRODUÇÃO BLING] Pedidos COM NF e itens: ${ordersWithItems}`);
    console.log('───────────────────────────────────────────────────────────');

    // Log específico do SKU de debug
    if (debugSkuOrders.length > 0) {
        const totalQty = debugSkuOrders.reduce((sum, o) => sum + o.qty, 0);
        const uniqueOrders = new Set(debugSkuOrders.map(o => o.orderId)).size;
        console.log(`🔍 [DEBUG SKU BLING: ${DEBUG_SKU}]`);
        console.log(`   - Pedidos únicos: ${uniqueOrders}`);
        console.log(`   - Quantidade total: ${totalQty}`);
        console.log(`   - Detalhes dos pedidos:`);
        debugSkuOrders.slice(0, 10).forEach(o => {
            console.log(`     * Pedido ${o.orderId} | Data: ${o.orderDate} | NF: ${o.nfId} | Qty: ${o.qty}`);
        });
        if (debugSkuOrders.length > 10) {
            console.log(`     ... e mais ${debugSkuOrders.length - 10} pedidos`);
        }
    }
    console.log('───────────────────────────────────────────────────────────');

    const days = differenceInDays(to, from) + 1;
    const weeks = Math.max(1, days / 7);

    const result = Array.from(productDemand.entries())
        .map(([sku, data]) => {
            const orderCount = data.orderIds.size;
            const weeklyAverage = data.totalQuantity / weeks;
            const corte = Math.floor(weeklyAverage * 2);
            const dobra = Math.floor(weeklyAverage * 1.5);
            const supplyInfo = supplyInfoMap.get(sku);

            return {
                sku,
                description: data.description,
                orderCount: orderCount,
                totalQuantitySold: data.totalQuantity,
                weeklyAverage: weeklyAverage,
                corte: corte,
                dobra: dobra,
                stockLevel: stockMap.get(sku),
                stockMin: supplyInfo?.stockMin,
                stockMax: supplyInfo?.stockMax,
            };
        })
        .sort((a, b) => b.weeklyAverage - a.weeklyAverage);

    console.log('═══════════════════════════════════════════════════════════');
    console.log(`✅ [PRODUÇÃO BLING] Análise concluída! ${result.length} SKUs encontrados`);
    console.log('═══════════════════════════════════════════════════════════');

    return result;
}

export type StockData = {
    stockLevel?: number;
    stockMin?: number;
    stockMax?: number;
}

export async function updateSingleSkuStock(sku: string): Promise<StockData | null> {
    try {
        const productData = await getBlingProductBySku(sku);
        if (productData?.data) {
            const { estoque } = productData.data;

            const stockInfo: StockData = {
                stockLevel: estoque?.saldoVirtualTotal,
                stockMin: typeof estoque?.minimo === "number" ? estoque.minimo : undefined,
                stockMax: typeof estoque?.maximo === "number" ? estoque.maximo : undefined,
            };

            await updateSupplyBySku(sku, {
                estoqueMinimo: stockInfo.stockMin,
                estoqueMaximo: stockInfo.stockMax,
            });

            return stockInfo;
        }
        return null;
    } catch (error: any) {
        console.error(`Falha ao buscar dados de estoque para o SKU ${sku}:`, error);
        throw new Error(`Não foi possível atualizar o estoque para o SKU ${sku}.`);
    }
}


export async function deleteAllSalesOrders(): Promise<{ deletedCount: number }> {
    const ordersCollection = collection(db, 'salesOrders');
    const snapshot = await getDocs(ordersCollection);
    
    if (snapshot.empty) {
        return { deletedCount: 0 };
    }

    // Firestore allows a maximum of 500 operations in a single batch.
    const batchSize = 500;
    let deletedCount = 0;

    for (let i = 0; i < snapshot.docs.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = snapshot.docs.slice(i, i + batchSize);
        chunk.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        deletedCount += chunk.length;
        console.log(`Deleted ${chunk.length} orders in batch.`);
    }

    console.log(`Successfully deleted ${deletedCount} total orders.`);
    return { deletedCount };
}

export async function backfillOrdersMissingItems() {
  const col = collection(db, 'salesOrders');
  const snap = await getDocs(query(col));

  const missing: string[] = [];
  snap.forEach(doc => {
    const d = doc.data() as any;
    if (!d.itens || !Array.isArray(d.itens) || d.itens.length === 0) {
      missing.push(String(d.id ?? doc.id));
    }
  });

  let fixed = 0;
  for (const id of missing) {
    try {
      // Usa o mesmo fetch com refresh já existente
      const data = await getBlingOrderDetails(id);
      if (data?.data?.itens?.length) fixed++;
    } catch (e) {
      console.warn('Falha ao backfill do pedido', id, e);
    }
  }
  return { examined: snap.size, missing: missing.length, fixed };
}

/**
 * Busca as situações de pedidos de venda do Bling
 * Retorna um mapa de id -> nome
 */
async function fetchSituacoesFromBling(): Promise<Map<number, string>> {
  const url = `https://api.bling.com.br/Api/v3/situacoes/modulos/98310`;  // 98310 = módulo de pedidos de venda
  console.log('📋 [REPAIR] Buscando situações de pedidos de venda...');

  const response = await blingFetchWithRefresh(url);
  const mapa = new Map<number, string>();

  if (response?.data && Array.isArray(response.data)) {
    for (const sit of response.data) {
      if (sit.id && sit.nome) {
        mapa.set(sit.id, sit.nome);
      }
    }
    console.log(`✅ [REPAIR] ${mapa.size} situações carregadas`);
  }

  return mapa;
}

/**
 * Repara pedidos que não possuem o campo situacao.nome
 * A API v3 do Bling não retorna o nome da situação, apenas id e valor
 */
export async function repairOrdersSituacaoNome(): Promise<{ examined: number; missing: number; fixed: number }> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔧 [REPAIR] Iniciando reparo de situação dos pedidos...');
  console.log('═══════════════════════════════════════════════════════════');

  // 1. Buscar mapeamento de situações do Bling
  const situacoes = await fetchSituacoesFromBling();

  if (situacoes.size === 0) {
    console.error('❌ [REPAIR] Nenhuma situação encontrada no Bling');
    return { examined: 0, missing: 0, fixed: 0 };
  }

  // 2. Buscar todos os pedidos do Firebase
  const col = collection(db, 'salesOrders');
  const snap = await getDocs(query(col));

  console.log(`📊 [REPAIR] Total de pedidos no Firebase: ${snap.size}`);

  // 3. Identificar pedidos sem situacao.nome
  const ordersToFix: { docId: string; situacaoId: number }[] = [];

  snap.forEach(docSnap => {
    const data = docSnap.data();
    if (data.situacao?.id && !data.situacao?.nome) {
      ordersToFix.push({
        docId: docSnap.id,
        situacaoId: data.situacao.id,
      });
    }
  });

  console.log(`📋 [REPAIR] Pedidos sem situacao.nome: ${ordersToFix.length}`);

  if (ordersToFix.length === 0) {
    return { examined: snap.size, missing: 0, fixed: 0 };
  }

  // 4. Atualizar em lotes
  const BATCH_SIZE = 100;
  let fixed = 0;

  for (let i = 0; i < ordersToFix.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = ordersToFix.slice(i, i + BATCH_SIZE);

    for (const order of chunk) {
      const nome = situacoes.get(order.situacaoId);
      if (nome) {
        const docRef = doc(db, 'salesOrders', order.docId);
        batch.update(docRef, { 'situacao.nome': nome });
        fixed++;
      }
    }

    await batch.commit();
    console.log(`   📦 Lote ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} pedidos processados`);
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`✅ [REPAIR] Concluído: ${fixed} pedidos atualizados`);
  console.log('═══════════════════════════════════════════════════════════');

  return { examined: snap.size, missing: ordersToFix.length, fixed };
}

/**
 * Funçao para limpar as credenciais do Bling.
 * Útil para forçar uma nova autenticação.
 */
export async function clearBlingCredentials() {
    try {
        await saveBlingCredentials({
            accessToken: undefined,
            refreshToken: undefined,
            expiresAt: undefined
        });
        console.log("Credenciais do Bling foram limpas com sucesso.");
        return { success: true };
    } catch (error) {
        console.error("Erro ao limpar credenciais do Bling:", error);
        return { success: false, error: (error as Error).message };
    }
}

/**
 * Diagnóstico completo para um SKU específico
 * Compara dados do Firebase com dados do Bling
 */
export async function diagnoseSku(sku: string, fromDate?: Date, toDate?: Date) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`🔍 [DIAGNÓSTICO] Iniciando análise do SKU: ${sku}`);
    console.log('═══════════════════════════════════════════════════════════');

    const from = fromDate || new Date(new Date().setMonth(new Date().getMonth() - 3));
    const to = toDate || new Date();
    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    // 1. Buscar dados do Firebase
    console.log('\n📊 [FIREBASE] Buscando pedidos no banco local...');
    const salesSnapshot = await getDocs(collection(db, 'salesOrders'));

    const firebaseOrders: {
        orderId: number;
        orderDate: string;
        hasNF: boolean;
        nfId: number | null;
        qty: number;
        hasItems: boolean;
        situacao: string;
    }[] = [];

    let totalQtyFirebase = 0;
    let ordersWithoutItems = 0;

    salesSnapshot.forEach(docSnap => {
        const order = docSnap.data() as SaleOrder;
        const orderDate = order.data;

        // Verifica se está no período
        if (orderDate >= formatDate(from) && orderDate <= formatDate(to)) {
            const hasItems = order.itens && order.itens.length > 0;

            if (!hasItems) {
                ordersWithoutItems++;
            }

            // Procura o SKU nos itens
            const matchingItems = order.itens?.filter(item => item.codigo === sku) || [];

            if (matchingItems.length > 0) {
                const qty = matchingItems.reduce((sum, item) => sum + item.quantidade, 0);
                totalQtyFirebase += qty;

                firebaseOrders.push({
                    orderId: order.id,
                    orderDate: order.data,
                    hasNF: !!(order.notaFiscal && order.notaFiscal.id),
                    nfId: order.notaFiscal?.id || null,
                    qty,
                    hasItems,
                    situacao: order.situacao?.nome || 'Desconhecido'
                });
            }
        }
    });

    console.log(`📊 [FIREBASE] Total de pedidos no período: ${salesSnapshot.size}`);
    console.log(`📊 [FIREBASE] Pedidos sem itens: ${ordersWithoutItems}`);
    console.log(`📊 [FIREBASE] Pedidos com SKU ${sku}: ${firebaseOrders.length}`);
    console.log(`📊 [FIREBASE] Quantidade total do SKU: ${totalQtyFirebase}`);

    // 2. Buscar dados do Bling - todos os pedidos do período
    console.log('\n🌐 [BLING] Buscando pedidos na API do Bling...');
    const blingUrl = `https://api.bling.com.br/Api/v3/pedidos/vendas?dataInicial=${formatDate(from)}&dataFinal=${formatDate(to)}`;

    let blingOrdersWithSku: {
        orderId: number;
        orderDate: string;
        hasNF: boolean;
        nfId: number | null;
        qty: number;
        situacao: string;
        existsInFirebase: boolean;
    }[] = [];

    let totalQtyBling = 0;
    let totalBlingOrders = 0;
    let ordersChecked = 0;

    try {
        // Lista todos os pedidos do período
        const allBlingOrders = await blingGetPaged(blingUrl);
        totalBlingOrders = allBlingOrders.length;

        console.log(`🌐 [BLING] Total de pedidos no período: ${totalBlingOrders}`);
        console.log(`🌐 [BLING] Verificando quais contêm o SKU ${sku}...`);
        console.log(`⚠️ Isso pode levar alguns minutos devido ao rate limit da API...`);

        // Para cada pedido, buscar detalhes e verificar o SKU
        // Limitamos a verificação para não demorar muito
        const firebaseOrderIds = new Set(firebaseOrders.map(o => o.orderId));

        for (const order of allBlingOrders) {
            ordersChecked++;

            if (ordersChecked % 50 === 0) {
                console.log(`🔄 [BLING] Verificados ${ordersChecked}/${totalBlingOrders} pedidos...`);
            }

            try {
                const details = await blingFetchWithRefresh(`https://api.bling.com.br/Api/v3/pedidos/vendas/${order.id}`);
                const orderData = details?.data;

                if (orderData && orderData.itens) {
                    const matchingItems = orderData.itens.filter((item: any) => item.codigo === sku);

                    if (matchingItems.length > 0) {
                        const qty = matchingItems.reduce((sum: number, item: any) => sum + (item.quantidade || 0), 0);
                        totalQtyBling += qty;

                        blingOrdersWithSku.push({
                            orderId: order.id,
                            orderDate: orderData.data || order.data,
                            hasNF: !!(orderData.notaFiscal && orderData.notaFiscal.id),
                            nfId: orderData.notaFiscal?.id || null,
                            qty,
                            situacao: orderData.situacao?.nome || 'Desconhecido',
                            existsInFirebase: firebaseOrderIds.has(order.id)
                        });
                    }
                }
            } catch (e: any) {
                console.warn(`⚠️ Erro ao buscar pedido ${order.id}: ${e.message}`);
            }
        }

    } catch (error: any) {
        console.error(`❌ [BLING] Erro ao buscar pedidos: ${error.message}`);
    }

    console.log(`\n🌐 [BLING] Pedidos com SKU ${sku}: ${blingOrdersWithSku.length}`);
    console.log(`🌐 [BLING] Quantidade total do SKU: ${totalQtyBling}`);

    // 3. Análise de divergência
    const missingInFirebase = blingOrdersWithSku.filter(o => !o.existsInFirebase);
    const ordersWithoutNFInFirebase = firebaseOrders.filter(o => !o.hasNF);
    const ordersWithNFInFirebase = firebaseOrders.filter(o => o.hasNF);

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📋 RESULTADO DO DIAGNÓSTICO');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`\nSKU analisado: ${sku}`);
    console.log(`Período: ${formatDate(from)} a ${formatDate(to)}`);
    console.log('\n--- FIREBASE (Banco Local) ---');
    console.log(`Pedidos encontrados: ${firebaseOrders.length}`);
    console.log(`  - Com Nota Fiscal: ${ordersWithNFInFirebase.length}`);
    console.log(`  - Sem Nota Fiscal: ${ordersWithoutNFInFirebase.length}`);
    console.log(`Quantidade total: ${totalQtyFirebase}`);
    console.log(`  - Em pedidos COM NF: ${ordersWithNFInFirebase.reduce((s, o) => s + o.qty, 0)}`);
    console.log(`  - Em pedidos SEM NF: ${ordersWithoutNFInFirebase.reduce((s, o) => s + o.qty, 0)}`);

    console.log('\n--- BLING (API) ---');
    console.log(`Pedidos verificados: ${ordersChecked}`);
    console.log(`Pedidos com o SKU: ${blingOrdersWithSku.length}`);
    console.log(`Quantidade total: ${totalQtyBling}`);

    console.log('\n--- DIVERGÊNCIAS ---');
    console.log(`Diferença de quantidade: ${totalQtyBling - totalQtyFirebase}`);
    console.log(`Pedidos faltando no Firebase: ${missingInFirebase.length}`);

    if (missingInFirebase.length > 0) {
        console.log('\nPedidos do Bling que NÃO estão no Firebase:');
        missingInFirebase.slice(0, 20).forEach(o => {
            console.log(`  - Pedido ${o.orderId} | Data: ${o.orderDate} | NF: ${o.hasNF ? o.nfId : 'NÃO'} | Qty: ${o.qty} | Status: ${o.situacao}`);
        });
        if (missingInFirebase.length > 20) {
            console.log(`  ... e mais ${missingInFirebase.length - 20} pedidos`);
        }
    }

    return {
        sku,
        period: { from: formatDate(from), to: formatDate(to) },
        firebase: {
            ordersCount: firebaseOrders.length,
            ordersWithNF: ordersWithNFInFirebase.length,
            ordersWithoutNF: ordersWithoutNFInFirebase.length,
            totalQuantity: totalQtyFirebase,
            quantityWithNF: ordersWithNFInFirebase.reduce((s, o) => s + o.qty, 0),
            quantityWithoutNF: ordersWithoutNFInFirebase.reduce((s, o) => s + o.qty, 0),
            orders: firebaseOrders
        },
        bling: {
            totalOrdersInPeriod: totalBlingOrders,
            ordersWithSku: blingOrdersWithSku.length,
            totalQuantity: totalQtyBling,
            orders: blingOrdersWithSku
        },
        divergence: {
            quantityDiff: totalQtyBling - totalQtyFirebase,
            missingOrders: missingInFirebase.length,
            missingOrderIds: missingInFirebase.map(o => o.orderId)
        }
    };
}

// Re-exporting user service functions from here to avoid breaking existing imports
export const getUsers = getUsersService;
export const addUser = addUserService;
export const deleteUser = deleteUserService;
export const seedUsers = seedUsersService;

    




    
