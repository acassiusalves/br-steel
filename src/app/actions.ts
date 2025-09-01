
"use server";

import * as fs from 'fs/promises';
import * as path from 'path';
import { format, parseISO, startOfMonth, endOfMonth, eachMonthOfInterval, getMonth, getYear, differenceInDays } from 'date-fns';
import { collection, getDocs, doc, writeBatch, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';

import { saveSalesOrders } from '@/services/order-service';
import type { SaleOrder } from '@/types/sale-order';


// Bling API actions
type BlingCredentials = {
    clientId: string;
    clientSecret: string;
    accessToken?: string;
    refreshToken?: string;
};

const envPath = path.resolve(process.cwd(), '.env');

async function readEnvFile(): Promise<Map<string, string>> {
    try {
        const content = await fs.readFile(envPath, 'utf-8');
        const map = new Map<string, string>();
        content.split('\n').forEach(line => {
            if (line.trim() && !line.startsWith('#')) {
                const [key, ...valueParts] = line.split('=');
                if (key) {
                    map.set(key.trim(), valueParts.join('=').trim());
                }
            }
        });
        return map;
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return new Map(); // File doesn't exist yet
        }
        throw error;
    }
}

async function writeEnvFile(envMap: Map<string, string>): Promise<void> {
    let content = '';
    for (const [key, value] of envMap.entries()) {
        content += `${key}=${value}\n`;
    }
    await fs.writeFile(envPath, content, 'utf-8');
}


export async function saveBlingCredentials(credentials: Partial<BlingCredentials>): Promise<void> {
    const envMap = await readEnvFile();

    // The 'any' cast is a simple way to handle dynamic keys.
    const credentialKeys: (keyof BlingCredentials)[] = ['clientId', 'clientSecret', 'accessToken', 'refreshToken'];
    const envKeys: { [key in keyof BlingCredentials]: string } = {
        clientId: 'BLING_CLIENT_ID',
        clientSecret: 'BLING_CLIENT_SECRET',
        accessToken: 'BLING_ACCESS_TOKEN',
        refreshToken: 'BLING_REFRESH_TOKEN',
    }

    for (const key of credentialKeys) {
        const envVar = envKeys[key];
        const value = credentials[key];

        if (value !== undefined) {
             if (value) {
                envMap.set(envVar, value);
            } else {
                envMap.delete(envVar);
            }
        }
    }
    
    await writeEnvFile(envMap);
}

export async function getBlingCredentials(): Promise<Partial<BlingCredentials>> {
    const envMap = await readEnvFile();
    return {
        clientId: envMap.get('BLING_CLIENT_ID') || '',
        clientSecret: envMap.get('BLING_CLIENT_SECRET') ? '********' : '', // Don't expose secret to client
        accessToken: envMap.get('BLING_ACCESS_TOKEN') || '', // Return the actual token for server actions
    };
}

// Função auxiliar para chamadas GET genéricas ao Bling
async function blingGet(url: string, token: string) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store', // Evita cache para dados que podem mudar
  });

  const data = await response.json();

  if (!response.ok) {
    const errorMessage = data?.error?.description || response.statusText;
    throw new Error(`Erro do Bling (${response.status}): ${errorMessage}`);
  }
  return data;
}

// Função auxiliar para chamadas GET paginadas ao Bling
async function blingGetPaged(baseUrl: string, token: string) {
    const allData: any[] = [];
    let page = 1;
    const limit = 100; // Bling's max limit

    while (true) {
        const url = new URL(baseUrl);
        url.searchParams.set('pagina', String(page));
        url.searchParams.set('limite', String(limit));

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        });

        const responseData = await response.json();

        if (!response.ok) {
            throw new Error(`Erro do Bling: ${responseData.error.description || response.statusText}`);
        }

        const dataOnPage = responseData.data || [];
        allData.push(...dataOnPage);

        if (dataOnPage.length < limit) {
            break;
        }
        page++;
    }
    return allData;
}


