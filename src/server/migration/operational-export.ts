import { FieldPath, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, prepareSnapshot, type OperationalCollection, type OperationalSnapshot, type SourceRecord } from './operational-snapshot';

function requireReadCompatibleTypes(collection: OperationalCollection, data: Record<string,unknown>) {
  // These source types cannot be reconstructed from legacy JSON snapshots. Reject before
  // normalization can change query eligibility or the precision exposed by existing readers.
  function inspect(value: unknown) {
    if (value instanceof Timestamp || value instanceof Date) throw new Error(`Source timestamp requires explicit normalization: ${collection}`);
    if (Array.isArray(value)) value.forEach(inspect);
    else if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) Object.values(value).forEach(inspect);
  }
  if (collection === 'stockUpdates') {
    for (const field of ['sku','nome','webhookReceivedAt']) inspect(data[field]);
  } else if (collection !== 'supplyCodes' && collection !== 'operationsMetadata') inspect(data);
}

function jsonValue(value: unknown): unknown {
  if (value instanceof Timestamp) {
    // Construct the whole second directly: toDate() can round into the next second.
    const iso = new Date(value.seconds * 1000).toISOString();
    const fraction = value.nanoseconds % 1_000_000 === 0
      ? String(value.nanoseconds / 1_000_000).padStart(3, '0')
      : String(value.nanoseconds).padStart(9, '0');
    return iso.replace(/\.\d{3}Z$/, `.${fraction}Z`);
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,jsonValue(child)]));
  }
  return value; // Other special types are rejected by prepareSnapshot, never coerced silently.
}

/** Allowlisted export; pagination is not a transactionally consistent snapshot of a moving source. */
export async function exportOperationalSnapshot(db: Firestore, sourceProject: string): Promise<OperationalSnapshot> {
  const capturedAt = new Date().toISOString(), records: SourceRecord[] = [];
  for (const collection of COLLECTIONS) {
    let cursor: string | undefined;
    while (true) {
      let query = db.collection(collection).orderBy(FieldPath.documentId()).limit(500);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (const doc of page.docs) {
        if (collection === 'operationsMetadata' && !/^production-lots-\d{4}$/.test(doc.id)) continue;
        if (!doc.updateTime) throw new Error(`Source version unavailable: ${collection}/${doc.id}`);
        const data = doc.data();
        requireReadCompatibleTypes(collection, data);
        records.push({ collection,id:doc.id,version:(BigInt(doc.updateTime.seconds)*BigInt(1000000000)+BigInt(doc.updateTime.nanoseconds)).toString(),
          data:jsonValue(data) as Record<string,unknown> });
      }
      if (page.size<500) break;
      cursor=page.docs.at(-1)!.id;
    }
  }
  const { hash: _hash, ...snapshot } = prepareSnapshot({ formatVersion:1,sourceProject,capturedAt,completeCollections:[...COLLECTIONS],records });
  return snapshot;
}
