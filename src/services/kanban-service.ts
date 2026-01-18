"use server";

import { db } from '@/lib/firebase';
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  getDocs,
  writeBatch,
  orderBy,
  getDoc,
  Timestamp,
} from 'firebase/firestore';
import type {
  ProductionColumn,
  ProductionLot,
  ProductionLotItem,
  ProductionComment,
  CreateColumnInput,
  UpdateColumnInput,
  CreateLotInput,
  UpdateLotInput,
  CreateCommentInput,
} from '@/types/kanban';

// ============================================
// COLUNAS (ProductionColumns)
// ============================================

export async function getColumns(): Promise<ProductionColumn[]> {
  try {
    const columnsRef = collection(db, 'productionColumns');
    const q = query(columnsRef, orderBy('order', 'asc'));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as ProductionColumn[];
  } catch (error) {
    console.error("Erro ao buscar colunas: ", error);
    throw new Error("Falha ao buscar colunas do Kanban.");
  }
}

export async function createColumn(data: CreateColumnInput): Promise<{ id: string }> {
  try {
    const columnsRef = collection(db, 'productionColumns');
    const now = new Date().toISOString();

    const docRef = await addDoc(columnsRef, {
      ...data,
      createdAt: now,
      updatedAt: now,
    });

    return { id: docRef.id };
  } catch (error) {
    console.error("Erro ao criar coluna: ", error);
    throw new Error("Falha ao criar coluna.");
  }
}

export async function updateColumn(id: string, data: UpdateColumnInput): Promise<void> {
  try {
    const columnRef = doc(db, 'productionColumns', id);
    await updateDoc(columnRef, {
      ...data,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Erro ao atualizar coluna: ", error);
    throw new Error("Falha ao atualizar coluna.");
  }
}

export async function deleteColumn(id: string): Promise<void> {
  try {
    // Verifica se há lotes nesta coluna
    const lotsRef = collection(db, 'productionLots');
    const q = query(lotsRef, where('columnId', '==', id));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      throw new Error("Não é possível excluir uma coluna que contém lotes. Mova os lotes primeiro.");
    }

    const columnRef = doc(db, 'productionColumns', id);
    await deleteDoc(columnRef);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    console.error("Erro ao excluir coluna: ", error);
    throw new Error("Falha ao excluir coluna.");
  }
}

export async function reorderColumns(columnOrders: { id: string; order: number }[]): Promise<void> {
  try {
    const batch = writeBatch(db);
    const now = new Date().toISOString();

    for (const { id, order } of columnOrders) {
      const columnRef = doc(db, 'productionColumns', id);
      batch.update(columnRef, { order, updatedAt: now });
    }

    await batch.commit();
  } catch (error) {
    console.error("Erro ao reordenar colunas: ", error);
    throw new Error("Falha ao reordenar colunas.");
  }
}

export async function seedDefaultColumns(): Promise<void> {
  try {
    const columns = await getColumns();

    if (columns.length > 0) {
      return; // Já existem colunas, não faz nada
    }

    const defaultColumns: CreateColumnInput[] = [
      { name: 'Fila', order: 0, color: '#6b7280' },
      { name: 'Em Produção', order: 1, color: '#f59e0b' },
      { name: 'Concluído', order: 2, color: '#22c55e' },
    ];

    const batch = writeBatch(db);
    const now = new Date().toISOString();

    for (const col of defaultColumns) {
      const newDocRef = doc(collection(db, 'productionColumns'));
      batch.set(newDocRef, {
        ...col,
        createdAt: now,
        updatedAt: now,
      });
    }

    await batch.commit();
  } catch (error) {
    console.error("Erro ao criar colunas padrão: ", error);
    throw new Error("Falha ao criar colunas padrão.");
  }
}

// ============================================
// LOTES (ProductionLots)
// ============================================

async function generateLotNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const lotsRef = collection(db, 'productionLots');
  const q = query(lotsRef, orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);

  let maxNumber = 0;
  snapshot.docs.forEach(doc => {
    const lotNumber = doc.data().lotNumber as string;
    if (lotNumber) {
      const match = lotNumber.match(/LOT-(\d{4})-(\d+)/);
      if (match && match[1] === year.toString()) {
        const num = parseInt(match[2], 10);
        if (num > maxNumber) maxNumber = num;
      }
    }
  });

  return `LOT-${year}-${String(maxNumber + 1).padStart(4, '0')}`;
}

