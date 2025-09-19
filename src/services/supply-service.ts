
"use server";

import { db } from '@/lib/firebase';
import { collection, addDoc, doc, updateDoc, deleteDoc, query, where, getDocs, writeBatch, setDoc, getDoc } from 'firebase/firestore';
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
 * O ID do documento será o próprio SKU.
 * @param sku - O SKU (código) do insumo a ser atualizado.
 * @param supplyData - Os novos dados para o insumo.
 */
export async function updateSupplyBySku(
  sku: string,
  data: { estoqueMinimo?: number; estoqueMaximo?: number }
) {
  if (!sku) throw new Error("SKU (código do produto) é obrigatório para atualização.");

  const ref = doc(db, "supplies", sku);
  
  const payload: any = {
    codigo: sku, // Garante que o código esteja sempre salvo
    updatedAt: new Date().toISOString(),
  };

  // Adiciona os campos de estoque apenas se eles forem números válidos,
  // para evitar apagar dados existentes com `undefined`.
  if (typeof data.estoqueMinimo === "number") {
    payload.estoqueMinimo = data.estoqueMinimo;
  }
  if (typeof data.estoqueMaximo === "number") {
    payload.estoqueMaximo = data.estoqueMaximo;
  }

  // Usa set com merge:true. Isso cria o documento se não existir
  // ou atualiza os campos sem apagar os outros.
  await setDoc(ref, payload, { merge: true });
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

