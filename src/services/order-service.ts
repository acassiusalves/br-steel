
"use server";

import { db } from '@/lib/firebase';
import { collection, writeBatch, doc, query, where, getDocs, getDoc } from 'firebase/firestore';

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
    const ordersCollection = collection(db, 'salesOrders');
    const numericOrderIds = orderIds.map(id => parseInt(String(id), 10)).filter(id => !isNaN(id));


    // Firebase tem limite de 30 itens por consulta "in", então dividimos em lotes
    const batchSize = 30;
    for (let i = 0; i < numericOrderIds.length; i += batchSize) {
        const batch = numericOrderIds.slice(i, i + batchSize);
        if(batch.length > 0) {
            const q = query(ordersCollection, where('id', 'in', batch));
            const querySnapshot = await getDocs(q);
            
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
export async function getImportedOrderIdsWithDetails(): Promise<Set<string>> {
    try {
        const ordersCollection = collection(db, 'salesOrders');
        const q = query(ordersCollection); // Query for all documents
        const snapshot = await getDocs(q);
        const ids = new Set<string>();
        snapshot.forEach(doc => {
            // Adiciona o ID se o campo 'itens' existir e não for um array vazio
            if (doc.data().itens && Array.isArray(doc.data().itens) && doc.data().itens.length > 0) {
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
        const ordersCollection = collection(db, 'salesOrders');
        // Esta consulta seria otimizada com um índice no campo 'data'
        const q = query(ordersCollection);
        const querySnapshot = await getDocs(q);
        
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
export async function filterNewOrders(orders: any[]): Promise<any[]> {
    if (!orders || orders.length === 0) {
        return [];
    }

    const existingCompleteIdsSet = await getImportedOrderIdsWithDetails();
    
    console.log(`📊 Total de pedidos encontrados na API: ${orders.length}`);
    console.log(`📋 Pedidos já completos no banco: ${existingCompleteIdsSet.size}`);
    
    const ordersToProcess = orders.filter(order => 
        !existingCompleteIdsSet.has(String(order.id))
    );
    
    console.log(`✨ Pedidos para processar (novos ou incompletos): ${ordersToProcess.length}`);
    
    return ordersToProcess;
}

/**
 * Salva pedidos em lote otimizado com verificação de duplicatas
 * @param orders - Array de pedidos completos do Bling
 * @returns Resultado da operação
 */
export async function saveSalesOrdersOptimized(orders: any[]): Promise<{ count: number, updated: number, created: number }> {
    if (!orders || orders.length === 0) {
        return { count: 0, updated: 0, created: 0 };
    }

    const batch = writeBatch(db);
    const ordersCollection = collection(db, 'salesOrders');
    
    let updated = 0;
    let created = 0;

    const orderIds = orders.map(order => String(order.id));
    const existingIds = await getExistingOrderIds(orderIds);

    orders.forEach(order => {
        const docRef = doc(ordersCollection, String(order.id));
        const isUpdate = existingIds.has(String(order.id));
        
        const orderWithMetadata = {
            ...order,
            importedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            isImported: true
        };

        batch.set(docRef, orderWithMetadata, { merge: true });
        
        if (isUpdate) {
            updated++;
        } else {
            created++;
        }
    });

    await batch.commit();
    
    console.log(`✅ ${orders.length} pedidos processados: ${created} criados, ${updated} atualizados`);
    
    return { 
        count: orders.length, 
        updated, 
        created 
    };
}

/**
 * Verifica se um pedido específico existe no banco
 * @param orderId - ID do pedido
 * @returns Boolean indicando se existe
 */
export async function orderExists(orderId: string): Promise<boolean> {
    try {
        const docRef = doc(db, 'salesOrders', orderId);
        const docSnap = await getDoc(docRef);
        return docSnap.exists();
    } catch (error) {
        console.error(`Erro ao verificar existência do pedido ${orderId}:`, error);
        return false;
    }
}

export async function saveSalesOrders(orders: any[]): Promise<{ count: number }> {
    const result = await saveSalesOrdersOptimized(orders);
    return { count: result.count };
}

    