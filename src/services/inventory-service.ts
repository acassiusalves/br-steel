
"use server";

import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { Supply } from '@/types/supply';
import type { InventoryItem } from '@/types/inventory';

// Simulação de dados de estoque - em uma aplicação real, isso viria de outro lugar
// (por exemplo, uma coleção 'inventory' ou calculado a partir de entradas/saídas)
const getSimulatedStock = (supplyId: string): number => {
    // Gera um número aleatório baseado no ID para consistência
    const charCodeSum = supplyId.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return (charCodeSum % 150) - 20; // Gera valores entre -20 e 130
}


/**
 * Busca todos os insumos e agrega informações de inventário.
 * @returns Um array de itens de inventário com dados do insumo e estoque.
 */
export async function getInventory(): Promise<InventoryItem[]> {
    const suppliesCollection = collection(db, 'supplies');
    const q = query(suppliesCollection);

    try {
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) {
            return [];
        }

        const inventoryItems: InventoryItem[] = querySnapshot.docs.map(doc => {
            const supply = { id: doc.id, ...doc.data() } as Supply;
            
            // Lógica de estoque (atualmente simulada)
            const estoqueAtual = getSimulatedStock(supply.id);
            const valorEmEstoque = estoqueAtual > 0 ? estoqueAtual * supply.precoCusto : 0;

            return {
                supply: supply,
                estoqueAtual: estoqueAtual,
                estoqueMinimo: supply.estoqueMinimo,
                valorEmEstoque: valorEmEstoque,
                status: estoqueAtual <= 0 ? 'esgotado' : (estoqueAtual < supply.estoqueMinimo ? 'baixo' : 'em_estoque'),
            };
        });

        return inventoryItems;

    } catch (error) {
        console.error("Erro ao buscar inventário de insumos:", error);
        throw new Error("Não foi possível carregar os dados de estoque dos insumos.");
    }
}
