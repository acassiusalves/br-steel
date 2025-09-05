
"use server";

import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, onSnapshot, Unsubscribe, runTransaction, doc, addDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import type { Supply } from '@/types/supply';
import type { InventoryItem, InventoryMovement } from '@/types/inventory';


/**
 * Busca todos os insumos e agrega informações de inventário em tempo real.
 * @param callback - Função a ser chamada com os dados atualizados.
 * @returns Uma função para cancelar a subscrição do listener do Firestore.
 */
export async function getInventory(callback: (data: InventoryItem[]) => void): Promise<Unsubscribe> {
    const suppliesCollection = collection(db, 'supplies');
    const q = query(suppliesCollection);

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
        if (querySnapshot.empty) {
            callback([]);
            return;
        }

        const inventoryItems: InventoryItem[] = querySnapshot.docs.map(doc => {
            const supply = { id: doc.id, ...doc.data() } as Supply;
            
            const estoqueAtual = supply.estoqueAtual || 0;
            const valorEmEstoque = estoqueAtual > 0 ? estoqueAtual * supply.precoCusto : 0;

            return {
                supply: supply,
                estoqueAtual: estoqueAtual,
                estoqueMinimo: supply.estoqueMinimo,
                valorEmEstoque: valorEmEstoque,
                status: estoqueAtual <= 0 ? 'esgotado' : (estoqueAtual < supply.estoqueMinimo ? 'baixo' : 'em_estoque'),
            };
        });

        callback(inventoryItems);

    }, (error) => {
        console.error("Erro ao buscar inventário de insumos:", error);
        throw new Error("Não foi possível carregar os dados de estoque dos insumos.");
    });
    
    return unsubscribe;
}


/**
 * Adiciona uma nova movimentação de estoque e atualiza o saldo do insumo.
 * @param movementData - Os dados da movimentação a ser registrada.
 */
export async function addInventoryMovement(movementData: Omit<InventoryMovement, 'id' | 'createdAt'>) {
    if (!movementData.supplyId) {
        throw new Error("O ID do insumo é obrigatório.");
    }
    
    const supplyDocRef = doc(db, 'supplies', movementData.supplyId);
    const movementsCollectionRef = collection(db, 'inventoryMovements');

    try {
        await runTransaction(db, async (transaction) => {
            const supplyDoc = await transaction.get(supplyDocRef);
            if (!supplyDoc.exists()) {
                throw new Error("Insumo não encontrado. Impossível registrar a movimentação.");
            }

            const currentSupply = supplyDoc.data() as Supply;
            const currentStock = currentSupply.estoqueAtual || 0;
            const quantityChange = movementData.quantity;

            let newStock;
            if (movementData.type === 'entrada') {
                newStock = currentStock + quantityChange;
            } else {
                newStock = currentStock - quantityChange;
                if (newStock < 0) {
                   console.warn(`Alerta: Estoque do insumo ${currentSupply.nome} ficou negativo (${newStock}).`);
                }
            }
            
            // 1. Atualiza o estoque no documento do insumo
            transaction.update(supplyDocRef, { estoqueAtual: newStock });

            // 2. Cria o registro da movimentação
            const newMovementRef = doc(movementsCollectionRef);
            transaction.set(newMovementRef, {
                ...movementData,
                createdAt: new Date().toISOString()
            });
        });
    } catch (error) {
        console.error("Erro na transação de movimentação de estoque: ", error);
        throw error;
    }
}
