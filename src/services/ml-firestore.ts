
// @ts-nocheck
import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';
import { subDays, format } from 'date-fns';

// --- TYPES ---
export interface FeedEntry {
  id: string;
  storeName: string;
  date: string;
  products: Array<{
    sku: string;
    name: string;
    avgPrice: number;
    minPrice: number;
    maxPrice: number;
    url?: string;
  }>;
}

export interface AppSettings {
    gordura_variable?: number;
    // outros campos...
}

export interface ProductMatchTraining {
    id: string;
    mlBrand: string;
    mlModel: string;
    mlStorage: string | null;
    mlRam: string | null;
    feedSku: string;
    feedProductName: string;
    createdAt: string;
    mlProductExample?: string;
}

export interface Product {
    id: string;
    name: string;
    sku: string;
    category: string;
    costPrice?: number;
    // ... outros campos
}

const USERS_COLLECTION = 'users';

const getUserId = () => {
    // TODO: Implement proper auth when needed
    return 'default-user';
}

const handleFirestoreError = (error: any, context: string) => {
    console.error(`Error in ${context}:`, error);
    // throw error; // Optional: rethrow or handle gracefully
};

const toFirestore = (data: any) => {
    // Basic implementation, expand if needed
    return JSON.parse(JSON.stringify(data, (k, v) => v === undefined ? null : v));
};

const fromFirestore = (data: any) => {
    // Basic implementation
    return data;
};


// --- FEED ENTRIES ---

export const loadAllFeedEntries = async (): Promise<FeedEntry[]> => {
    const feedCol = collection(db, "feed_entries");
    const q = query(feedCol, orderBy("date", "desc"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as FeedEntry);
};

export const loadAppSettings = async (): Promise<AppSettings | null> => {
  const docRef = doc(db, 'appSettings', 'general');
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return docSnap.data() as AppSettings;
  }
  return null;
};

export const loadAllFeedEntriesWithGordura = async (): Promise<{ feedEntries: FeedEntry[], gordura: number }> => {
    const [feedEntries, settings] = await Promise.all([
        loadAllFeedEntries(),
        loadAppSettings()
    ]);
    const gordura = settings?.gordura_variable || 0;
    return { feedEntries, gordura: Number(gordura) };
};

export async function fetchAllProductsFromFeed(): Promise<FeedEntry['products']> {
    const feedEntries = await loadAllFeedEntries();
    const latestEntriesByStore = new Map<string, FeedEntry>();
    for (const entry of feedEntries) {
      if (!latestEntriesByStore.has(entry.storeName) || new Date(entry.date) > new Date(latestEntriesByStore.get(entry.storeName)!.date)) {
        latestEntriesByStore.set(entry.storeName, entry);
      }
    }

    const allProductsMap = new Map<string, FeedEntry['products'][0]>();
    for (const entry of latestEntriesByStore.values()) {
        entry.products.forEach(product => {
            const key = product.sku || product.name;
            if (key && !allProductsMap.has(key)) {
                allProductsMap.set(key, product);
            }
        });
    }

    return Array.from(allProductsMap.values());
}

// --- PRODUCT MATCH TRAINING ---

export const generateTrainingKey = (brand: string, model: string, storage: string | null, ram: string | null): string => {
    const parts = [
        brand.toLowerCase().trim(),
        model.toLowerCase().trim(),
        storage?.toLowerCase().trim() || 'any',
        ram?.toLowerCase().trim() || 'any'
    ];
    return parts.join('_').replace(/\s+/g, '');
};

export const saveProductMatchTraining = async (training: Omit<ProductMatchTraining, 'id' | 'createdAt'>): Promise<string> => {
    try {
        const key = generateTrainingKey(training.mlBrand, training.mlModel, training.mlStorage, training.mlRam);
        const docRef = doc(db, 'product_match_training', key);

        const data: ProductMatchTraining = {
            ...training,
            id: key, // Use key as ID
            createdAt: new Date().toISOString()
        };

        await setDoc(docRef, data);
        console.log(`✅ Treinamento salvo: ${key} -> ${training.feedSku}`);
        return key;
    } catch (error) {
        handleFirestoreError(error, 'saveProductMatchTraining');
        throw error;
    }
};

