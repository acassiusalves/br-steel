
"use server";

import { db } from '@/lib/firebase';
import { collection, addDoc, query, orderBy } from 'firebase/firestore';
import type { Supply } from '@/types/supply';

const suppliesCollection = collection('supplies');

/**
 * Adiciona um novo insumo ao banco de dados.
 * @param supplyData - Os dados do insumo a serem salvos.
 * @returns O ID do documento recém-criado.
 */
export async function addSupply(supplyData: Omit<Supply, 'id'>) {
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
 * Retorna uma consulta para buscar todos os insumos, ordenados por nome.
 * @returns Uma consulta do Firestore.
 */
export function getSupplies() {
    return query(suppliesCollection, orderBy('produto.nome', 'asc'));
}

    