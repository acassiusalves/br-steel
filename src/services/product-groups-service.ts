// src/services/product-groups-service.ts
//
// Persistence layer for AI-suggested product groupings used by the Curva ABC
// report. A "product group" maps multiple SKUs (as they appear in Bling) to a
// single canonical product name, so that analytics can aggregate listings that
// represent the same physical item.
//
// Firestore shape:
//   productGroups/{groupId} = {
//     canonicalName: string,
//     skus: string[],
//     createdAt: string (ISO),
//     createdBy: 'ai' | 'manual',
//     reason?: string,
//   }
//
// Reads use the client Firestore SDK because the callers (server actions and
// client hooks) already depend on `@/lib/firebase`.

import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

const COLLECTION = 'productGroups';

export interface ProductGroup {
  id: string;
  canonicalName: string;
  skus: string[];
  createdAt: string;
  createdBy: 'ai' | 'manual';
  reason?: string;
}

/**
 * Flat view used by the report: one entry per SKU, pointing to the group it
 * belongs to. Makes lookups O(1) when computing the Curva ABC.
 */
export interface SkuGroupMapping {
  sku: string;
  groupId: string;
  canonicalName: string;
}

/**
 * Loads every product group from Firestore.
 */
export async function loadAllProductGroups(): Promise<ProductGroup[]> {
  const snap = await getDocs(query(collection(db, COLLECTION)));
  return snap.docs.map((d) => {
    const data = d.data() as Omit<ProductGroup, 'id'>;
    return { id: d.id, ...data };
  });
}

/**
 * Loads every group and returns two views: the full list and a SKU -> group
 * lookup map.
 */
export async function loadProductGroupIndex(): Promise<{
  groups: ProductGroup[];
  skuToGroup: Map<string, SkuGroupMapping>;
}> {
  const groups = await loadAllProductGroups();
  const skuToGroup = new Map<string, SkuGroupMapping>();
  for (const g of groups) {
    for (const sku of g.skus) {
      skuToGroup.set(sku, {
        sku,
        groupId: g.id,
        canonicalName: g.canonicalName,
      });
    }
  }
  return { groups, skuToGroup };
}

export interface NewProductGroupInput {
  canonicalName: string;
  skus: string[];
  reason?: string;
  createdBy?: 'ai' | 'manual';
}

/**
 * Persists a batch of approved groups. Uses addDoc-style IDs via doc() +
 * writeBatch so all groups are saved atomically.
 */
export async function saveProductGroups(
  inputs: NewProductGroupInput[]
): Promise<string[]> {
  if (!inputs.length) return [];
  const batch = writeBatch(db);
  const ids: string[] = [];
  const now = new Date().toISOString();

  for (const input of inputs) {
    const ref = doc(collection(db, COLLECTION));
    ids.push(ref.id);
    batch.set(ref, {
      canonicalName: input.canonicalName.trim(),
      skus: Array.from(new Set(input.skus)),
      reason: input.reason ?? null,
      createdBy: input.createdBy ?? 'ai',
      createdAt: now,
      createdAtServer: serverTimestamp(),
    });
  }

  await batch.commit();
  return ids;
}
