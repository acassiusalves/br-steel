
"use server";

import * as fs from 'fs/promises';
import * as path from 'path';
import { format, parseISO, startOfMonth, endOfMonth, eachMonthOfInterval, getMonth, getYear, differenceInDays } from 'date-fns';
import { collection, getDocs, doc, writeBatch, query, where, setDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

import { saveSalesOrders, filterNewOrders, getLastImportedOrderDate, orderExists, saveSalesOrdersOptimized, getImportedOrderIdsWithDetails } from '@/services/order-service';
import type { SaleOrder } from '@/types/sale-order';


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

/**
 * Saves Bling API credentials securely in Firestore.
 * @param credentials - The credentials to save.
 */
export async function saveBlingCredentials(credentials: Partial<BlingCredentials>): Promise<void> {
    try {
        await setDoc(credentialsDocRef, credentials, { merge: true });
    } catch (error) {
        console.error("Error saving Bling credentials to Firestore:", error);
        throw new Error("Failed to save credentials to the database.");
    }
}

/**
 * Retrieves Bling API credentials from Firestore.
 * Client Secret is masked for security.
 * @returns The saved credentials.
 */
export async function getBlingCredentials(): Promise<Partial<BlingCredentials>> {
    try {
        const docSnap = await getDoc(credentialsDocRef);
        if (docSnap.exists()) {
            const data = docSnap.data() as BlingCredentials;
            // Mask client secret when sending to the client
            if (data.clientSecret) {
                data.clientSecret = '********';
            }
            return data;
        }
        // Also check environment variables as a fallback for initial setup
        const envClientId = process.env.BLING_CLIENT_ID;
        if (envClientId) {
            return { clientId: envClientId };
        }
        return {};
    } catch (error) {
        console.error("Error getting Bling credentials from Firestore:", error);
        return {};
    }
}


/**
 * Fetches all Bling credentials, including secrets, for server-side use.
 * @returns The complete credentials object.
 */
async function getFullBlingCredentials(): Promise<BlingCredentials> {
    try {
        const docSnap = await getDoc(credentialsDocRef);
        const savedCreds = docSnap.exists() ? docSnap.data() as BlingCredentials : {};
        
        // MUDANÇA: Priorizar credenciais do Firestore, usar ENV como fallback
        return {
            clientId: savedCreds.clientId || process.env.BLING_CLIENT_ID,
            clientSecret: savedCreds.clientSecret || process.env.BLING_CLIENT_SECRET,
            accessToken: savedCreds.accessToken,
            refreshToken: savedCreds.refreshToken,
            expiresAt: savedCreds.expiresAt,
        };
    } catch (error) {
        console.error("Error getting full Bling credentials:", error);
        throw new Error("Could not retrieve server-side credentials.");
    }
}


async function refreshAccessToken() {
  const creds = await getFullBlingCredentials();
  
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
      throw new Error("Credenciais do Bling incompletas para renovar o token.");
  }

  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: creds.refreshToken,
  });

  const res = await fetch("https://www.bling.com.br/Api/v3/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basic}`,
      "Accept": "1.0",
    },
    body: body.toString(),
    cache: "no-store",
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Refresh falhou (${res.status}): ${json?.error?.description || res.statusText}`);
  }

  const newCredentials: Partial<BlingCredentials> = {};
  if (json.access_token) newCredentials.accessToken = json.access_token;
  if (json.refresh_token) newCredentials.refreshToken = json.refresh_token;
  if (json.expires_in) {
    newCredentials.expiresAt = Date.now() + (Number(json.expires_in) * 1000);
  }
  
  await saveBlingCredentials(newCredentials);

  return {
      ...creds,
      ...newCredentials
  };
}

async function blingFetchWithRefresh(url: string, init?: RequestInit): Promise<any> {
    let creds = await getFullBlingCredentials();
    let accessToken = creds.accessToken;

    if (!accessToken) {
        throw new Error('Access Token do Bling não encontrado. Por favor, conecte sua conta primeiro.');
    }
    
    const isTokenExpired = creds.expiresAt ? Date.now() > creds.expiresAt : false;
    if(isTokenExpired) {
        console.log("Token de acesso possivelmente expirado pela data. Tentando renovar...");
        creds = await refreshAccessToken();
        accessToken = creds.accessToken;
    }

    const doCall = async (token: string) => {
        const res = await fetch(url, {
            ...init,
            headers: {
                "Accept": "application/json",
                "Authorization": `Bearer ${token}`,
                ...(init?.headers || {}),
            },
            cache: "no-store",
        });
        return { res, text: await res.text() };
    };

    let { res, text } = await doCall(accessToken!);

    if (res.status === 401) {
        console.log("Token de acesso expirado (401). Tentando renovar...");
        creds = await refreshAccessToken();
        accessToken = creds.accessToken;
        ({ res, text } = await doCall(accessToken!));
    }

    if (!res.ok) {
        let payload: any;
        try { payload = JSON.parse(text); } catch {}
        const msg = payload?.error?.description || res.statusText || text;
        throw new Error(`Erro do Bling (${res.status}): ${msg}`);
    }

    try {
        return text ? JSON.parse(text) : null;
    } catch (e) {
        console.error("Failed to parse Bling API response as JSON:", text);
        throw new Error("A resposta da API do Bling não era um JSON válido.");
    }
}

async function blingGetPaged(baseUrl: string) {
    const allData: any[] = [];
    let page = 1;
    const limit = 100; 

    while (true) {
        const url = new URL(baseUrl);
        url.searchParams.set('pagina', String(page));
        url.searchParams.set('limite', String(limit));

        const responseData = await blingFetchWithRefresh(url.toString());
        
        const dataOnPage = responseData.data || [];
        allData.push(...dataOnPage);

        if (dataOnPage.length < limit) {
            break;
        }
        page++;
    }
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
    const credentials = await getFullBlingCredentials();
    
    if (!credentials.accessToken) {
        throw new Error('Token de acesso não encontrado. Faça a conexão com o Bling primeiro.');
    }

    let queryFrom = from;
    let queryTo = to;

    if (useIntelligentDates && !forceFullSync && !from) {
        const lastImportDate = await getLastImportedOrderDate();
        if (lastImportDate) {
            queryFrom = lastImportDate;
            console.log(`🔄 Sincronização incremental a partir de: ${queryFrom.toISOString()}`);
        } else {
            queryFrom = new Date();
            queryFrom.setDate(queryFrom.getDate() - 30);
            console.log(`🆕 Primeira importação - últimos 30 dias a partir de: ${queryFrom.toISOString()}`);
        }
    }

    if(!queryFrom) {
      queryFrom = new Date();
      queryFrom.setDate(queryFrom.getDate() - 30);
    }
    if (!queryTo) {
        queryTo = new Date();
    }

    const formatDate = (date: Date) => date.toISOString().split('T')[0];
    const baseUrl = `https://api.bling.com.br/Api/v3/pedidos/vendas?dataInicial=${formatDate(queryFrom)}&dataFinal=${formatDate(queryTo)}`;
    
    try {
        console.log(`📥 Buscando pedidos de ${formatDate(queryFrom)} a ${formatDate(queryTo)}`);
        
        const allOrders = await blingGetPaged(baseUrl);

        if (allOrders.length === 0) {
            console.log('📭 Nenhum pedido encontrado no período');
            return { 
                data: [], 
                summary: { total: 0, new: 0, existing: 0, processed: 0, created: 0, updated: 0 } 
            };
        }

        const ordersToProcess = await filterNewOrders(allOrders);


        if (ordersToProcess.length === 0 && !forceFullSync) {
            console.log('✅ Todos os pedidos já estão atualizados no banco');
            return { 
                data: allOrders, 
                summary: { total: allOrders.length, new: 0, existing: allOrders.length, processed: 0, created: 0, updated: 0 } 
            };
        }
        
        const logMessage = forceFullSync 
            ? `🔄 Sincronização completa: re-processando detalhes para ${allOrders.length} pedidos...`
            : `🔍 Buscando detalhes completos para ${ordersToProcess.length} pedidos novos ou incompletos...`;
        console.log(logMessage);
        
        const ordersWithDetails = [];
        let processedCount = 0;

        for (const order of ordersToProcess) {
            try {
                const detailsData = await blingFetchWithRefresh(`https://api.bling.com.br/Api/v3/pedidos/vendas/${order.id}`);
                if (detailsData && detailsData.data) {
                    ordersWithDetails.push(detailsData.data);
                    processedCount++;
                } else {
                    ordersWithDetails.push(order);
                }
            } catch (error) {
                console.warn(`⚠️ Erro ao processar pedido ${order.id}:`, error);
                ordersWithDetails.push(order);
            }
        }

        const saveResult = await saveSalesOrdersOptimized(ordersWithDetails);

        console.log(`✅ Importação concluída: ${saveResult.created} novos, ${saveResult.updated} atualizados`);

        return {
            data: ordersWithDetails,
            summary: {
                total: allOrders.length,
                new: ordersToProcess.length,
                existing: allOrders.length - ordersToProcess.length,
                processed: processedCount,
                saved: saveResult.count,
                created: saveResult.created,
                updated: saveResult.updated
            }
        };

    } catch (error: any) {
        console.error('Erro na importação otimizada:', error);
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

export async function getProductsStock(): Promise<{ data: ProductStock[], isSimulated?: boolean }> {
    console.log('🚀 INICIANDO BUSCA DE ESTOQUE');
    try {
        const stockUrl = 'https://api.bling.com.br/Api/v3/produtos';
        console.log('🔍 Tentando endpoint:', stockUrl);
        
        const stockData = await blingGetPaged(stockUrl);
        console.log('📦 Dados recebidos do estoque:', stockData?.length || 0, 'itens');
        
        if (stockData && stockData.length > 0) {
            console.log('✅ SUCESSO: DADOS REAIS DE ESTOQUE');
            
            const formattedData: ProductStock[] = stockData.map((item: any) => ({
                produto: {
                    id: item.id || 0,
                    codigo: item.codigo || `PROD-${item.id}`,
                    nome: item.nome || 'Produto sem nome',
                },
                deposito: {
                    id: item.deposito?.id || 0,
                    nome: item.deposito?.nome || 'Depósito padrão',
                },
                saldoFisico: item.estoque?.saldoFisico || 0,
                saldoVirtual: item.estoque?.saldoVirtualTotal || 0,
                saldoFisicoTotal: item.estoque?.saldoFisicoTotal || item.estoque?.saldoFisico || 0,
                saldoVirtualTotal: item.estoque?.saldoVirtualTotal || item.estoque?.saldoVirtual || 0,
            }));
            
            return { data: formattedData, isSimulated: false };
        }
    } catch (error: any) {
        console.log('❌ Erro no endpoint de estoque:', error.message);
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

  const q = query(salesCollection);
  
  const snapshot = await getDocs(q);

  const orders: SaleOrder[] = [];
  snapshot.forEach(doc => {
    const order = doc.data() as SaleOrder;
    if (order.data >= fromDateStr && order.data <= toDateStr) {
      if(order.itens && order.itens.length > 0) {
        orders.push(order);
      }
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
};

export async function getProductionDemand(
    { from, to }: { from?: Date, to?: Date }
): Promise<ProductionDemand[]> {
    if (!from || !to) {
        return [];
    }

    const salesCollection = collection(db, 'salesOrders');
    
    const q = query(salesCollection, where('notaFiscal.id', '!=', null));
    const snapshot = await getDocs(q);

    const fromDateStr = format(from, 'yyyy-MM-dd');
    const toDateStr = format(to, 'yyyy-MM-dd');
    
    const days = differenceInDays(to, from) + 1;
    const weeks = Math.max(1, days / 7);

    const productDemand = new Map<string, { 
        description: string, 
        orderIds: Set<number>,
        totalQuantity: number 
    }>();

    snapshot.forEach(doc => {
        const order = doc.data() as SaleOrder;
        
        const isDateInRange = order.data >= fromDateStr && order.data <= toDateStr;

        if (isDateInRange && order.notaFiscal && order.notaFiscal.id) {
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
        }
    });

    const result = Array.from(productDemand.entries())
        .map(([sku, data]) => {
            const orderCount = data.orderIds.size;
            return {
                sku,
                description: data.description,
                orderCount: orderCount,
                totalQuantitySold: data.totalQuantity,
                weeklyAverage: orderCount / weeks,
            };
        })
        .sort((a, b) => b.orderCount - a.orderCount);

    return result;
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
    

    

    

    
