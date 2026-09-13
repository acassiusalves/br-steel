import 'server-only';
import type { Firestore } from 'firebase-admin/firestore';
import type { Pool } from 'pg';
import { readCoreWriteMode } from '@/server/operations/maintenance';
import { COLLECTIONS, NATIVE_RUN_ID, TABLES, contentHash, type OperationalCollection } from './operational-snapshot';
import { exportOperationalSnapshot } from './operational-export';
import { importSnapshot } from './operational-import';

export type DivergenceKind = 'missing-in-copy' | 'missing-in-source' | 'content';
export type Divergence = { collection: OperationalCollection; id: string; kind: DivergenceKind };
export type ComparisonCounts = Record<string, { source: number; copy: number; native: number }>;
export type Comparison = { divergences: Divergence[]; counts: ComparisonCounts };

/**
 * Compares the copy against a fresh export rather than against the importer's own bookkeeping: the
 * digests the importer stored are not evidence that the payloads still agree. Rows the application
 * wrote natively have no counterpart in Firestore by construction and are counted, never reported as
 * divergences — otherwise zero divergence would be unreachable after the first native write.
 */
export async function compareSources(pool: Pool, db: Firestore, sourceProject: string): Promise<Comparison> {
  const snapshot = await exportOperationalSnapshot(db, sourceProject);
  const divergences: Divergence[] = [];
  const counts: ComparisonCounts = {};

  for (const collection of COLLECTIONS) {
    const source = new Map(snapshot.records.filter(record => record.collection === collection)
      .map(record => [record.id, record.data]));
    const rows = (await pool.query(
      `select source_id, payload, import_run_id from brsteel_ops.${TABLES[collection]} where not source_deleted`)).rows;
    const copy = new Map<string, unknown>();
    let native = 0;
    for (const row of rows) {
      if (row.import_run_id === NATIVE_RUN_ID) { native++; continue; }
      copy.set(row.source_id as string, row.payload);
    }
    counts[collection] = { source: source.size, copy: copy.size, native };

    for (const [id, data] of source) {
      if (!copy.has(id)) { divergences.push({ collection, id, kind: 'missing-in-copy' }); continue; }
      if (contentHash(copy.get(id)) !== contentHash(data)) divergences.push({ collection, id, kind: 'content' });
    }
    for (const id of copy.keys()) {
      if (!source.has(id)) divergences.push({ collection, id, kind: 'missing-in-source' });
    }
  }
  return { divergences, counts };
}

/**
 * Applies everything that changed in Firestore since the previous load, including deletions, and
 * refuses unless the core is blocked. A paginated scan is not a transactional snapshot: with writers
 * still running the result would describe a moment that never existed.
 */
export async function reconcileFromFirestore(pool: Pool, db: Firestore, sourceProject: string) {
  const mode = await readCoreWriteMode();
  if (mode !== 'blocked') {
    throw new Error(`Reconciliation requires the core to be blocked; it is ${mode}.`);
  }
  const snapshot = await exportOperationalSnapshot(db, sourceProject);
  return importSnapshot(pool, snapshot);
}
