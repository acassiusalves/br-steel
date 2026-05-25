import { adminDb } from '@/lib/firebase-admin';
import type { SessionUser } from '@/lib/server-auth';
import type {
  DeepSearchConsideredItem,
  DeepSearchQueryResult,
  DeepSearchResult,
  DeepSearchResultItem,
  DeepSearchSavedAnalysis,
  DeepSearchSavedAnalysisSummary,
} from '@/lib/deep-search-types';
import type { MercadoLivreSearchItem } from '@/types/mercado-livre-catalog-search';

const DEEP_SEARCH_ANALYSES_COLLECTION = 'mercadoLivreDeepSearchAnalyses';
const QUERY_ITEMS_CHUNK_SIZE = 5;
const FIRESTORE_BATCH_LIMIT = 430;

type StoredDeepSearchAnalysisDoc = DeepSearchSavedAnalysisSummary & {
  result: DeepSearchResult;
  updatedAt: string;
};

function cleanForFirestore<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function compactSearchItemForStorage(item: MercadoLivreSearchItem): MercadoLivreSearchItem {
  return {
    ...item,
    attributes: item.attributes.slice(0, 30),
    questions: [],
    shippingOptions: [],
    categoryTrends: [],
    marketplaceData: {
      catalogProduct: null,
      catalogOffers: null,
      referenceOffer: null,
      referenceItem: null,
      referenceItemDescription: null,
      seller: null,
      category: null,
      categoryAttributes: null,
    },
  };
}

function compactResultItemForStorage(entry: DeepSearchResultItem): DeepSearchResultItem {
  return {
    ...entry,
    item: compactSearchItemForStorage(entry.item),
  };
}

function compactConsideredItemForStorage(entry: DeepSearchConsideredItem): DeepSearchConsideredItem {
  return {
    ...entry,
    item: compactSearchItemForStorage(entry.item),
  };
}

function compactResultForStorage(result: DeepSearchResult): DeepSearchResult {
  return cleanForFirestore({
    ...result,
    config: {
      ...result.config,
      baseProducts: result.config.baseProducts.map(compactSearchItemForStorage),
    },
    queryResults: [],
    results: [],
    savedAnalysis: result.savedAnalysis || null,
  });
}

function summaryFromResult(result: DeepSearchResult, user?: SessionUser | null): DeepSearchSavedAnalysisSummary {
  const baseProductTitles = result.config.baseProducts.map((product) => product.title).filter(Boolean).slice(0, 6);
  const title = baseProductTitles.length > 0 ? baseProductTitles.join(' + ') : `Deep Search ${result.sessionId}`;

  return {
    analysisId: result.sessionId,
    accountId: result.account?.accountId || '',
    accountName: result.account?.accountName || null,
    siteId: result.account?.siteId || null,
    userId: user?.id || null,
    userName: user?.name || null,
    userEmail: user?.email || null,
    title,
    baseProductTitles,
    focus: result.config.focus,
    depth: result.config.depth,
    visitsWindow: result.config.visitsWindow,
    totalQueries: result.metadata.totalQueries,
    totalItemsScanned: result.metadata.totalItemsScanned,
    uniqueCandidates: result.metadata.uniqueCandidates,
    totalOccurrences: result.metadata.totalOccurrences,
    matchedResults: result.metadata.matchedResults,
    categoriesExplored: result.metadata.categoriesExplored,
    termsExplored: result.metadata.termsExplored,
    executionTimeMs: result.metadata.executionTimeMs,
    topCategories: result.insights.categories.slice(0, 8).map((category) => ({
      categoryId: category.categoryId,
      name: category.name,
      termsUsed: category.termsUsed,
      uniqueCandidates: category.uniqueCandidates,
      totalVisits: category.totalVisits,
    })),
    createdAt: result.metadata.startedAt,
    completedAt: result.metadata.completedAt,
  };
}

function queryDocId(index: number) {
  return String(index).padStart(4, '0');
}

function chunkDocId(queryIndex: number, chunkIndex: number) {
  return `${String(queryIndex).padStart(4, '0')}_${String(chunkIndex).padStart(3, '0')}`;
}

function resultChunkDocId(chunkIndex: number) {
  return String(chunkIndex).padStart(4, '0');
}

async function commitWhenNeeded(state: { batch: FirebaseFirestore.WriteBatch; count: number }) {
  if (state.count < FIRESTORE_BATCH_LIMIT) return;
  await state.batch.commit();
  state.batch = adminDb.batch();
  state.count = 0;
}

function setInBatch(
  state: { batch: FirebaseFirestore.WriteBatch; count: number },
  ref: FirebaseFirestore.DocumentReference,
  data: unknown
) {
  state.batch.set(ref, cleanForFirestore(data));
  state.count += 1;
}