export async function getBlingSalesOrders({ from, to }: { from?: Date, to?: Date } = {}): Promise<any> {
    const envMap = await readEnvFile();
    const accessToken = envMap.get('BLING_ACCESS_TOKEN');

    if (!accessToken) {
        throw new Error('Access Token do Bling não encontrado. Por favor, conecte sua conta primeiro.');
    }
    
    const baseUrl = new URL('https://api.bling.com.br/Api/v3/pedidos/vendas');
    if (from) baseUrl.searchParams.set('dataInicial', format(from, 'yyyy-MM-dd'));
    if (to) baseUrl.searchParams.set('dataFinal', format(to, 'yyyy-MM-dd'));
    
    try {
        const allOrders = await blingGetPaged(baseUrl.toString(), accessToken);

        if (allOrders.length > 0) {
            const { count } = await saveSalesOrders(allOrders);
            console.log(`${count} orders processed and saved.`);
        }
        
        return { data: allOrders, firestore: { savedCount: allOrders.length } };

    } catch (error: any) {
        console.error('Falha ao buscar pedidos no Bling:', error);
        throw new Error(`Falha na comunicação com a API do Bling: ${error.message}`);
    }
}


export async function getBlingOrderDetails(orderId: string): Promise<any> {
    if (!orderId) {
        throw new Error('O ID do pedido é obrigatório.');
    }

    const envMap = await readEnvFile();
    const accessToken = envMap.get('BLING_ACCESS_TOKEN');

    if (!accessToken) {
        throw new Error('Access Token do Bling não encontrado. Por favor, conecte sua conta primeiro.');
    }

    const url = `https://api.bling.com.br/Api/v3/pedidos/vendas/${orderId}`;

    try {
        const data = await blingGet(url, accessToken);
        
        // Se a busca for bem-sucedida, salva os detalhes no Firestore
        if (data && data.data) {
           await saveSalesOrders([data.data]); // Reutiliza a função para salvar com merge
        }

        return data;

    } catch (error: any) {
        console.error(`Falha ao buscar detalhes do pedido ${orderId}:`, error);
        throw new Error(`Falha na comunicação com a API do Bling: ${error.message}`);
    }
}