export async function getLots(): Promise<ProductionLot[]> {
  try {
    const lotsRef = collection(db, 'productionLots');
    const q = query(lotsRef, orderBy('columnOrder', 'asc'));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as ProductionLot[];
  } catch (error) {
    console.error("Erro ao buscar lotes: ", error);
    throw new Error("Falha ao buscar lotes.");
  }
}

export async function getLotById(id: string): Promise<ProductionLot | null> {
  try {
    const lotRef = doc(db, 'productionLots', id);
    const snapshot = await getDoc(lotRef);

    if (!snapshot.exists()) {
      return null;
    }

    return {
      id: snapshot.id,
      ...snapshot.data(),
    } as ProductionLot;
  } catch (error) {
    console.error("Erro ao buscar lote: ", error);
    throw new Error("Falha ao buscar lote.");
  }
}

export async function createLot(data: CreateLotInput): Promise<{ id: string; lotNumber: string }> {
  try {
    const batch = writeBatch(db);
    const now = new Date().toISOString();
    const lotNumber = await generateLotNumber();

    // Calcula a próxima ordem na coluna
    const lotsRef = collection(db, 'productionLots');
    const q = query(lotsRef, where('columnId', '==', data.columnId));
    const snapshot = await getDocs(q);
    const maxOrder = snapshot.docs.reduce((max, doc) => {
      const order = doc.data().columnOrder || 0;
      return order > max ? order : max;
    }, -1);

    // Cria o lote
    const lotDocRef = doc(collection(db, 'productionLots'));
    const linkedOrderIds = [...new Set(data.items.map(item => item.sourceOrderId))];

    batch.set(lotDocRef, {
      lotNumber,
      title: data.title,
      description: data.description || null,
      columnId: data.columnId,
      columnOrder: maxOrder + 1,
      assignedTo: data.assignedTo || null,
      priority: data.priority,
      linkedOrderIds,
      totalItems: data.items.reduce<number>((sum, item) => sum + item.quantity, 0),
      totalSkus: new Set(data.items.map(item => item.sku)).size,
      dueDate: data.dueDate || null,
      createdAt: now,
      updatedAt: now,
      createdBy: data.createdBy,
    });

    // Cria os itens do lote
    for (const item of data.items) {
      const itemDocRef = doc(collection(db, 'productionLotItems'));
      batch.set(itemDocRef, {
        lotId: lotDocRef.id,
        sku: item.sku,
        productName: item.productName,
        quantity: item.quantity,
        unit: item.unit,
        sourceOrderId: item.sourceOrderId,
        sourceOrderNumber: item.sourceOrderNumber,
        customerName: item.customerName,
        createdAt: now,
      });
    }

    await batch.commit();

    return { id: lotDocRef.id, lotNumber };
  } catch (error) {
    console.error("Erro ao criar lote: ", error);
    throw new Error("Falha ao criar lote de produção.");
  }
}

export async function updateLot(id: string, data: UpdateLotInput): Promise<void> {
  try {
    const lotRef = doc(db, 'productionLots', id);

    // Remove campos undefined para não sobrescrever com null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {
      updatedAt: new Date().toISOString(),
    };

    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.columnId !== undefined) updateData.columnId = data.columnId;
    if (data.columnOrder !== undefined) updateData.columnOrder = data.columnOrder;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.assignedTo !== undefined) updateData.assignedTo = data.assignedTo;
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate;

    await updateDoc(lotRef, updateData);
  } catch (error) {
    console.error("Erro ao atualizar lote: ", error);
    throw new Error("Falha ao atualizar lote.");
  }
}

