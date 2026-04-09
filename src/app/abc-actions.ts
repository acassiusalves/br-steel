'use server';

// Server actions for the Curva ABC report.
// Lives in its own file to avoid bloating src/app/actions.ts.

import {
  groupProductsFlow,
  type GroupProductsInput,
  type GroupProductsOutput,
} from '@/ai/flows/group-products';
import {
  saveProductGroups,
  type NewProductGroupInput,
} from '@/services/product-groups-service';
import { MAX_PRODUCTS_PER_CHUNK } from '@/lib/abc-constants';

const FLOW_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label}: tempo esgotado (${ms}ms)`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/**
 * Sends a single chunk of SKUs to Gemini (via the Genkit flow) and returns
 * the suggested groups for that chunk only. The caller is responsible for
 * splitting large lists into chunks of at most `MAX_PRODUCTS_PER_CHUNK`.
 *
 * Has one automatic retry on failure.
 */
export async function suggestProductGroupsChunkAction(
  input: GroupProductsInput
): Promise<GroupProductsOutput> {
  if (!input?.products?.length || input.products.length < 2) {
    return { groups: [] };
  }

  // Hard cap in case a misbehaving caller sends a bigger list.
  const products = input.products.slice(0, MAX_PRODUCTS_PER_CHUNK);

  const attempt = async () =>
    withTimeout(
      groupProductsFlow({ products }),
      FLOW_TIMEOUT_MS,
      'Gemini flow'
    );

  try {
    return await attempt();
  } catch (firstErr) {
    console.warn(
      '[abc-actions] chunk failed, retrying once:',
      firstErr instanceof Error ? firstErr.message : firstErr
    );
    try {
      return await attempt();
    } catch (secondErr) {
      console.error('[abc-actions] chunk failed after retry:', secondErr);
      throw new Error(
        secondErr instanceof Error
          ? `Falha ao consultar o Gemini: ${secondErr.message}`
          : 'Falha ao consultar o Gemini.'
      );
    }
  }
}

/**
 * Persists groups approved by the user in the review modal.
 * Returns the ids of the created Firestore documents.
 */
export async function commitProductGroupsAction(
  groups: NewProductGroupInput[]
): Promise<{ savedIds: string[]; savedCount: number }> {
  const valid = (groups ?? []).filter(
    (g) => g && g.canonicalName?.trim() && Array.isArray(g.skus) && g.skus.length >= 2
  );
  if (!valid.length) {
    return { savedIds: [], savedCount: 0 };
  }
  const savedIds = await saveProductGroups(
    valid.map((g) => ({ ...g, createdBy: g.createdBy ?? 'ai' }))
  );
  return { savedIds, savedCount: savedIds.length };
}
