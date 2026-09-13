
import 'server-only';

import { adminDb } from '@/lib/firebase-admin';
import { salesIngestRepository } from '@/server/persistence/sales-ingest';
import type { SourceOrder } from '@/server/persistence/sales-ingest-contract';
import { documentIdSchema, serialize } from '@/server/operations/common';


/**
 * Verifica quais pedidos já existem no banco de dados
 * @param orderIds - Array de IDs dos pedidos para verificar
 * @returns Array de IDs que já existem no banco
 */
export async function getExistingOrderIds(orderIds: (string|number)[]): Promise<Set<string>> {
    if (!orderIds || orderIds.length === 0) {
        return new Set();
    }

    const existingIds = new Set<string>();
    const ordersCollection = adminDb.collection('salesOrders');
    const numericOrderIds = orderIds.map(id => parseInt(String(id), 10)).filter(id => !isNaN(id));


    // Firebase tem limite de 30 itens por consulta "in", então dividimos em lotes
    const batchSize = 30;
    for (let i = 0; i < numericOrderIds.length; i += batchSize) {
        const batch = numericOrderIds.slice(i, i + batchSize);
        if(batch.length > 0) {
            const q = ordersCollection.where('id', 'in', batch);
            const querySnapshot = await q.get();
            
            querySnapshot.forEach((doc) => {
                existingIds.add(String(doc.data().id));
            });
        }
    }

    return existingIds;
}

/**
 * Obtém os IDs de todos os pedidos no Firestore que já possuem a propriedade `itens`.
 * @returns Um Set com os IDs dos pedidos que já têm detalhes.
 */
export async function getImportedOrderIdsWithDetails(options: {
    requireInvoiceDetails?: boolean;
    requireInvoiceXml?: boolean;
} = {}): Promise<Set<string>> {
    try {
        const ordersCollection = adminDb.collection('salesOrders');
        const q = ordersCollection; // Query for all documents
        const snapshot = await q.get();
        const ids = new Set<string>();
        snapshot.forEach(doc => {
            const orderData = doc.data();
            const hasItems = orderData.itens && Array.isArray(orderData.itens) && orderData.itens.length > 0;
            if (!hasItems) {
                return;
            }

            const invoiceId = Number(orderData.notaFiscal?.id || 0);
            const hasInvoice = Number.isFinite(invoiceId) && invoiceId > 0;
            const hasInvoiceDetails = Boolean(orderData.notaFiscal?.hasFiscalDetails);
            const hasInvoiceXml = Boolean(orderData.notaFiscal?.xmlAvailable);

            if (options.requireInvoiceXml && hasInvoice && !hasInvoiceXml) {
                return;
            }

            if (options.requireInvoiceDetails && hasInvoice && !hasInvoiceDetails) {
                return;
            }

            // Adiciona o ID se o campo 'itens' existir e as exigencias fiscais ja estiverem atendidas.
            if (hasItems) {
                ids.add(doc.id);
            }
        });
        return ids;
    } catch (error) {
        console.error("Failed to get imported order IDs with details:", error);
        return new Set();
    }
}


/**
 * Obtém a data do último pedido importado para otimizar as consultas
 * @returns Data do último pedido ou null se não houver pedidos
 */
export async function getLastImportedOrderDate(): Promise<Date | null> {
    try {
        const ordersCollection = adminDb.collection('salesOrders');
        // Esta consulta seria otimizada com um índice no campo 'data'
        const q = ordersCollection;
        const querySnapshot = await q.get();
        
        let lastDate: Date | null = null;
        
        querySnapshot.forEach((doc) => {
            const orderData = doc.data();
            if (orderData.data) {
                const orderDate = new Date(orderData.data + 'T00:00:00');
                if (!lastDate || orderDate > lastDate) {
                    lastDate = orderDate;
                }
            }
        });

        return lastDate;
    } catch (error) {
        console.error('Erro ao buscar última data de importação:', error);
        return null;
    }
}

/**
 * Filtra pedidos, retornando apenas aqueles que são novos ou que estão incompletos no banco.
 * @param orders - Array de pedidos básicos do Bling
 * @returns Array apenas com pedidos que precisam de atualização de detalhes.
 */
export async function filterNewOrders(orders: any[], options: {
    requireInvoiceDetails?: boolean;
    requireInvoiceXml?: boolean;
} = {}): Promise<any[]> {
    if (!orders || orders.length === 0) {
        return [];
    }

    const existingCompleteIdsSet = await getImportedOrderIdsWithDetails(options);
    
    console.log(`📊 Total de pedidos encontrados na API: ${orders.length}`);
    console.log(`📋 Pedidos já completos no banco: ${existingCompleteIdsSet.size}`);
    if (options.requireInvoiceDetails || options.requireInvoiceXml) {
        console.log(`📋 Critério fiscal: detalhes=${Boolean(options.requireInvoiceDetails)}, xml=${Boolean(options.requireInvoiceXml)}`);
    }
    
    const ordersToProcess = orders.filter(order => 
        !existingCompleteIdsSet.has(String(order.id))
    );
    
    console.log(`✨ Pedidos para processar (novos ou incompletos): ${ordersToProcess.length}`);
    
    return ordersToProcess;
}

/**
 * Salva pedidos em lote otimizado com verificação de duplicatas
 * Divide em lotes menores para evitar o erro "Transaction too big"
 * @param orders - Array de pedidos completos do Bling
 * @returns Resultado da operação
 */
export async function saveSalesOrdersOptimized(orders: any[]): Promise<{ count: number, updated: number, created: number }> {
    return salesIngestRepository.upsertOrders(orders as SourceOrder[]);
}

/**
 * Verifica se um pedido específico existe no banco
 * @param orderId - ID do pedido
 * @returns Boolean indicando se existe
 */
export async function orderExists(orderId: string): Promise<boolean> {
    try {
        const docRef = adminDb.collection('salesOrders').doc(documentIdSchema.parse(orderId));
        const docSnap = await docRef.get();
        return docSnap.exists;
    } catch (error) {
        console.error(`Erro ao verificar existência do pedido ${orderId}:`, error);
        return false;
    }
}

export async function saveSalesOrders(orders: any[]): Promise<{ count: number }> {
    const result = await saveSalesOrdersOptimized(orders);
    return { count: result.count };
}