export async function moveLot(
  id: string,
  newColumnId: string,
  newOrder: number
): Promise<void> {
  try {
    const lotRef = doc(db, 'productionLots', id);
    await updateDoc(lotRef, {
      columnId: newColumnId,
      columnOrder: newOrder,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Erro ao mover lote: ", error);
    throw new Error("Falha ao mover lote.");
  }
}

export async function reorderLotsInColumn(
  columnId: string,
  lotOrders: { id: string; order: number }[]
): Promise<void> {
  try {
    const batch = writeBatch(db);
    const now = new Date().toISOString();

    for (const { id, order } of lotOrders) {
      const lotRef = doc(db, 'productionLots', id);
      batch.update(lotRef, { columnOrder: order, updatedAt: now });
    }

    await batch.commit();
  } catch (error) {
    console.error("Erro ao reordenar lotes: ", error);
    throw new Error("Falha ao reordenar lotes.");
  }
}

export async function deleteLot(id: string): Promise<void> {
  try {
    const batch = writeBatch(db);

    // Exclui todos os itens do lote
    const itemsRef = collection(db, 'productionLotItems');
    const itemsQuery = query(itemsRef, where('lotId', '==', id));
    const itemsSnapshot = await getDocs(itemsQuery);
    itemsSnapshot.docs.forEach(doc => batch.delete(doc.ref));

    // Exclui todos os comentários do lote
    const commentsRef = collection(db, 'productionComments');
    const commentsQuery = query(commentsRef, where('lotId', '==', id));
    const commentsSnapshot = await getDocs(commentsQuery);
    commentsSnapshot.docs.forEach(doc => batch.delete(doc.ref));

    // Exclui o lote
    const lotRef = doc(db, 'productionLots', id);
    batch.delete(lotRef);

    await batch.commit();
  } catch (error) {
    console.error("Erro ao excluir lote: ", error);
    throw new Error("Falha ao excluir lote.");
  }
}

// ============================================
// ITENS DO LOTE (ProductionLotItems)
// ============================================

export async function getLotItems(lotId: string): Promise<ProductionLotItem[]> {
  try {
    const itemsRef = collection(db, 'productionLotItems');
    const q = query(itemsRef, where('lotId', '==', lotId));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as ProductionLotItem[];
  } catch (error) {
    console.error("Erro ao buscar itens do lote: ", error);
    throw new Error("Falha ao buscar itens do lote.");
  }
}

// ============================================
// COMENTÁRIOS (ProductionComments)
// ============================================

export async function getComments(lotId: string): Promise<ProductionComment[]> {
  try {
    const commentsRef = collection(db, 'productionComments');
    const q = query(
      commentsRef,
      where('lotId', '==', lotId),
      orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as ProductionComment[];
  } catch (error) {
    console.error("Erro ao buscar comentários: ", error);
    throw new Error("Falha ao buscar comentários.");
  }
}

export async function createComment(data: CreateCommentInput): Promise<{ id: string }> {
  try {
    const commentsRef = collection(db, 'productionComments');
    const now = new Date().toISOString();

    const docRef = await addDoc(commentsRef, {
      lotId: data.lotId,
      content: data.content,
      author: data.author,
      createdAt: now,
    });

    return { id: docRef.id };
  } catch (error) {
    console.error("Erro ao criar comentário: ", error);
    throw new Error("Falha ao criar comentário.");
  }
}

export async function updateComment(id: string, content: string): Promise<void> {
  try {
    const commentRef = doc(db, 'productionComments', id);
    await updateDoc(commentRef, {
      content,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Erro ao atualizar comentário: ", error);
    throw new Error("Falha ao atualizar comentário.");
  }
}

export async function deleteComment(id: string): Promise<void> {
  try {
    const commentRef = doc(db, 'productionComments', id);
    await deleteDoc(commentRef);
  } catch (error) {
    console.error("Erro ao excluir comentário: ", error);
    throw new Error("Falha ao excluir comentário.");
  }
}

// ============================================
// CONTADORES E UTILITÁRIOS
// ============================================

export async function getCommentsCount(lotId: string): Promise<number> {
  try {
    const commentsRef = collection(db, 'productionComments');
    const q = query(commentsRef, where('lotId', '==', lotId));
    const snapshot = await getDocs(q);
    return snapshot.size;
  } catch (error) {
    console.error("Erro ao contar comentários: ", error);
    return 0;
  }
}
