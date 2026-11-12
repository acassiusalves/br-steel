import { FieldPath, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import type { Pool } from 'pg';
import { parseCoreWriteMode, parseOperationalSource, type CoreWriteMode, type OperationalSource } from '../operations/switch-values';
import { COLLECTIONS, TABLES, contentHash, type OperationalCollection } from './operational-snapshot';
import { jsonValue } from './operational-export';

/**
 * Weekly demand is left out on purpose: the Firestore rollup recomputes the series from `salesOrders`,
 * so returning it would only race the recomputation.
 */
export const RETURN_COLLECTIONS: OperationalCollection[] = COLLECTIONS.filter(collection => collection !== 'skuWeeklyDemand');

export type ReturnChange = { collection: OperationalCollection; id: string; kind: 'create' | 'update' | 'delete' };
export type ReturnCounts = Record<string, { postgres: number; firestore: number; create: number; update: number; delete: number }>;
export type ReturnPlan = { changes: ReturnChange[]; counts: ReturnCounts };

type PendingWrite = { change: ReturnChange; payload?: Record<string, unknown>; current?: DocumentData };

/**
 * A message written for the operator, in Portuguese, that names collections and ids but never content.
 * Only these are shown; an error from the driver or the SDK may carry a query, a host or a document.
 */
export class ReturnError extends Error {}

export function returnErrorMessage(error: unknown): string {
  return error instanceof ReturnError ? error.message
    : 'Falha no driver ou no SDK. O detalhe foi omitido para não expor consultas ou dados.';
}

const PAGE_SIZE = 500;
const BATCH_OPERATIONS = 400;
/** Well under the 10 MiB request limit, measured on the serialized payloads. */
const BATCH_BYTES = 4_000_000;
const ISO_INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/;

/** Same domain as the export: only the annual lot counters of `operationsMetadata` belong to the core. */
const inDomain = (collection: OperationalCollection, id: string) =>
  collection !== 'operationsMetadata' || /^production-lots-\d{4}$/.test(id);
/** An id the snapshot would refuse could address a path outside its collection once handed to `doc()`. */
const validId = (id: string) => id.length > 0 && id.length <= 200 && !['.', '..'].includes(id) && !/[/\u0000]/.test(id);

/**
 * The inverse of `jsonValue` for an instant: the fraction is padded on the right to nanoseconds. Anything
 * outside `YYYY-MM-DDTHH:MM:SS(.f{1,9})?Z`, including offsets and impossible dates, is not an instant.
 */
export function timestampFromIso(value: string): Timestamp | null {
  const match = ISO_INSTANT.exec(value);
  if (!match) return null;
  const millis = Date.parse(`${match[1]}Z`);
  // Date.parse rolls impossible calendar dates over instead of refusing them.
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 19) !== match[1]) return null;
  try { return new Timestamp(millis / 1000, Number((match[2] ?? '').padEnd(9, '0'))); }
  catch { return null; } // Outside the range Firestore can represent.
}

/**
 * Only a string the export would have produced from that very Timestamp, and that Firestore can store
 * exactly, is turned back into one. Firestore keeps microseconds, so `.123456789Z` would be stored as
 * `.123456000Z`; that, or any other string, would never compare equal again and the return could not converge.
 */
function restoredTimestamp(value: unknown): Timestamp | null {
  if (typeof value !== 'string') return null;
  const timestamp = timestampFromIso(value);
  return timestamp && timestamp.nanoseconds % 1000 === 0 && jsonValue(timestamp) === value ? timestamp : null;
}

/** Reads the switches from the target itself, uncached: the return must never act on a stale value. */
export async function readSwitches(db: Firestore): Promise<{ source: OperationalSource; mode: CoreWriteMode }> {
  const config = db.collection('appConfig');
  const [source, mode] = await Promise.all([config.doc('operationalSource').get(), config.doc('coreWriteMode').get()]);
  return { source: parseOperationalSource(source.data()?.source), mode: parseCoreWriteMode(mode.data()?.mode) };
}

async function readFirestore(db: Firestore, collection: OperationalCollection) {
  const documents = new Map<string, DocumentData>();
  let cursor: string | undefined;
  while (true) {
    let query = db.collection(collection).orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) if (inDomain(collection, doc.id)) documents.set(doc.id, doc.data());
    if (page.size < PAGE_SIZE) break;
    cursor = page.docs.at(-1)!.id;
  }
  return documents;
}

async function readPostgres(pool: Pool, collection: OperationalCollection) {
  const rows = new Map<string, Record<string, unknown>>();
  const result = await pool.query(
    `select source_id, payload from brsteel_ops.${TABLES[collection]} where not source_deleted order by source_id`);
  for (const row of result.rows) {
    const id = row.source_id as string;
    if (!validId(id)) throw new ReturnError(`Identificador inválido no PostgreSQL: ${collection}/${id}.`);
    if (inDomain(collection, id)) rows.set(id, row.payload as Record<string, unknown>);
  }
  return rows;
}