export async function getLogisticsBySalesOrder(orderId: string): Promise<any> {
    if (!orderId) {
        throw new Error('O ID do pedido de venda é obrigatório.');
    }

    const envMap = await readEnvFile();
    const accessToken = envMap.get('BLING_ACCESS_TOKEN');

    if (!accessToken) {
        throw new Error('Access Token do Bling não encontrado. Por favor, conecte sua conta primeiro.');
    }

    try {
        // Passo 1: Buscar o pedido de venda para obter o ID da nota fiscal.
        const orderDetails = await blingGet(`https://api.bling.com.br/Api/v3/pedidos/vendas/${orderId}`, accessToken);
        const invoiceId = orderDetails?.data?.notaFiscal?.id;

        if (!invoiceId) {
            throw new Error('Nota Fiscal não encontrada para este pedido. Não é possível rastrear.');
        }

        // Passo 2: Buscar a remessa de logística usando o ID da nota fiscal.
        // A API de remessas permite filtrar pelo ID do documento (que é a nota fiscal).
        const shippingManifests = await blingGet(`https://api.bling.com.br/Api/v3/logisticas/remessas?idsDocumentos[]=${invoiceId}`, accessToken);
        const shippingObjects = shippingManifests?.data?.[0]?.objetos;

        if (!shippingObjects || shippingObjects.length === 0) {
            throw new Error('Nenhum objeto de logística encontrado para a nota fiscal deste pedido.');
        }
        
        // Assumimos que queremos o primeiro objeto de logística da remessa
        const logisticsObjectId = shippingObjects[0]?.id;

        if (!logisticsObjectId) {
            throw new Error('ID do objeto de logística não encontrado na remessa.');
        }

        // Passo 3: Com o ID do objeto de logística, buscar os detalhes do rastreio.
        const logisticsDetails = await blingGet(`https://api.bling.com.br/Api/v3/logisticas/objetos/${logisticsObjectId}`, accessToken);
        
        return logisticsDetails;

    } catch (error: any) {
        console.error(`Falha na cadeia de busca de logística para o pedido ${orderId}:`, error);
        // Retorna a mensagem de erro original para o cliente
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

// Função adicional para ser usada como fallback - adicione também no actions.ts

export async function getProductsStockWithFallback(): Promise<{ data: ProductStock[], isSimulated: boolean }> {
    const envMap = await readEnvFile();
    const accessToken = envMap.get('BLING_ACCESS_TOKEN');

    if (!accessToken) {
        throw new Error('Access Token do Bling não encontrado. Por favor, conecte sua conta primeiro.');
    }

    // Lista de endpoints para tentar, em ordem de preferência
    const stockEndpoints = [
        'https://api.bling.com.br/Api/v3/estoques',
        'https://api.bling.com.br/Api/v3/estoques/saldos',
        'https://api.bling.com.br/Api/v3/produtos/estoques'
    ];

    // Tentar buscar estoque via endpoints específicos
    for (const endpoint of stockEndpoints) {
        try {
            console.log(`Tentando endpoint: ${endpoint}`);
            const response = await fetch(endpoint, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json',
                },
            });

            if (response.ok) {
                const data = await response.json();
                if (data.data && Array.isArray(data.data) && data.data.length > 0) {
                    const formattedData: ProductStock[] = data.data.map((item: any) => ({
                        produto: {
                            id: item.produto?.id || item.id || 0,
                            codigo: item.produto?.codigo || item.codigo || `PROD-${item.produto?.id || item.id}`,
                            nome: item.produto?.nome || item.nome || 'Produto sem nome',
                        },
                        deposito: {
                            id: item.deposito?.id || 1,
                            nome: item.deposito?.nome || 'Depósito Principal',
                        },
                        saldoFisico: item.saldoFisico || 0,
                        saldoVirtual: item.saldoVirtual || 0,
                        saldoFisicoTotal: item.saldoFisicoTotal || item.saldoFisico || 0,
                        saldoVirtualTotal: item.saldoVirtualTotal || item.saldoVirtual || 0,
                    }));
                    
                    console.log(`✅ Sucesso com ${endpoint}: ${formattedData.length} produtos encontrados`);
                    return { data: formattedData, isSimulated: false };
                }
            } else {
                console.log(`❌ Endpoint ${endpoint} retornou status ${response.status}`);
            }
        } catch (error: any) {
            console.log(`❌ Erro no endpoint ${endpoint}:`, error.message);
        }
    }

    // Fallback: Buscar produtos e criar dados de estoque simulados
    try {
        console.log('🔄 Usando fallback: buscando lista de produtos...');
        const productsData = await blingGetPaged('https://api.bling.com.br/Api/v3/produtos', accessToken);
        
        if (productsData && productsData.length > 0) {
            // Criar dados de estoque baseados nos produtos reais
            const fallbackStockData: ProductStock[] = productsData
                .slice(0, 25) // Limitar para performance
                .map((product: any, index: number) => {
                    // Gerar valores de estoque mais realistas
                    const baseStock = Math.floor(Math.random() * 100);
                    const variance = Math.floor(Math.random() * 20) - 10; // -10 a +10
                    const fisico = Math.max(0, baseStock + variance);
                    const virtual = Math.max(0, fisico - Math.floor(Math.random() * 5)); // Virtual <= físico
                    
                    return {
                        produto: {
                            id: product.id,
                            codigo: product.codigo || `SKU-${String(index + 1).padStart(3, '0')}`,
                            nome: product.nome || `Produto ${index + 1}`,
                        },
                        deposito: {
                            id: 1,
                            nome: 'Depósito Principal',
                        },
                        saldoFisico: fisico,
                        saldoVirtual: virtual,
                        saldoFisicoTotal: fisico,
                        saldoVirtualTotal: virtual,
                    };
                });
            
            console.log(`🎯 Fallback bem-sucedido: ${fallbackStockData.length} produtos com estoque simulado`);
            return { data: fallbackStockData, isSimulated: true };
        }
    } catch (fallbackError: any) {
        console.error('❌ Fallback também falhou:', fallbackError.message);
    }

    // Último recurso: dados completamente simulados
    console.log('🎲 Usando dados de exemplo...');
    const exampleData: ProductStock[] = [
        {
            produto: { id: 1, codigo: 'EXEMPLO-001', nome: 'Produto de Exemplo 1' },
            deposito: { id: 1, nome: 'Depósito Principal' },
            saldoFisico: 25, saldoVirtual: 23, saldoFisicoTotal: 25, saldoVirtualTotal: 23
        },
        {
            produto: { id: 2, codigo: 'EXEMPLO-002', nome: 'Produto de Exemplo 2' },
            deposito: { id: 1, nome: 'Depósito Principal' },
            saldoFisico: 5, saldoVirtual: 3, saldoFisicoTotal: 5, saldoVirtualTotal: 3
        },
        {
            produto: { id: 3, codigo: 'EXEMPLO-003', nome: 'Produto de Exemplo 3' },
            deposito: { id: 1, nome: 'Depósito Principal' },
            saldoFisico: 0, saldoVirtual: 0, saldoFisicoTotal: 0, saldoVirtualTotal: 0
        }
    ];

    return { data: exampleData, isSimulated: true };
}