export const loadAllProductMatchTrainings = async (): Promise<ProductMatchTraining[]> => {
    try {
        const collectionRef = collection(db, 'product_match_training');
        const q = query(collectionRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);

        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as ProductMatchTraining[];
    } catch (error) {
        console.error('Erro ao carregar treinamentos:', error);
        return [];
    }
};

// --- PRICE HISTORY ---

export async function getCatalogPriceHistory(
    catalogProductId: string,
    days: number = 30
): Promise<{
    date: string;
    classicPrice: number | null;
    premiumPrice: number | null;
    minPrice: number | null;
    maxPrice: number | null;
    avgPrice: number | null;
}[]> {
    try {
        const userId = getUserId();
        const startDate = format(subDays(new Date(), days), 'yyyy-MM-dd');

        const snapshotsRef = collection(
            db,
            USERS_COLLECTION,
            userId,
            'catalog-price-history',
            catalogProductId,
            'snapshots'
        );

        const q = query(
            snapshotsRef,
            where('date', '>=', startDate),
            orderBy('date', 'asc'),
            limit(days)
        );

        const snapshot = await getDocs(q);

        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                date: data.date,
                classicPrice: data.classicPrice ?? null,
                premiumPrice: data.premiumPrice ?? null,
                minPrice: data.minPrice ?? null,
                maxPrice: data.maxPrice ?? null,
                avgPrice: data.avgPrice ?? null
            };
        });
    } catch (error) {
        console.error('Erro ao buscar histórico de preços:', error);
        return [];
    }
}

export async function saveCatalogPriceHistoryBatch(
    products: Array<{
        catalogProductId: string;
        classicPrice: number | null;
        premiumPrice: number | null;
        minPrice: number | null;
        maxPrice: number | null;
        avgPrice: number | null;
        competitorCount?: number;
    }>
): Promise<{ success: number; failed: number }> {
    const userId = getUserId();
    const today = format(new Date(), 'yyyy-MM-dd');
    const results = { success: 0, failed: 0 };

    // Firestore batch tem limite de 500 operações
    const BATCH_SIZE = 450;
    const batches = [];

    for (let i = 0; i < products.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const batchProducts = products.slice(i, i + BATCH_SIZE);

        for (const product of batchProducts) {
            const snapshotRef = doc(
                db,
                USERS_COLLECTION,
                userId,
                'catalog-price-history',
                product.catalogProductId,
                'snapshots',
                today
            );

            batch.set(snapshotRef, {
                date: today,
                classicPrice: product.classicPrice,
                premiumPrice: product.premiumPrice,
                minPrice: product.minPrice,
                maxPrice: product.maxPrice,
                avgPrice: product.avgPrice,
                competitorCount: product.competitorCount ?? null,
                createdAt: serverTimestamp()
            }, { merge: true });
        }

        batches.push(batch);
    }

    // Executa todos os batches
    for (const batch of batches) {
        try {
            await batch.commit();
            results.success += BATCH_SIZE;
        } catch (error) {
            console.error('Erro ao salvar batch de histórico:', error);
            results.failed += BATCH_SIZE;
        }
    }

    // Ajusta contagem final
    results.success = Math.min(results.success, products.length);
    results.failed = products.length - results.success;

    return results;
}

export const loadProducts = async (): Promise<Product[]> => {
  const productsCol = collection(db, USERS_COLLECTION, getUserId(), 'products');
  const snapshot = await getDocs(productsCol);
  const products = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as Product);
  // Ordenar no cliente para incluir produtos sem createdAt
  return products.sort((a, b) => {
    // @ts-ignore
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    // @ts-ignore
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateB - dateA;
  });
};
