
"use server";

import * as fs from 'fs/promises';
import * as path from 'path';
import { cookies } from 'next/headers';
import { format, parseISO, startOfMonth, endOfMonth, eachMonthOfInterval, getMonth, getYear, differenceInDays } from 'date-fns';
import { collection, getDocs, doc, writeBatch, query, where, setDoc, getDoc, deleteField, addDoc, deleteDoc, orderBy, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

import { saveSalesOrders, filterNewOrders, getLastImportedOrderDate, orderExists, saveSalesOrdersOptimized, getImportedOrderIdsWithDetails } from '@/services/order-service';
import { updateSupplyBySku } from '@/services/supply-service';
import {
    createInvoiceEnrichmentStats,
    enrichOrderWithInvoice,
    mergeInvoiceEnrichmentStats,
} from '@/services/bling-invoice-service';
import type { SaleOrder } from '@/types/sale-order';
import type { Supply } from '@/types/supply';
import { seedUsers as seedUsersService, getUsers as getUsersService, addUser as addUserService, deleteUser as deleteUserService } from '@/services/user-service';
import {
    searchMlDocumentation as _searchMlDocumentation,
    getMlDocumentationPage as _getMlDocumentationPage,
    listMlMcpTools as _listMlMcpTools,
    type MlMcpCallResult,
} from '@/services/ml-mcp';
import {
    getGeminiCredentialsAdmin,
    saveGeminiCredentialsAdmin,
    type GeminiCredentialsPublic,
} from '@/services/gemini-config';
import {
    getMercadoLivreListingDetailsCache,
    listMercadoLivreListingsCache,
    syncMercadoLivreListingsCache,
    updateMercadoLivreListingAttributesCache,
    updateMercadoLivreListingDescriptionCache,
    updateMercadoLivreListingPriceCache,
    updateMercadoLivreListingStatusCache,
    updateMercadoLivreListingStockCache,
    updateMercadoLivreListingTitleCache,
    type MlListingAttributePatch,
    type MlListingEditableStatus,
    type MlListingDetails,
    type MlListingUpdateResult,
    type MlListingsFilters,
    type MlListingsListResult,
    type MlListingsSyncReport,
} from '@/services/ml-listings-cache';
import {
    syncMercadoLivreAdsAnalyticsCache,
    type MlAdsSyncReport,
} from '@/services/ml-ads-analytics-cache';
import {
    AUTH_COOKIE_NAME,
    verifySessionToken,
    type SessionUser,
} from '@/lib/server-auth';


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
const MAX_INVOICE_DETAILS_PER_SYNC = 60;
const MAX_INVOICE_XML_PER_SYNC = 20;

async function getCurrentServerActionUser(): Promise<SessionUser> {
    const cookieStore = await cookies();
    const session = verifySessionToken(cookieStore.get(AUTH_COOKIE_NAME)?.value);
    if (!session?.user) {
        throw new Error('Sessão expirada. Faça login novamente.');
    }
    return session.user;
}

// Gemini / IA
export async function getGeminiCredentials(): Promise<GeminiCredentialsPublic> {
    return getGeminiCredentialsAdmin();
}

export async function saveGeminiCredentials(partial: { apiKey?: string }): Promise<void> {
    await saveGeminiCredentialsAdmin(partial);
}

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

export type OrderSyncOptions = {
    includeInvoiceDetails?: boolean;
    fetchInvoiceXml?: boolean;
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
    useIntelligentDates = true,
    includeInvoiceDetails = false,
    fetchInvoiceXml = false
}: {
    from?: Date;
    to?: Date;
    forceFullSync?: boolean;
    useIntelligentDates?: boolean;
    includeInvoiceDetails?: boolean;
    fetchInvoiceXml?: boolean;
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
                summary: {
                    total: 0,
                    new: 0,
                    existing: 0,
                    processed: 0,
                    created: 0,
                    updated: 0,
                    ...createInvoiceEnrichmentStats(),
                }
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

        const ordersToProcess = await filterNewOrders(allOrders, {
            requireInvoiceDetails: includeInvoiceDetails,
            requireInvoiceXml: fetchInvoiceXml,
        });
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
                summary: {
                    total: allOrders.length,
                    new: 0,
                    existing: allOrders.length,
                    processed: 0,
                    created: 0,
                    updated: 0,
                    ...createInvoiceEnrichmentStats(),
                }
            };
        }

        const shouldForceEveryOrder = forceFullSync && !includeInvoiceDetails && !fetchInvoiceXml;
        const allOrdersToFetchDetails = shouldForceEveryOrder ? allOrders : ordersToProcess;
        const invoiceBatchLimit = fetchInvoiceXml
            ? MAX_INVOICE_XML_PER_SYNC
            : includeInvoiceDetails
                ? MAX_INVOICE_DETAILS_PER_SYNC
                : null;
        const ordersToFetchDetails = invoiceBatchLimit
            ? allOrdersToFetchDetails.slice(0, invoiceBatchLimit)
            : allOrdersToFetchDetails;
        const deferredOrders = Math.max(0, allOrdersToFetchDetails.length - ordersToFetchDetails.length);

        if (deferredOrders > 0) {
            console.log(`📄 [SYNC] Lote fiscal limitado a ${ordersToFetchDetails.length} pedidos. Pendentes para próximas execuções: ${deferredOrders}`);
        }

        console.log('───────────────────────────────────────────────────────────');
        console.log(`📦 [SYNC] FASE 3: Buscando detalhes de ${ordersToFetchDetails.length} pedidos...`);
        console.log(`📦 [SYNC] Modo: ${shouldForceEveryOrder ? 'COMPLETO (todos)' : forceFullSync ? 'COMPLETO COM FILTRO FISCAL' : 'INCREMENTAL (apenas novos)'}`);
        console.log('───────────────────────────────────────────────────────────');

        await updateSyncProgress({
            currentStep: deferredOrders > 0
                ? `Buscando lote de ${ordersToFetchDetails.length} pedidos (${deferredOrders} pendentes)...`
                : `Buscando detalhes de ${ordersToFetchDetails.length} pedidos...`,
            totalOrders: ordersToFetchDetails.length,
            currentOrder: 0,
            percentage: 15,
            phase: 'fetching_details',
        });

        const ordersWithDetails = [];
        let processedCount = 0;
        let errorCount = 0;
        const invoiceStats = createInvoiceEnrichmentStats();
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
                    let orderData = detailsData.data;

                    if (includeInvoiceDetails) {
                        const enriched = await enrichOrderWithInvoice(orderData, blingFetchWithRefresh, {
                            fetchXml: fetchInvoiceXml,
                            skipExistingXml: true,
                            source: 'api-settings-sync',
                        });
                        orderData = enriched.order;
                        mergeInvoiceEnrichmentStats(invoiceStats, enriched.stats);
                    }

                    ordersWithDetails.push(orderData);
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
        if (includeInvoiceDetails) {
            console.log(`💾 [SYNC] NFs consultadas: ${invoiceStats.invoiceDetailsFetched}`);
            console.log(`💾 [SYNC] XMLs baixados: ${invoiceStats.invoiceXmlFetched}`);
            console.log(`💾 [SYNC] Erros fiscais: ${invoiceStats.invoiceErrors + invoiceStats.invoiceXmlErrors}`);
        }
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
                existing: allOrders.length - allOrdersToFetchDetails.length,
                pending: deferredOrders,
                matchedForProcessing: allOrdersToFetchDetails.length,
                processed: processedCount,
                errors: errorCount,
                saved: saveResult.count,
                created: saveResult.created,
                updated: saveResult.updated,
                ...invoiceStats,
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