// Atualizar a função principal para usar o fallback
export async function getProductsStock(): Promise<{ data: ProductStock[], isSimulated?: boolean }> {
    try {
        const result = await getProductsStockWithFallback();
        
        if (result.isSimulated) {
            console.warn('⚠️ Usando dados simulados - A API de estoque do Bling pode não estar disponível para sua conta');
        }
        
        return { data: result.data, isSimulated: result.isSimulated };
    } catch (error: any) {
        console.error('Erro ao buscar dados de estoque:', error);
        throw new Error(`Erro ao buscar estoque: ${error.message}`);
    }
}


export async function countImportedOrders(): Promise<number> {
    try {
        const ordersCollection = collection(db, 'salesOrders');
        const snapshot = await getDocs(ordersCollection);
        return snapshot.size;
    } catch (error) {
        console.error("Failed to count imported orders:", error);
        return 0; // Return 0 if there's an error
    }
}

export async function getImportedOrderIds(): Promise<Set<string>> {
  try {
    const ordersCollection = collection(db, 'salesOrders');
    // For performance, we only need the document IDs, not the full data.
    const q = query(ordersCollection);
    const snapshot = await getDocs(q);
    const ids = new Set<string>();
    snapshot.forEach(doc => {
      // We only add IDs of orders that have been enriched (have 'itens').
      if (doc.data().itens) {
        ids.add(doc.id);
      }
    });
    return ids;
  } catch (error) {
    console.error("Failed to get imported order IDs:", error);
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

  // Firestore can't compare dates as strings directly with inequality.
  // The query will fetch all documents and filtering will be done in memory.
  // For larger datasets, this is inefficient and should be optimized by
  // storing dates as Firestore Timestamps. For this app's scope, it's acceptable.
  const q = query(salesCollection);
  
  const snapshot = await getDocs(q);

  const orders: SaleOrder[] = [];
  snapshot.forEach(doc => {
    const order = doc.data() as SaleOrder;
    // Manual date filtering
    if (order.data >= fromDateStr && order.data <= toDateStr) {
      // We only consider orders that have been enriched (have items)
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

  // Product sales ranking calculation
  const productSales = new Map<string, { total: number, revenue: number }>();

  orders.forEach(order => {
      order.itens?.forEach(item => {
          const productName = item.descricao || 'Produto sem nome';
          const currentData = productSales.get(productName) || { total: 0, revenue: 0 };
          currentData.total += item.quantidade;
          currentData.revenue += item.quantidade * item.valor;
          productSales.set(productName, currentData);
      });
  });

  const topProducts = Array.from(productSales.entries())
      .map(([name, data]) => ({ name, total: data.total, revenue: data.revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  

  // Mocking percentage changes for now as calculating them requires
  // fetching data from the previous period.
  const mockChange = () => parseFloat((Math.random() * 40 - 10).toFixed(1)); // Random change between -10% and +30%

  return {
    totalRevenue,
    totalSales,
    averageTicket,
    uniqueCustomers,
    topProducts,
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
  quantity: number;
  weeklyAverage: number;
};

export async function getProductionDemand(
    { from, to }: { from?: Date, to?: Date }
): Promise<ProductionDemand[]> {
    if (!from || !to) {
        return [];
    }

    const salesCollection = collection(db, 'salesOrders');
    
    // Base query: filter for orders that have an issued invoice
    const q = query(salesCollection, where('notaFiscal.id', '!=', null));
    const snapshot = await getDocs(q);

    const fromDateStr = format(from, 'yyyy-MM-dd');
    const toDateStr = format(to, 'yyyy-MM-dd');
    
    // Calculate the number of weeks in the period. Minimum 1 to avoid division by zero.
    const days = differenceInDays(to, from) + 1;
    const weeks = Math.max(1, days / 7);

    const productDemand = new Map<string, { description: string, quantity: number }>();

    snapshot.forEach(doc => {
        const order = doc.data() as SaleOrder;
        
        // Manual date filtering, as we can't combine `!=` with range filters in Firestore.
        const isDateInRange = order.data >= fromDateStr && order.data <= toDateStr;

        if (isDateInRange && order.notaFiscal && order.notaFiscal.id) {
            order.itens?.forEach(item => {
                const sku = item.codigo || 'SKU_INDEFINIDO';
                const currentData = productDemand.get(sku) || { description: item.descricao, quantity: 0 };
                currentData.quantity += item.quantidade;
                productDemand.set(sku, currentData);
            });
        }
    });

    const result = Array.from(productDemand.entries())
        .map(([sku, data]) => ({
            sku,
            description: data.description,
            quantity: data.quantity,
            weeklyAverage: data.quantity / weeks,
        }))
        .sort((a, b) => b.quantity - a.quantity);

    return result;
}

    