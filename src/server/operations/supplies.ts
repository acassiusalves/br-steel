import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import type { Supply } from '@/types/supply';
import type { AccessContext } from '@/server/access/types';
import { dateSchema, documentIdSchema, pageInputSchema, paginateQuery, requireOperation, result, OperationError } from './common';
const finite = z.number().finite().min(0).max(1e12);
const fields = z.object({ nome: z.string().trim().min(1).max(200), codigo: documentIdSchema.transform(v => v.trim()).refine(Boolean), gtin: z.string().max(50).default(''), unidade: z.string().trim().min(1).max(20),
  precoCusto: finite, estoqueMinimo: finite, estoqueMaximo: finite, tempoEntrega: finite });
const keyRef = (sku: string) => adminDb.collection('supplyCodes').doc(createHash('sha256').update(sku).digest('hex'));
const notFound = () => new OperationError('NOT_FOUND', 'Insumo não encontrado.', 404);
function validateLimits(data: { estoqueMinimo?: number; estoqueMaximo?: number }) {
  if (typeof data.estoqueMinimo === 'number' && typeof data.estoqueMaximo === 'number' && data.estoqueMinimo > data.estoqueMaximo) throw new OperationError('INVALID_LIMITS', 'O estoque mínimo não pode ser maior que o máximo.');
}
export async function listSupplies(context: AccessContext, raw: unknown) {
  requireOperation(context, 'insumos:read'); const input = pageInputSchema.strict().parse(raw);
  const page = await paginateQuery(adminDb.collection('supplies'), input);
  return result(page.docs.map(doc => ({ ...doc.data(), id: doc.id }) as Supply), 'firestore', [], page.nextCursor);
}
export async function createSupply(context: AccessContext, raw: unknown) {
  requireOperation(context, 'insumos:write'); const input = fields.parse(raw); validateLimits(input);
  const ref = adminDb.collection('supplies').doc(), code = keyRef(input.codigo);
  await adminDb.runTransaction(async tx => {
    const [key, existing] = await Promise.all([tx.get(code), tx.get(adminDb.collection('supplies').where('codigo', '==', input.codigo).limit(1))]);
    if (key.exists || !existing.empty) throw new OperationError('DUPLICATE_SKU', 'Já existe um insumo com este SKU.', 409);
    tx.create(ref, { ...input, estoqueAtual: 0, createdAt: new Date().toISOString(), createdBy: context.actor.userId });
    tx.set(code, { supplyId: ref.id });
  });
  return result({ id: ref.id });
}
export async function updateSupplyRecord(context: AccessContext, id: string, raw: unknown) {
  requireOperation(context, 'insumos:write'); documentIdSchema.parse(id); const input = fields.partial().strict().parse(raw);
  const ref = adminDb.collection('supplies').doc(id);
  await adminDb.runTransaction(async tx => {
    const doc = await tx.get(ref); if (!doc.exists) throw notFound(); const existing = doc.data()!;
    validateLimits({ ...existing, ...input });
    if (input.codigo && input.codigo !== existing.codigo) {
      const [key, matches] = await Promise.all([tx.get(keyRef(input.codigo)), tx.get(adminDb.collection('supplies').where('codigo', '==', input.codigo).limit(1))]);
      if ((key.exists && key.data()?.supplyId !== id) || !matches.empty) throw new OperationError('DUPLICATE_SKU', 'Já existe um insumo com este SKU.', 409);
      if (existing.codigo) tx.delete(keyRef(existing.codigo));
      tx.set(keyRef(input.codigo), { supplyId: id });
    }
    tx.update(ref, { ...input, updatedAt: new Date().toISOString(), updatedBy: context.actor.userId });
  });
  return result({ id });
}
export async function updateSupplyLimits(context: AccessContext, raw: unknown) {
  requireOperation(context, 'insumos:write');
  const input = z.object({ sku: documentIdSchema, estoqueMinimo: finite.optional(), estoqueMaximo: finite.optional() }).strict().refine(v => v.estoqueMinimo !== undefined || v.estoqueMaximo !== undefined).parse(raw);
  const matches = await adminDb.collection('supplies').where('codigo', '==', input.sku).limit(2).get();
  if (matches.empty) throw notFound(); if (matches.size > 1) throw new OperationError('DUPLICATE_SKU', 'Há cadastros duplicados para este SKU. Corrija antes de atualizar.', 409);
  const data = { ...(input.estoqueMinimo !== undefined ? { estoqueMinimo: input.estoqueMinimo } : {}), ...(input.estoqueMaximo !== undefined ? { estoqueMaximo: input.estoqueMaximo } : {}) };
  return updateSupplyRecord(context, matches.docs[0].id, data);
}
export async function deleteSupplyRecord(context: AccessContext, id: string) {
  requireOperation(context, 'insumos:write'); documentIdSchema.parse(id); const ref = adminDb.collection('supplies').doc(id);
  await adminDb.runTransaction(async tx => {
    const [doc, history] = await Promise.all([tx.get(ref), tx.get(adminDb.collection('inventoryMovements').where('supplyId', '==', id).limit(1))]);
    if (!doc.exists) throw notFound();
    if (!history.empty || (doc.data()?.estoqueAtual ?? 0) !== 0) throw new OperationError('SUPPLY_IN_USE', 'Não é possível excluir um insumo com saldo ou histórico de movimentações.', 409);
    tx.delete(ref); if (doc.data()?.codigo) tx.delete(keyRef(doc.data()!.codigo));
  });
  return result({ id });
}
export async function recordMovement(context: AccessContext, raw: unknown) {
  requireOperation(context, 'insumos:write');
  const input = z.object({ supplyId: documentIdSchema, type: z.enum(['entrada', 'saida']), quantity: z.number().finite().positive().max(1e12), unitCost: finite.optional(), notes: z.string().trim().max(2000).optional() }).parse(raw);
  const supply = adminDb.collection('supplies').doc(input.supplyId), movement = adminDb.collection('inventoryMovements').doc();
  const newStock = await adminDb.runTransaction(async tx => {
    const doc = await tx.get(supply); if (!doc.exists) throw notFound(); const current = doc.data()?.estoqueAtual ?? 0;
    if (typeof current !== 'number' || !Number.isFinite(current)) throw new OperationError('INVALID_BALANCE', 'Saldo cadastrado inválido.');
    const balance = current + (input.type === 'entrada' ? input.quantity : -input.quantity);
    if (!Number.isFinite(balance) || Math.abs(balance) > 1e12) throw new OperationError('INVALID_BALANCE', 'Saldo fora do limite permitido.');
    const createdAt = new Date().toISOString();
    tx.update(supply, { estoqueAtual: balance, updatedAt: createdAt, updatedBy: context.actor.userId });
    tx.create(movement, { ...input, createdAt, createdBy: context.actor.userId, source: context.actor.source, balanceAfter: balance });
    return balance;
  });
  return result({ id: movement.id, newStock }, 'firestore', newStock < 0 ? [`O saldo deste insumo ficou negativo (${newStock}).`] : []);
}
/** First instant of the civil day, including days whose midnight is skipped by DST. */
function saoPauloMidnight(day: string) {
  const target = Date.parse(`${day}T00:00:00Z`);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  let low = target - 86400000, high = target + 86400000;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const parts = Object.fromEntries(formatter.formatToParts(new Date(middle)).map(part => [part.type, part.value]));
    const civilDay = `${parts.year}-${parts.month}-${parts.day}`;
    if (civilDay < day) low = middle + 1; else high = middle;
  }
  return new Date(low).toISOString();
}
export async function listMovements(context: AccessContext, raw: unknown) {
  requireOperation(context, 'insumos:read');
  const input = pageInputSchema.extend({ supplyId: documentIdSchema, from: dateSchema.optional(), to: dateSchema.optional() }).strict().parse(raw);
  if (input.from && input.to && input.from > input.to) throw new OperationError('INVALID_INPUT', 'Período inválido.');
  let query: FirebaseFirestore.Query = adminDb.collection('inventoryMovements').where('supplyId', '==', input.supplyId);
  // Preserve existing undated list cursor behavior for the web client.
  if (!input.from && !input.to) {
    const page = await paginateQuery(query, input);
    return result(page.docs.map(doc => ({ ...doc.data(), id: doc.id })), 'firestore', [], page.nextCursor);
  }
  if (input.from) query = query.where('createdAt', '>=', saoPauloMidnight(input.from));
  if (input.to) {
    const nextDay = new Date(Date.parse(`${input.to}T00:00:00Z`) + 86400000).toISOString().slice(0,10);
    query = query.where('createdAt', '<', saoPauloMidnight(nextDay));
  }
  query = query.orderBy('createdAt').orderBy(FieldPath.documentId());
  if (input.cursor) {
    try {
      const cursor = z.object({ createdAt: z.string().datetime(), id: documentIdSchema }).strict().parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')));
      query = query.startAfter(cursor.createdAt, cursor.id);
    } catch { throw new OperationError('INVALID_CURSOR', 'Paginação inválida.'); }
  }
  const snapshot = await query.limit(input.limit + 1).get(); const docs = snapshot.docs.slice(0, input.limit);
  const last = docs.at(-1);
  const nextCursor = snapshot.size > input.limit ? Buffer.from(JSON.stringify({ createdAt: last!.data().createdAt, id: last!.id })).toString('base64url') : null;
  return result(docs.map(doc => ({ ...doc.data(), id: doc.id })), 'firestore', [], nextCursor);
}
