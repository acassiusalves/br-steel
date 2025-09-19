
"use server";

import { db } from '@/lib/firebase';
import { collection, addDoc, doc, updateDoc, deleteDoc, query, where, getDocs, writeBatch } from 'firebase/firestore';
import type { Supply } from '@/types/supply';

/**
 * Adiciona um novo insumo ao banco de dados.
 * @param supplyData - Os dados do insumo a serem salvos.
 * @returns O ID do documento recém-criado.
 */
export async function addSupply(supplyData: Omit<Supply, 'id' | 'estoqueAtual'>) {
    const suppliesCollection = collection(db, 'supplies');
    try {
        const docRef = await addDoc(suppliesCollection, {
            ...supplyData,
            estoqueAtual: 0, // Inicializa o estoque como 0
            createdAt: new Date().toISOString(),
        });
        return { id: docRef.id };
    } catch (error) {
        console.error("Erro ao adicionar insumo: ", error);
        throw new Error("Falha ao salvar o insumo no banco de dados.");
    }
}

/**
 * Atualiza um insumo existente no banco de dados.
 * @param id - O ID do insumo a ser atualizado.
 * @param supplyData - Os novos dados para o insumo.
 */
export async function updateSupply(id: string, supplyData: Partial<Omit<Supply, 'id' | 'createdAt' | 'estoqueAtual'>>) {
    const supplyDocRef = doc(db, 'supplies', id);
    try {
        await updateDoc(supplyDocRef, {
            ...supplyData,
            updatedAt: new Date().toISOString(),
        });
    } catch (error) {
        console.error("Erro ao atualizar insumo: ", error);
        throw new Error("Falha ao atualizar o insumo no banco de dados.");
    }
}

/**
 * Atualiza um insumo existente no banco de dados usando o SKU.
 * @param sku - O SKU (código) do insumo a ser atualizado.
 * @param supplyData - Os novos dados para o insumo.
 */
export async function updateSupplyBySku(sku: string, supplyData: Partial<Omit<Supply, 'id' | 'createdAt' | 'estoqueAtual' | 'codigo'>>) {
    const suppliesCollection = collection(db, 'supplies');
    const q = query(suppliesCollection, where("codigo", "==", sku));
    
    try {
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            console.warn(`Nenhum insumo encontrado com o SKU: ${sku}. Nenhuma atualização foi feita.`);
            return;
        }

        // Em um cenário ideal, o SKU é único. Se houver múltiplos, atualiza todos.
        const batch = writeBatch(db);
        querySnapshot.forEach(documentSnapshot => {
            const docRef = doc(db, 'supplies', documentSnapshot.id);
            batch.update(docRef, {
                ...supplyData,
                updatedAt: new Date().toISOString(),
            });
        });
        await batch.commit();

    } catch (error) {
        console.error(`Erro ao atualizar insumo com SKU ${sku}: `, error);
        throw new Error(`Falha ao atualizar o insumo com SKU ${sku} no banco de dados.`);
    }
}


/**
 * Apaga um insumo do banco de dados.
 * @param id - O ID do insumo a ser apagado.
 */
export async function deleteSupply(id: string) {
    const supplyDocRef = doc(db, 'supplies', id);
    try {
        await deleteDoc(supplyDocRef);
    } catch (error) {
        console.error("Erro ao apagar insumo: ", error);
        throw new Error("Falha ao apagar o insumo no banco de dados.");
    }
}