/** Messages name the document and never its content: the repository and its logs are public. */
function digest(side: string, collection: OperationalCollection, id: string, value: () => unknown) {
  try { return contentHash(value()); }
  catch { throw new ReturnError(`Documento não comparável no ${side}: ${collection}/${id}.`); }
}

/**
 * Classifies by id over the whole domain rather than over an audit trail: webhook ingestion is not
 * audited and the PostgreSQL adapters delete rows for real, so only comparing complete states sees all.
 */
async function computeReturn(pool: Pool, db: Firestore) {
  const changes: ReturnChange[] = [], counts: ReturnCounts = {}, pending: PendingWrite[] = [];
  for (const collection of RETURN_COLLECTIONS) {
    const firestore = await readFirestore(db, collection);
    const postgres = await readPostgres(pool, collection);
    const tally = { postgres: postgres.size, firestore: firestore.size, create: 0, update: 0, delete: 0 };
    const add = (write: PendingWrite) => { changes.push(write.change); pending.push(write); tally[write.change.kind]++; };
    for (const [id, payload] of postgres) {
      const current = firestore.get(id);
      if (!current) add({ change: { collection, id, kind: 'create' }, payload });
      else if (digest('PostgreSQL', collection, id, () => payload) !== digest('Firestore', collection, id, () => jsonValue(current))) {
        add({ change: { collection, id, kind: 'update' }, payload, current });
      }
    }
    for (const id of firestore.keys()) {
      if (!postgres.has(id)) add({ change: { collection, id, kind: 'delete' } });
    }
    counts[collection] = tally;
  }
  return { plan: { changes, counts }, pending };
}

/**
 * The whole payload replaces the document. Two rules restore Firestore timestamps that the copy holds
 * as ISO strings: the retention instant of stock observations (the TTL policy ignores strings) and, on
 * an update, every top-level field that is a Timestamp in the document being replaced.
 */
function documentFor({ change, payload, current }: PendingWrite): Record<string, unknown> {
  const document = { ...payload };
  const restore = (field: string) => {
    const timestamp = restoredTimestamp(document[field]);
    if (timestamp) document[field] = timestamp;
  };
  if (change.collection === 'stockObservations') restore('expiresAt');
  for (const [field, value] of Object.entries(current ?? {})) if (value instanceof Timestamp) restore(field);
  return document;
}

/**
 * Groups writes into batches of at most 400 operations, starting a new batch before a write that would
 * take the current one past 4,000,000 bytes. A single write above that still goes, alone.
 */
export function returnBatches<T>(writes: readonly T[], bytesOf: (write: T) => number): T[][] {
  const batches: T[][] = [];
  let current: T[] = [], bytes = 0;
  for (const write of writes) {
    const size = bytesOf(write);
    if (current.length && (current.length === BATCH_OPERATIONS || bytes + size > BATCH_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(write);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

const payloadBytes = (write: PendingWrite) => write.payload ? Buffer.byteLength(JSON.stringify(write.payload)) : 0;

async function writeReturn(db: Firestore, pending: PendingWrite[]) {
  for (const writes of returnBatches(pending, payloadBytes)) {
    const batch = db.batch();
    for (const write of writes) {
      const { collection, id, kind } = write.change;
      const ref = db.collection(collection).doc(id);
      if (kind === 'delete') { batch.delete(ref); continue; }
      try { batch.set(ref, documentFor(write)); }
      catch { throw new ReturnError(`Documento recusado pelo Firestore: ${collection}/${id}.`); }
    }
    await batch.commit();
  }
}

/** What applying would change; nothing is written. */
export async function planReturn(pool: Pool, db: Firestore): Promise<ReturnPlan> {
  return (await computeReturn(pool, db)).plan;
}

/**
 * Makes the target Firestore equal to the copy and returns the plan it applied. Both switches are
 * checked before anything is read or written: the source guard keeps the tool away from a Firestore
 * that is still the live store, and the blocked core keeps the copy from moving while it is mirrored.
 * An interrupted run is resolved by running it again.
 */
export async function applyReturn(pool: Pool, db: Firestore): Promise<ReturnPlan> {
  const { source, mode } = await readSwitches(db);
  if (source !== 'postgres') throw new ReturnError(`O retorno só grava num Firestore cuja fonte ativa é postgres; a fonte é ${source}.`);
  if (mode !== 'blocked') throw new ReturnError(`O retorno exige o núcleo bloqueado; o modo é ${mode}.`);
  const { plan, pending } = await computeReturn(pool, db);
  await writeReturn(db, pending);
  return plan;
}

/** The same comparison as the plan, read after an apply: zero changes means the return is complete. */
export async function verifyReturn(pool: Pool, db: Firestore): Promise<ReturnPlan> {
  return planReturn(pool, db);
}
