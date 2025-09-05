
"use server";

import { db } from '@/lib/firebase';
import { collection, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import type { Supply } from '@/types/supply';

/**
 * Adiciona um novo insumo ao banco de dados.
 * @param supplyData - Os dados do insumo a serem salvos.
 * @returns O ID do documento recém-criado.
 */
export async function addSupply(supplyData: Omit<Supply, 'id'>) {
    const suppliesCollection = collection(db, 'supplies');
    try {
        const docRef = await addDoc(suppliesCollection, {
            ...supplyData,
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
export async function updateSupply(id: string, supplyData: Partial<Omit<Supply, 'id'>>) {
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
