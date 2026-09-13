import 'server-only';
import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import { OperationError, result } from '@/server/operations/common';
import type { MovementInput, SuppliesWriteRepository, SupplyFields } from './supplies-write-contract';
import { validateLimits } from './supplies-write-contract';
import type { WriteActor } from './write-audit';

const keyRef = (sku: string) => adminDb.collection('supplyCodes').doc(createHash('sha256').update(sku).digest('hex'));
const notFound = () => new OperationError('NOT_FOUND', 'Insumo não encontrado.', 404);
const duplicate = () => new OperationError('DUPLICATE_SKU', 'Já existe um insumo com este SKU.', 409);

async function findBySku(sku: string) {
  const matches = await adminDb.collection('supplies').where('codigo', '==', sku).limit(2).get();
  return matches.docs.map(doc => doc.id);
}

async function create(input: SupplyFields, actor: WriteActor) {
  const ref = adminDb.collection('supplies').doc(), code = keyRef(input.codigo);
  await adminDb.runTransaction(async tx => {
    const [key, existing] = await Promise.all([tx.get(code), tx.get(adminDb.collection('supplies').where('codigo', '==', input.codigo).limit(1))]);
    if (key.exists || !existing.empty) throw duplicate();
    tx.create(ref, { ...input, estoqueAtual: 0, createdAt: new Date().toISOString(), createdBy: actor.userId });
    tx.set(code, { supplyId: ref.id });
  });
  return result({ id: ref.id });
}

async function update(id: string, input: Partial<SupplyFields>, actor: WriteActor) {
  const ref = adminDb.collection('supplies').doc(id);
  await adminDb.runTransaction(async tx => {
    const doc = await tx.get(ref); if (!doc.exists) throw notFound(); const existing = doc.data()!;
    validateLimits({ ...existing, ...input });
    if (input.codigo && input.codigo !== existing.codigo) {
      const [key, matches] = await Promise.all([tx.get(keyRef(input.codigo)), tx.get(adminDb.collection('supplies').where('codigo', '==', input.codigo).limit(1))]);
      if ((key.exists && key.data()?.supplyId !== id) || !matches.empty) throw duplicate();
      if (existing.codigo) tx.delete(keyRef(existing.codigo));
      tx.set(keyRef(input.codigo), { supplyId: id });
    }
    tx.update(ref, { ...input, updatedAt: new Date().toISOString(), updatedBy: actor.userId });
  });
  return result({ id });
}

async function remove(id: string) {
  const ref = adminDb.collection('supplies').doc(id);
  await adminDb.runTransaction(async tx => {
    const [doc, history] = await Promise.all([tx.get(ref), tx.get(adminDb.collection('inventoryMovements').where('supplyId', '==', id).limit(1))]);
    if (!doc.exists) throw notFound();
    if (!history.empty || (doc.data()?.estoqueAtual ?? 0) !== 0) throw new OperationError('SUPPLY_IN_USE', 'Não é possível excluir um insumo com saldo ou histórico de movimentações.', 409);
    tx.delete(ref); if (doc.data()?.codigo) tx.delete(keyRef(doc.data()!.codigo));
  });
  return result({ id });
}

async function recordMovement(input: MovementInput, actor: WriteActor) {
  const supply = adminDb.collection('supplies').doc(input.supplyId), movement = adminDb.collection('inventoryMovements').doc();
  const newStock = await adminDb.runTransaction(async tx => {
    const doc = await tx.get(supply); if (!doc.exists) throw notFound(); const current = doc.data()?.estoqueAtual ?? 0;
    if (typeof current !== 'number' || !Number.isFinite(current)) throw new OperationError('INVALID_BALANCE', 'Saldo cadastrado inválido.');
    const balance = current + (input.type === 'entrada' ? input.quantity : -input.quantity);
    if (!Number.isFinite(balance) || Math.abs(balance) > 1e12) throw new OperationError('INVALID_BALANCE', 'Saldo fora do limite permitido.');
    const createdAt = new Date().toISOString();
    tx.update(supply, { estoqueAtual: balance, updatedAt: createdAt, updatedBy: actor.userId });
    tx.create(movement, { ...input, createdAt, createdBy: actor.userId, source: actor.source, balanceAfter: balance });
    return balance;
  });
  return result({ id: movement.id, newStock }, 'firestore', newStock < 0 ? [`O saldo deste insumo ficou negativo (${newStock}).`] : []);
}

export const firestoreSuppliesWriteRepository: SuppliesWriteRepository = { findBySku, create, update, remove, recordMovement };