export async function smartSyncOrders(from?: Date, to?: Date, options: OrderSyncOptions = {}) {
    console.log('🧠 Iniciando sincronização inteligente...');
    const result = await getBlingSalesOrdersOptimized({ 
        from,
        to,
        forceFullSync: false,
        useIntelligentDates: !from,
        includeInvoiceDetails: options.includeInvoiceDetails,
        fetchInvoiceXml: options.fetchInvoiceXml,
    });
    return result;
}

export async function fullSyncOrders(from?: Date, to?: Date, options: OrderSyncOptions = {}) {
    console.log('🔄 Iniciando sincronização completa...');
    const result = await getBlingSalesOrdersOptimized({ 
        from, 
        to, 
        forceFullSync: true,
        useIntelligentDates: false,
        includeInvoiceDetails: options.includeInvoiceDetails,
        fetchInvoiceXml: options.fetchInvoiceXml,
    });
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
           const enriched = await enrichOrderWithInvoice(data.data, blingFetchWithRefresh, {
             fetchXml: false,
             skipExistingXml: true,
             source: 'order-detail-refresh',
           });
           await saveSalesOrders([enriched.order]);
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

// ============================================================================
// MERCADO LIVRE INTEGRATION
// ============================================================================

import type { MercadoLivreCredentials } from '@/lib/types';
import { adminDb } from '@/lib/firebase-admin';
import {
    saveMlCredentialsAdmin,
    getPrimaryMlAccountIdAdmin,
    setPrimaryMlAccountIdAdmin,
} from '@/services/firestore-admin';

/**
 * Persiste credenciais (parcial) do ML em `mercadoLivreAccounts/{accountId}`.
 * Se `accountId` não for passado, usa a conta primária. Compatível com o uso
 * antigo da UI que passa apenas `{ appId, clientSecret }`.
 */
export async function saveMercadoLivreCredentials(
    partial: Partial<MercadoLivreCredentials>,
    accountId?: string
): Promise<void> {
    const id = accountId || await getPrimaryMlAccountIdAdmin();
    await saveMlCredentialsAdmin(id, partial);

    // Se ainda não há conta primária definida, define esta como primária.
    try {
        const primarySnap = await adminDb.collection('appConfig').doc('mlPrimaryAccount').get();
        if (!primarySnap.exists) {
            await setPrimaryMlAccountIdAdmin(id);
        }
    } catch (e) {
        console.warn('saveMercadoLivreCredentials: não foi possível verificar/definir conta primária', e);
    }
    console.log(`Mercado Livre credentials saved for account ${id}.`);
}

/**
 * Lê credenciais da conta primária (ou da informada) em `mercadoLivreAccounts`.
 * `connected` é `true` quando há `refreshToken` armazenado — o serviço de token
 * cuida de renovar o accessToken sob demanda.
 */
export async function getMercadoLivreCredentials(accountId?: string): Promise<{
    appId: string;
    clientSecret: string;
    connected: boolean;
    userId?: string;
    accountId: string;
    expiresAt?: number;
}> {
    const id = accountId || await getPrimaryMlAccountIdAdmin();
    const snap = await adminDb.collection('mercadoLivreAccounts').doc(id).get();

    if (!snap.exists) {
        return { appId: '', clientSecret: '', connected: false, accountId: id };
    }

    const data = snap.data() as MercadoLivreCredentials;
    const userId = data.userId !== undefined ? String(data.userId) : undefined;

    return {
        appId: data.appId || data.clientId || '',
        clientSecret: data.clientSecret ? '********' : '',
        connected: !!data.refreshToken,
        userId,
        accountId: id,
        expiresAt: data.expiresAt,
    };
}

/** Resumo público (sem segredos) de uma conta ML para listagem na UI. */
export type MlAccountSummary = {
    accountId: string;
    appId?: string;
    userId?: string;
    nickname?: string;
    sellerId?: number;
    accountName?: string;
    apiStatus?: 'unchecked' | 'valid' | 'invalid';
    expiresAt?: number;
    lastRefreshedAt?: number;
    hasRefreshToken: boolean;
    isPrimary: boolean;
};

/**
 * Lista todas as contas em `mercadoLivreAccounts` (sem expor clientSecret nem
 * tokens). Marca a conta primária via `appConfig/mlPrimaryAccount.accountId`.
 */
export async function listMlAccounts(): Promise<MlAccountSummary[]> {
    const [snap, primaryId] = await Promise.all([
        adminDb.collection('mercadoLivreAccounts').get(),
        getPrimaryMlAccountIdAdmin().catch(() => undefined),
    ]);

    return snap.docs.map((d) => {
        const data = d.data() as MercadoLivreCredentials;
        const userId = data.userId !== undefined ? String(data.userId) : undefined;
        return {
            accountId: d.id,
            appId: data.appId || data.clientId,
            userId,
            nickname: data.nickname,
            sellerId: data.sellerId,
            accountName: data.accountName,
            apiStatus: data.apiStatus,
            expiresAt: data.expiresAt,
            lastRefreshedAt: data.lastRefreshedAt,
            hasRefreshToken: !!data.refreshToken,
            isPrimary: d.id === primaryId,
        };
    });
}

export async function getMercadoLivreListings(
    filters: MlListingsFilters = {}
): Promise<MlListingsListResult> {
    return listMercadoLivreListingsCache(filters);
}

export async function syncMercadoLivreListings(
    accountId?: string | null
): Promise<MlListingsSyncReport> {
    return syncMercadoLivreListingsCache({ accountId });
}

export async function syncMercadoLivreAdsAnalytics(
    accountId?: string | null
): Promise<MlAdsSyncReport> {
    return syncMercadoLivreAdsAnalyticsCache({ accountId });
}

export async function getMercadoLivreListingDetails(input: {
    accountId: string;
    itemId: string;
}): Promise<MlListingDetails> {
    return getMercadoLivreListingDetailsCache(input);
}

export async function updateMercadoLivreListingPrice(input: {
    accountId: string;
    itemId: string;
    price: number;
}): Promise<MlListingUpdateResult> {
    const user = await getCurrentServerActionUser();
    return updateMercadoLivreListingPriceCache({
        accountId: input.accountId,
        itemId: input.itemId,
        price: input.price,
        actor: {
            userId: user.id,
            name: user.name || null,
            email: user.email || null,
            role: user.role || null,
        },
    });
}

export async function updateMercadoLivreListingStock(input: {
    accountId: string;
    itemId: string;
    availableQuantity: number;
}): Promise<MlListingUpdateResult> {
    const user = await getCurrentServerActionUser();
    return updateMercadoLivreListingStockCache({
        accountId: input.accountId,
        itemId: input.itemId,
        availableQuantity: input.availableQuantity,
        actor: {
            userId: user.id,
            name: user.name || null,
            email: user.email || null,
            role: user.role || null,
        },
    });
}

export async function updateMercadoLivreListingStatus(input: {
    accountId: string;
    itemId: string;
    status: MlListingEditableStatus;
}): Promise<MlListingUpdateResult> {
    const user = await getCurrentServerActionUser();
    return updateMercadoLivreListingStatusCache({
        accountId: input.accountId,
        itemId: input.itemId,
        status: input.status,
        actor: {
            userId: user.id,
            name: user.name || null,
            email: user.email || null,
            role: user.role || null,
        },
    });
}

export async function updateMercadoLivreListingTitle(input: {
    accountId: string;
    itemId: string;
    title: string;
}): Promise<MlListingUpdateResult> {
    const user = await getCurrentServerActionUser();
    return updateMercadoLivreListingTitleCache({
        accountId: input.accountId,
        itemId: input.itemId,
        title: input.title,
        actor: {
            userId: user.id,
            name: user.name || null,
            email: user.email || null,
            role: user.role || null,
        },
    });
}

export async function updateMercadoLivreListingDescription(input: {
    accountId: string;
    itemId: string;
    plainText: string;
}): Promise<MlListingUpdateResult> {
    const user = await getCurrentServerActionUser();
    return updateMercadoLivreListingDescriptionCache({
        accountId: input.accountId,
        itemId: input.itemId,
        plainText: input.plainText,
        actor: {
            userId: user.id,
            name: user.name || null,
            email: user.email || null,
            role: user.role || null,
        },
    });
}

export async function updateMercadoLivreListingAttributes(input: {
    accountId: string;
    itemId: string;
    attributes: MlListingAttributePatch[];
}): Promise<MlListingUpdateResult> {
    const user = await getCurrentServerActionUser();
    return updateMercadoLivreListingAttributesCache({
        accountId: input.accountId,
        itemId: input.itemId,
        attributes: input.attributes,
        actor: {
            userId: user.id,
            name: user.name || null,
            email: user.email || null,
            role: user.role || null,
        },
    });
}

/**
 * Define qual conta é a primária (usada por `getMlToken` quando nenhuma é
 * passada). Não altera tokens — apenas o ponteiro em `appConfig/mlPrimaryAccount`.
 */
export async function setPrimaryMlAccount(accountId: string): Promise<void> {
    if (!accountId) throw new Error('accountId é obrigatório.');
    const exists = await adminDb.collection('mercadoLivreAccounts').doc(accountId).get();
    if (!exists.exists) {
        throw new Error(`Conta '${accountId}' não existe em mercadoLivreAccounts.`);
    }
    await setPrimaryMlAccountIdAdmin(accountId);
}

/**
 * Remove permanentemente uma conta de `mercadoLivreAccounts`. Se for a primária,
 * elege outra automaticamente; se não houver nenhuma, limpa o ponteiro primário.
 */
export async function deleteMlAccount(accountId: string): Promise<void> {
    if (!accountId) throw new Error('accountId é obrigatório.');
    await adminDb.collection('mercadoLivreAccounts').doc(accountId).delete();

    // Se essa era a primária, escolhe outra ou limpa o ponteiro.
    const primaryId = await getPrimaryMlAccountIdAdmin().catch(() => undefined);
    if (primaryId === accountId) {
        const remaining = await adminDb.collection('mercadoLivreAccounts').limit(1).get();
        if (!remaining.empty) {
            await setPrimaryMlAccountIdAdmin(remaining.docs[0].id);
        } else {
            await adminDb.collection('appConfig').doc('mlPrimaryAccount').delete().catch(() => {});
        }
    }
}

/**
 * Limpa tokens da conta (mantém appId/clientSecret para reconexão fácil).
 */
export async function disconnectMercadoLivre(accountId?: string): Promise<void> {
    const id = accountId || await getPrimaryMlAccountIdAdmin();
    await adminDb.collection('mercadoLivreAccounts').doc(id).set({
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        scope: null,
        userId: null,
        lastRefreshedAt: null,
    }, { merge: true });
    console.log(`Mercado Livre disconnected for account ${id}.`);
}

/**
 * Migração one-shot: copia credenciais de `appConfig/mercadoLivreCredentials`
 * (formato antigo) para `mercadoLivreAccounts/{userId || 'primary'}` e define
 * a conta primária. Idempotente: se o destino já existir, faz merge.
 */
export async function migrateMlCredentialsAction(): Promise<{
    migrated: boolean;
    accountId?: string;
    reason?: string;
}> {
    const legacyRef = adminDb.collection('appConfig').doc('mercadoLivreCredentials');
    const legacySnap = await legacyRef.get();

    if (!legacySnap.exists) {
        return { migrated: false, reason: 'Documento legado não existe.' };
    }

    const data = legacySnap.data() as MercadoLivreCredentials;

    if (!data.appId && !data.clientId && !data.refreshToken && !data.accessToken) {
        return { migrated: false, reason: 'Documento legado está vazio.' };
    }

    const userId = data.userId !== undefined ? String(data.userId) : undefined;
    const accountId = userId || 'primary';

    await saveMlCredentialsAdmin(accountId, {
        appId: data.appId || data.clientId,
        clientSecret: data.clientSecret,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        userId,
    });

    await setPrimaryMlAccountIdAdmin(accountId);

    console.log(`[MIGRATION] Credenciais migradas de appConfig/mercadoLivreCredentials para mercadoLivreAccounts/${accountId}`);
    return { migrated: true, accountId };
}

// --- Mercado Livre Actions ---

import { searchMercadoLivreProducts, getMlToken } from '@/services/mercadolivre';
import { saveProductMatchTraining, ProductMatchTraining } from '@/services/ml-firestore';
import * as crypto from 'crypto';

const ML_AUTH_BASE = 'https://auth.mercadolivre.com.br/authorization';
const ML_OAUTH_SCOPE = 'offline_access read write';
const ML_OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos

/**
 * Resolve o redirect_uri canônico. Prefere a env var (deve bater EXATAMENTE
 * com o cadastrado no painel ML Developers). Cai no `requestOrigin` apenas em
 * dev/preview quando a env não estiver definida.
 */
function resolveMlRedirectUri(requestOrigin?: string): string {
    const fromEnv = process.env.MERCADOLIVRE_REDIRECT_URI;
    if (fromEnv) return fromEnv;
    if (requestOrigin) return `${requestOrigin}/api/callback/mercadolivre`;
    throw new Error('MERCADOLIVRE_REDIRECT_URI não configurada e requestOrigin não fornecido.');
}

function base64UrlEncode(buf: Buffer): string {
    return buf.toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

/**
 * Resolve o App ID do Mercado Livre a partir de (em ordem de preferência):
 *   1. Parâmetro explícito
 *   2. Env var `MERCADOLIVRE_APP_ID`
 *   3. Doc legado `appConfig/mercadoLivreCredentials`
 *   4. Primeira conta em `mercadoLivreAccounts` que tenha appId
 */
async function resolveMlAppId(explicit?: string): Promise<string | null> {
    if (explicit) return explicit;
    if (process.env.MERCADOLIVRE_APP_ID) return process.env.MERCADOLIVRE_APP_ID;

    try {
        const legacy = await adminDb.collection('appConfig').doc('mercadoLivreCredentials').get();
        if (legacy.exists) {
            const data = legacy.data() as MercadoLivreCredentials;
            if (data.appId || data.clientId) return (data.appId || data.clientId) as string;
        }
    } catch (_) { /* ignore */ }

    try {
        const snap = await adminDb.collection('mercadoLivreAccounts').limit(5).get();
        for (const d of snap.docs) {
            const data = d.data() as MercadoLivreCredentials;
            if (data.appId) return data.appId;
            if (data.clientId) return data.clientId;
        }
    } catch (_) { /* ignore */ }

    return null;
}

/**
 * Indica à UI se o app está pronto para conexão (tem App ID configurado).
 * Não retorna o secret (segurança).
 */
export async function getMlAppConfigStatus(): Promise<{
    configured: boolean;
    source: 'env' | 'legacy-firestore' | 'account-firestore' | 'none';
    appIdMasked?: string;
}> {
    if (process.env.MERCADOLIVRE_APP_ID) {
        const a = process.env.MERCADOLIVRE_APP_ID;
        return { configured: true, source: 'env', appIdMasked: a.slice(0, 4) + '…' + a.slice(-4) };
    }
    try {
        const legacy = await adminDb.collection('appConfig').doc('mercadoLivreCredentials').get();
        if (legacy.exists) {
            const data = legacy.data() as MercadoLivreCredentials;
            const a = data.appId || data.clientId;
            if (a && data.clientSecret) {
                return { configured: true, source: 'legacy-firestore', appIdMasked: a.slice(0, 4) + '…' + a.slice(-4) };
            }
        }
    } catch (_) { /* ignore */ }
    try {
        const snap = await adminDb.collection('mercadoLivreAccounts').limit(5).get();
        for (const d of snap.docs) {
            const data = d.data() as MercadoLivreCredentials;
            const a = data.appId || data.clientId;
            if (a && data.clientSecret) {
                return { configured: true, source: 'account-firestore', appIdMasked: a.slice(0, 4) + '…' + a.slice(-4) };
            }
        }
    } catch (_) { /* ignore */ }
    return { configured: false, source: 'none' };
}

/**
 * Inicia o fluxo OAuth do Mercado Livre com proteção contra CSRF (state) e
 * PKCE (code_challenge S256). Retorna a URL de autorização para o frontend
 * apenas redirecionar o usuário.
 *
 * O `state` e o `code_verifier` ficam armazenados em
 * `appConfig/mlOAuthStates/{state}` com TTL de 10 min e são usados/invalidados
 * pelo callback.
 *
 * `appId` é opcional: quando ausente, é resolvido server-side a partir de env
 * vars ou Firestore (fluxo "Connect with Mercado Livre" sem o usuário ter de
 * cadastrar credenciais manualmente).
 */
export async function startMlOAuth(params?: {
    appId?: string;
    requestOrigin?: string; // p/ derivar redirect_uri quando env ausente (dev)
}): Promise<{ authorizationUrl: string; state: string }> {
    const appId = await resolveMlAppId(params?.appId);
    if (!appId) {
        throw new Error('App ID do Mercado Livre não configurado. Defina MERCADOLIVRE_APP_ID nas variáveis de ambiente.');
    }

    const state = crypto.randomUUID();
    // 32 bytes → 43 chars base64url (dentro do range RFC 7636: 43-128)
    const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
    const codeChallenge = base64UrlEncode(
        crypto.createHash('sha256').update(codeVerifier).digest()
    );
    const redirectUri = resolveMlRedirectUri(params?.requestOrigin);

    await adminDb.collection('appConfig')
        .doc('mlOAuthStates')
        .collection('pending')
        .doc(state)
        .set({
            codeVerifier,
            redirectUri,
            appId,
            createdAt: Date.now(),
            expiresAt: Date.now() + ML_OAUTH_STATE_TTL_MS,
        });

    const url = new URL(ML_AUTH_BASE);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', ML_OAUTH_SCOPE);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');

    return { authorizationUrl: url.toString(), state };
}

/**
 * Lê e consome (one-shot) um state pendente. Retorna `null` se inexistente
 * ou expirado.
 */
export async function consumeMlOAuthState(state: string): Promise<{
    codeVerifier: string;
    redirectUri: string;
    appId: string;
} | null> {
    if (!state) return null;
    const ref = adminDb.collection('appConfig')
        .doc('mlOAuthStates')
        .collection('pending')
        .doc(state);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const data = snap.data() as {
        codeVerifier: string;
        redirectUri: string;
        appId: string;
        expiresAt: number;
    };
    // Apaga sempre — single-use
    await ref.delete().catch(() => {});
    if (!data.expiresAt || data.expiresAt < Date.now()) return null;
    return {
        codeVerifier: data.codeVerifier,
        redirectUri: data.redirectUri,
        appId: data.appId,
    };
}

export type MlConnectionPing = {
    status: 'valid' | 'invalid';
    accountId: string;
    userId?: string | number;
    nickname?: string;
    siteId?: string;
    checkedAt: number;
    error?: string;
};

/**
 * Verifica conectividade real com a API do ML para uma conta:
 *   1. Obtém um access_token (forçando refresh se preciso) via getMlToken
 *   2. Chama GET /users/me
 *   3. Persiste status + lastCheckedAt na conta
 *
 * Retorna o resultado para a UI usar imediatamente.
 */
export async function pingMlConnection(accountId?: string): Promise<MlConnectionPing> {
    const id = accountId || await getPrimaryMlAccountIdAdmin();
    const checkedAt = Date.now();

    try {
        const token = await getMlToken(id);

        const r = await fetch('https://api.mercadolibre.com/users/me', {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
        });

        if (!r.ok) {
            const text = await r.text();
            const errMsg = `users/me retornou ${r.status}: ${text.slice(0, 200)}`;
            await saveMlCredentialsAdmin(id, {
                apiStatus: 'invalid',
                lastRefreshedAt: checkedAt,
            } as Partial<MercadoLivreCredentials>);
            return { status: 'invalid', accountId: id, checkedAt, error: errMsg };
        }

        const data = await r.json();
        await saveMlCredentialsAdmin(id, {
            apiStatus: 'valid',
            userId: data.id,
            nickname: data.nickname,
        } as Partial<MercadoLivreCredentials>);

        return {
            status: 'valid',
            accountId: id,
            userId: data.id,
            nickname: data.nickname,
            siteId: data.site_id,
            checkedAt,
        };
    } catch (e: any) {
        const errMsg = e?.message || String(e);
        try {
            await saveMlCredentialsAdmin(id, {
                apiStatus: 'invalid',
            } as Partial<MercadoLivreCredentials>);
        } catch (_) { /* swallow secondary error */ }
        return { status: 'invalid', accountId: id, checkedAt, error: errMsg };
    }
}

export async function searchMercadoLivreAction(prevState: any, formData: FormData) {
    try {
        const query = formData.get('productName') as string;
        if (!query) return { error: 'Termo de busca não informado' };

        // Default constraints
        const limit = 50; 
        
        const results = await searchMercadoLivreProducts(query, limit);
        
        return { result: results };
    } catch (error: any) {
        console.error('Error searching ML:', error);
        return { error: error.message || 'Erro ao buscar produtos' };
    }
}

// --- ML Training Action ---

// Define explicit type for input to avoid circular dependency with components

// Define explicit type for input to avoid circular dependency with components
export interface MlProductTrainingInput {
    id: string; // productId
    productName: string;
    mlBrand: string;
    mlModel: string;
    mlStorage: string | null;
    mlRam: string | null;
    feedSku: string;
    feedProductName: string;
    attributes?: any[];
}

export async function saveProductMatchTrainingAction(info: MlProductTrainingInput) {
    try {
        const trainingData: Omit<ProductMatchTraining, 'id' | 'createdAt'> = {
             mlBrand: info.mlBrand,
             mlModel: info.mlModel,
             mlStorage: info.mlStorage,
             mlRam: info.mlRam,
             feedSku: info.feedSku,
             feedProductName: info.feedProductName,
             mlProductExample: info.productName // saving name as example or we should add id? matches mlProductExample in interface
        };
        await saveProductMatchTraining(trainingData);
        return { success: true };
    } catch (error: any) {
        console.error('Error saving training:', error);
        return { success: false, error: error.message };
    }
}

export async function createCatalogListingAction(prevState: any, formData: FormData) {
    try {
        // Placeholder implementation
        await new Promise(resolve => setTimeout(resolve, 1000));
        return { success: true, message: 'Anúncio criado com sucesso (SIMULAÇÃO)' };
    } catch (error: any) {
        return { error: error.message };
    }
}

// Re-exporting user service functions from here to avoid breaking existing imports
export const getUsers = getUsersService;
export const addUser = addUserService;
export const deleteUser = deleteUserService;
export const seedUsers = seedUsersService;


// =========================================================================
// MCP Oficial do Mercado Livre — Server Actions
// =========================================================================
// Estas actions encapsulam o cliente MCP em src/services/ml-mcp.ts e
// retornam { ok, data | error } para a UI tratar erros sem throws.
// (Imports do módulo ml-mcp foram movidos para o topo do arquivo.)

export type MlDocsSearchInput = {
    accountId?: string;
    query: string;
    language?: string; // default 'pt_br'
    siteId?: string;   // default 'MLB'
    limit?: number;    // default 10
    offset?: number;
};

export type MlDocsGetPageInput = {
    accountId?: string;
    path: string;
    language?: string;
    siteId?: string;
};

export type MlDocsActionResult =
    | { ok: true; data: MlMcpCallResult }
    | { ok: false; error: string };

export async function mlDocsSearch(input: MlDocsSearchInput): Promise<MlDocsActionResult> {
    try {
        if (!input?.query?.trim()) {
            return { ok: false, error: 'Informe um termo de busca.' };
        }
        const data = await _searchMlDocumentation({
            accountId: input.accountId,
            query: input.query.trim(),
            language: input.language?.trim() || 'pt_br',
            siteId: input.siteId?.trim() || 'MLB',
            limit: typeof input.limit === 'number' ? input.limit : 10,
            offset: typeof input.offset === 'number' ? input.offset : undefined,
        });
        return { ok: true, data };
    } catch (e: any) {
        console.error('[mlDocsSearch] erro:', e);
        return { ok: false, error: e?.message || 'Falha ao consultar MCP do Mercado Livre.' };
    }
}

export async function mlDocsGetPage(input: MlDocsGetPageInput): Promise<MlDocsActionResult> {
    try {
        if (!input?.path?.trim()) {
            return { ok: false, error: 'Informe o path da página.' };
        }
        const data = await _getMlDocumentationPage({
            accountId: input.accountId,
            path: input.path.trim(),
            language: input.language?.trim() || 'pt_br',
            siteId: input.siteId?.trim() || 'MLB',
        });
        return { ok: true, data };
    } catch (e: any) {
        console.error('[mlDocsGetPage] erro:', e);
        return { ok: false, error: e?.message || 'Falha ao buscar página de documentação.' };
    }
}

export async function mlDocsListTools(accountId?: string): Promise<
    | { ok: true; tools: Array<{ name: string; description?: string }> }
    | { ok: false; error: string }
> {
    try {
        const r = await _listMlMcpTools(accountId);
        return { ok: true, tools: r.tools };
    } catch (e: any) {
        console.error('[mlDocsListTools] erro:', e);
        return { ok: false, error: e?.message || 'Falha ao listar tools do MCP.' };
    }
}


    




    
