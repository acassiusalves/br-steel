
"use server";

import { db } from '@/lib/firebase';
import { collection, writeBatch, doc, query, where, getDocs, getDoc } from 'firebase/firestore';

/**
 * Verifica quais pedidos já existem no banco de dados
 * @param orderIds - Array de IDs dos pedidos para verificar
 * @returns Array de IDs que já existem no banco
 */
export async function getExistingOrderIds(orderIds: string[]): Promise<string[]> {
    if (!orderIds || orderIds.length === 0) {
        return [];
    }

    const existingIds: string[] = [];
    const ordersCollection = collection(db, 'salesOrders');

    // Firebase tem limite de 30 itens por consulta "in", então dividimos em lotes
    const batchSize = 30;
    for (let i = 0; i < orderIds.length; i += batchSize) {
        const batch = orderIds.slice(i, i + batchSize);
        if(batch.length > 0) {
            const q = query(ordersCollection, where('id', 'in', batch.map(id => parseInt(id, 10))));
            const querySnapshot = await getDocs(q);
            
            querySnapshot.forEach((doc) => {
                existingIds.push(String(doc.data().id));
            });
        }
    }

    return existingIds;
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
 * Filtra pedidos removendo aqueles que já existem no banco
 * @param orders - Array de pedidos básicos do Bling
 * @returns Array apenas com pedidos novos
 */
export async function filterNewOrders(orders: any[]): Promise<any[]> {
    if (!orders || orders.length === 0) {
        return [];
    }

    const orderIds = orders.map(order => String(order.id));
    const existingIdsSet = new Set(await getExistingOrderIds(orderIds));
    
    console.log(`📊 Total de pedidos encontrados: ${orders.length}`);
    console.log(`📋 Pedidos já existentes: ${existingIdsSet.size}`);
    
    const newOrders = orders.filter(order => 
        !existingIdsSet.has(String(order.id))
    );
    
    console.log(`✨ Pedidos novos para importar: ${newOrders.length}`);
    
    return newOrders;
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
    const existingIds = new Set(await getExistingOrderIds(orderIds));

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
