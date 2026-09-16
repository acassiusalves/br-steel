
"use server";

import { getFullBlingCredentials, blingFetchWithRefresh, blingGetPaged } from '@/server/integrations/bling';
import { beginBlingConnection } from '@/server/integrations/bling-oauth';
import { requireWebContext } from '@/server/operations/context';
import { requireOperation, documentIdSchema, dateRangeSchema } from '@/server/operations/common';
import { requireCoreWritesEnabled } from '@/server/operations/maintenance';
import { salesReadRepository } from '@/server/persistence/sales';
import { requireFirestoreSource } from '@/server/persistence/source';
import { summarizeSales } from '@/server/operations/sales';
import { readStockSnapshot, invalidateProductStockCache, refreshProductionSku } from '@/server/operations/stock';
import { productionDemand } from '@/server/operations/production-demand';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { format } from 'date-fns';

import { saveSalesOrders, filterNewOrders, getLastImportedOrderDate, saveSalesOrdersOptimized, getImportedOrderIdsWithDetails } from '@/services/order-service';

import {
    createInvoiceEnrichmentStats,
    enrichOrderWithInvoice,
    mergeInvoiceEnrichmentStats,
} from '@/services/bling-invoice-service';
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
    type SessionUser,
} from '@/lib/server-auth';
import { getUsers as getUsersService, addUser as addUserService, deleteUser as deleteUserService } from '@/services/user-service';
import { requireAdministrator, requireActionPage } from '@/server/access/current-user';
import { fetchBrSteelProductsSheet } from '@/services/brsteel-products-sheet';
import {
    approveSafeBrSteelSkuAssociations,
    getBrSteelProductAssociationOverview,
    replaceBrSteelSkuAssociationsForParent,
    saveBrSteelProductKitComposition as saveBrSteelProductKitCompositionService,
} from '@/services/brsteel-product-associations';


// Bling API actions
type BlingCredentials = {
    clientId?: string;
    clientSecret?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
};


// --- Firestore-based Credential Storage ---

const credentialsDocRef = adminDb.collection("appConfig").doc("blingCredentials");
const syncProgressDocRef = adminDb.collection("appConfig").doc("syncProgress");
const MAX_INVOICE_DETAILS_PER_SYNC = 60;
const MAX_INVOICE_XML_PER_SYNC = 20;

async function getCurrentServerActionUser(): Promise<SessionUser> {
    return requireActionPage('/anuncios-mercado-livre');
}

// Gemini / IA
export async function getGeminiCredentials(): Promise<GeminiCredentialsPublic> {
    return getGeminiCredentialsAdmin();
}

export async function getBrSteelProductsFromSheet() {
    return fetchBrSteelProductsSheet();
}

export async function getBrSteelProductAssociationsOverview() {
    return getBrSteelProductAssociationOverview();
}

export async function approveBrSteelSafeProductSkuAssociations() {
    return approveSafeBrSteelSkuAssociations();
}

export async function replaceBrSteelProductSkuAssociations(input: {
    parentSku: string;
    childSkus: string[];
}) {
    return replaceBrSteelSkuAssociationsForParent({
        parentSku: input.parentSku,
        childSkus: input.childSkus,
        source: 'manual',
    });
}

export async function saveBrSteelProductKitComposition(input: {
    kitSku: string;
    components: Array<{
        parentSku: string;
        quantity: number;
    }>;
}) {
    return saveBrSteelProductKitCompositionService({
        kitSku: input.kitSku,
        components: input.components,
        source: 'manual',
    });
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
    requireOperation(await requireWebContext(), 'vendas:sync');
    try {
        await syncProgressDocRef.set( {
            ...progress,
            updatedAt: new Date().toISOString(),
        }, { merge: true });
    } catch (error) {
        console.error('Erro ao atualizar progresso da sincronização:', error);
    }
}

export async function getSyncProgress(): Promise<SyncProgress | null> {
    requireOperation(await requireWebContext(), 'vendas:read');
    try {
        const snap = await syncProgressDocRef.get();
        if (!snap.exists) return null;
        return snap.data() as SyncProgress;
    } catch (error) {
        console.error('Erro ao obter progresso da sincronização:', error);
        return null;
    }
}