export async function saveDeepSearchAnalysis(
  result: DeepSearchResult,
  user?: SessionUser | null
): Promise<DeepSearchSavedAnalysisSummary> {
  const now = new Date().toISOString();
  const summary = summaryFromResult(result, user);
  const mainRef = adminDb.collection(DEEP_SEARCH_ANALYSES_COLLECTION).doc(result.sessionId);
  const storedResult = compactResultForStorage({
    ...result,
    savedAnalysis: summary,
  });
  const analysisDoc: StoredDeepSearchAnalysisDoc = {
    ...summary,
    result: storedResult,
    updatedAt: now,
  };
  const state = {
    batch: adminDb.batch(),
    count: 0,
  };

  setInBatch(state, mainRef, analysisDoc);
  await commitWhenNeeded(state);

  for (const [queryIndex, queryResult] of result.queryResults.entries()) {
    const docId = queryDocId(queryIndex);
    const queryRef = mainRef.collection('queryResults').doc(docId);
    const { items, ...queryMetadata } = queryResult;
    setInBatch(state, queryRef, {
      ...queryMetadata,
      queryDocId: docId,
      order: queryIndex,
      itemCount: items.length,
    });
    await commitWhenNeeded(state);

    for (let chunkIndex = 0; chunkIndex < items.length; chunkIndex += QUERY_ITEMS_CHUNK_SIZE) {
      const chunk = items
        .slice(chunkIndex, chunkIndex + QUERY_ITEMS_CHUNK_SIZE)
        .map(compactConsideredItemForStorage);
      const itemRef = mainRef.collection('queryResultItems').doc(chunkDocId(queryIndex, chunkIndex / QUERY_ITEMS_CHUNK_SIZE));
      setInBatch(state, itemRef, {
        queryDocId: docId,
        queryId: queryResult.queryId,
        order: queryIndex,
        chunkIndex: chunkIndex / QUERY_ITEMS_CHUNK_SIZE,
        items: chunk,
      });
      await commitWhenNeeded(state);
    }
  }

  for (let index = 0; index < result.results.length; index += QUERY_ITEMS_CHUNK_SIZE) {
    const chunkIndex = index / QUERY_ITEMS_CHUNK_SIZE;
    const resultRef = mainRef.collection('rankedResultItems').doc(resultChunkDocId(chunkIndex));
    setInBatch(state, resultRef, {
      chunkIndex,
      items: result.results.slice(index, index + QUERY_ITEMS_CHUNK_SIZE).map(compactResultItemForStorage),
    });
    await commitWhenNeeded(state);
  }

  await commitWhenNeeded(state);
  if (state.count > 0) await state.batch.commit();

  return summary;
}

export async function listDeepSearchAnalyses(limitCount = 40): Promise<DeepSearchSavedAnalysisSummary[]> {
  const snapshot = await adminDb
    .collection(DEEP_SEARCH_ANALYSES_COLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(limitCount)
    .select(
      'analysisId',
      'accountId',
      'accountName',
      'siteId',
      'userId',
      'userName',
      'userEmail',
      'title',
      'baseProductTitles',
      'focus',
      'depth',
      'visitsWindow',
      'totalQueries',
      'totalItemsScanned',
      'uniqueCandidates',
      'totalOccurrences',
      'matchedResults',
      'categoriesExplored',
      'termsExplored',
      'executionTimeMs',
      'topCategories',
      'createdAt',
      'completedAt'
    )
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data() as StoredDeepSearchAnalysisDoc;
    const { result: _result, updatedAt: _updatedAt, ...summary } = data;
    return summary;
  });
}

export async function loadDeepSearchAnalysis(analysisId: string): Promise<DeepSearchSavedAnalysis | null> {
  const mainRef = adminDb.collection(DEEP_SEARCH_ANALYSES_COLLECTION).doc(analysisId);
  const snap = await mainRef.get();
  if (!snap.exists) return null;

  const data = snap.data() as StoredDeepSearchAnalysisDoc;
  const { result, updatedAt: _updatedAt, ...summary } = data;
  const [querySnapshot, itemSnapshot, rankedResultSnapshot] = await Promise.all([
    mainRef.collection('queryResults').get(),
    mainRef.collection('queryResultItems').get(),
    mainRef.collection('rankedResultItems').get(),
  ]);
  const itemsByQueryDocId = new Map<string, DeepSearchConsideredItem[]>();

  itemSnapshot.docs
    .map((doc) => doc.data() as { queryDocId: string; order: number; chunkIndex: number; items: DeepSearchConsideredItem[] })
    .sort((left, right) => left.order - right.order || left.chunkIndex - right.chunkIndex)
    .forEach((chunk) => {
      const current = itemsByQueryDocId.get(chunk.queryDocId) || [];
      current.push(...(chunk.items || []));
      itemsByQueryDocId.set(chunk.queryDocId, current);
    });

  const queryResults = querySnapshot.docs
    .map((doc) => {
      const data = doc.data() as Omit<DeepSearchQueryResult, 'items'> & {
        queryDocId: string;
        order: number;
      };
      const { queryDocId, order, ...queryResult } = data;
      return {
        order,
        queryResult: {
          ...queryResult,
          items: itemsByQueryDocId.get(queryDocId) || [],
        } satisfies DeepSearchQueryResult,
      };
    })
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.queryResult);
  const rankedResults = rankedResultSnapshot.docs
    .map((doc) => doc.data() as { chunkIndex: number; items: DeepSearchResultItem[] })
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
    .flatMap((chunk) => chunk.items || []);

  return {
    summary,
    result: {
      ...result,
      queryResults,
      results: rankedResults,
      savedAnalysis: summary,
    },
  };
}
