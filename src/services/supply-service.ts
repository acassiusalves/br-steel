
"use server";

import { db } from '@/lib/firebase';
import { collection, addDoc } from 'firebase/firestore';
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
