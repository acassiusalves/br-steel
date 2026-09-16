
import 'server-only';

import { salesIngestRepository } from '@/server/persistence/sales-ingest';
import { salesReadRepository } from '@/server/persistence/sales';
import type { SourceOrder } from '@/server/persistence/sales-ingest-contract';
import { documentIdSchema, serialize } from '@/server/operations/common';


/**
 * Verifica quais pedidos já existem no banco de dados
 * @param orderIds - Array de IDs dos pedidos para verificar
 * @returns Array de IDs que já existem no banco
 */
/**
 * Obtém os IDs de todos os pedidos no Firestore que já possuem a propriedade `itens`.
 * @returns Um Set com os IDs dos pedidos que já têm detalhes.
 */
export async function getImportedOrderIdsWithDetails(options: {
    requireInvoiceDetails?: boolean;
    requireInvoiceXml?: boolean;
} = {}): Promise<Set<string>> {
    try {
        return await salesReadRepository.importedOrderIds(options);
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
        const date = await salesReadRepository.lastOrderDate();
        return date ? new Date(`${date}T00:00:00`) : null;
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
export async function saveSalesOrders(orders: any[]): Promise<{ count: number }> {
    const result = await saveSalesOrdersOptimized(orders);
    return { count: result.count };
}