export async function clearSyncProgress(): Promise<void> {
    requireOperation(await requireWebContext(), 'vendas:sync');
    try {
        await syncProgressDocRef.set( {
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

export async function startBlingOAuth() { return beginBlingConnection(); }

export async function disconnectBling(): Promise<void> {
  await requireAdministrator();
  await credentialsDocRef.set(
    {
      clientId: FieldValue.delete(),
      clientSecret: FieldValue.delete(),
      accessToken: FieldValue.delete(),
      refreshToken: FieldValue.delete(),
      expiresAt: FieldValue.delete(),
    },
    { merge: true }
  );
}

function asField(v?: string | null) {
  return v === '' || v == null ? FieldValue.delete() : v;
}

export async function saveBlingCredentials(partial: Partial<BlingCredentials>): Promise<void> {
  await requireAdministrator();
  z.object({ clientId: z.string().max(500).optional(), clientSecret: z.string().max(2000).optional(), accessToken: z.string().max(4000).optional(), refreshToken: z.string().max(4000).optional(), expiresAt: z.number().finite().optional() }).strict().parse(partial);
  await credentialsDocRef.set(
    {
      ...(partial.clientId       !== undefined ? { clientId: asField(partial.clientId) }       : {}),
      ...(partial.clientSecret   !== undefined ? { clientSecret: asField(partial.clientSecret) } : {}),
      ...(partial.accessToken    !== undefined ? { accessToken: asField(partial.accessToken) }   : {}),
      ...(partial.refreshToken   !== undefined ? { refreshToken: asField(partial.refreshToken) } : {}),
      ...(partial.expiresAt      !== undefined ? { expiresAt: partial.expiresAt ?? FieldValue.delete() } : {}),
    },
    { merge: true }
  );
}

export async function getBlingCredentials(): Promise<{
  clientId?: string;
  clientSecret?: string; // mascarado
  connected: boolean;
}> {
  await requireActionPage('/api-settings');
  const snap = await credentialsDocRef.get();
  if (!snap.exists) return { connected: false };

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
    requireOperation(await requireWebContext(), 'vendas:sync');
    if (from || to) civilRange(from, to);
    z.object({ includeInvoiceDetails: z.boolean().optional(), fetchInvoiceXml: z.boolean().optional() }).strict().parse(options);
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
    requireOperation(await requireWebContext(), 'vendas:sync');
    // Refused at the start rather than mid-run: a sync that begins during the window would still be
    // writing orders while the cutover reconciliation believes the writers are stopped.
    await requireCoreWritesEnabled();
    if (from || to) civilRange(from, to);
    z.object({ includeInvoiceDetails: z.boolean().optional(), fetchInvoiceXml: z.boolean().optional() }).strict().parse(options);
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
    requireOperation(await requireWebContext(), 'vendas:sync');
    // Reads from Bling but persists the enriched order, so it is a writer for the cutover's purposes.
    await requireCoreWritesEnabled();
    z.string().regex(/^\d+$/).max(30).parse(orderId);
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
    requireOperation(await requireWebContext(), 'vendas:read');
    z.string().regex(/^\d+$/).max(30).parse(orderId);
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
    requireOperation(await requireWebContext(), 'estoque:read');
    const baseUrl = new URL('https://api.bling.com.br/Api/v3/produtos');
    baseUrl.searchParams.set('limite', String(z.number().int().min(1).max(100).parse(limit)));
    
    try {
        const products = await blingFetchWithRefresh(baseUrl.toString());
        return products;
    } catch (error: any) {
        console.error('Falha ao buscar produtos no Bling:', error);
        throw new Error(`Falha na comunicação com a API do Bling: ${error.message}`);
    }
}

export async function getBlingProductBySku(sku: string): Promise<any> {
    requireOperation(await requireWebContext(), 'estoque:read');
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

export type { ProductStock } from '@/types/product-stock';
export type { ProductionDemand } from '@/server/operations/production-demand';
function civilRange(from?: Date, to?: Date) {
  return dateRangeSchema.parse({ from: from && format(from, 'yyyy-MM-dd'), to: to && format(to, 'yyyy-MM-dd') });
}
export async function clearStockUpdates(): Promise<{ deleted: number }> {
  await requireAdministrator();
  await requireFirestoreSource('Limpar observações de estoque');
  const rows = await adminDb.collection('stockUpdates').get();
  for (let i = 0; i < rows.size; i += 400) {
    const batch = adminDb.batch(); rows.docs.slice(i, i + 400).forEach(doc => batch.delete(doc.ref)); await batch.commit();
  }
  await invalidateProductStockCache(); return { deleted: rows.size };
}
export async function invalidateStockCache(): Promise<void> {
  requireOperation(await requireWebContext(), 'estoque:read'); await invalidateProductStockCache();
}
export async function getProductsStock() {
  requireOperation(await requireWebContext(), 'estoque:read'); return readStockSnapshot();
}
export async function countImportedOrders(): Promise<number> {
  requireOperation(await requireWebContext(), 'vendas:read');
  return salesReadRepository.count();
}
export async function getSalesDashboardData({ from, to }: { from?: Date; to?: Date }) {
  return (await summarizeSales(await requireWebContext(), civilRange(from, to))).data;
}
export async function getProductionDemand({ from, to }: { from?: Date; to?: Date }) {
  return (await productionDemand(await requireWebContext(), civilRange(from, to))).data;
}
/** Compatibility entry point: demand uses imported orders and the shared stock source. */
export async function getProductionDemandFromBling(input: { from?: Date; to?: Date }) { return getProductionDemand(input); }
export type StockData = { stockLevel: number | null; stockMin?: number; stockMax?: number };
export async function updateSingleSkuStock(sku: string): Promise<StockData> {
  return (await refreshProductionSku(await requireWebContext(), sku)).data;
}
export async function deleteAllSalesOrders(): Promise<{ deletedCount: number }> {
  await requireAdministrator();
  await requireFirestoreSource('Apagar todos os pedidos');
  const rows = await adminDb.collection('salesOrders').get();
  for (let i = 0; i < rows.size; i += 400) {
    const batch = adminDb.batch(); rows.docs.slice(i, i + 400).forEach(doc => batch.delete(doc.ref)); await batch.commit();
  }
  return { deletedCount: rows.size };
}

// ============================================================================
// MERCADO LIVRE INTEGRATION
// ============================================================================

import type { MercadoLivreCredentials } from '@/lib/types';

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


    




    
