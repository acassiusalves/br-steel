import { adminDb } from "@/lib/firebase-admin";
import { fetchBrSteelProductsSheet } from "@/services/brsteel-products-sheet";
import type { BrSteelProduct } from "@/types/brsteel-product";
import type { DocumentData } from "firebase-admin/firestore";

const ASSOCIATIONS_COLLECTION = "brSteelProductSkuAssociations";
const KIT_ASSOCIATIONS_COLLECTION = "brSteelProductKitAssociations";
const LISTINGS_COLLECTION = "anuncios";
const PARENT_INDEX_CACHE_MS = 60_000;

export const BRSTEEL_UNMATCHED_PARENT_GROUP_KEY = "__sem_produto_mae__";

export type BrSteelSkuAssociationSource = "manual" | "bulk" | "suggested";
export type BrSteelSkuAssociationStatus = "active" | "pending" | "ignored";
export type BrSteelParentMatchSource = "exact" | BrSteelSkuAssociationSource | "none";
export type BrSteelUnmatchedReviewStatus =
  | "kit_configured"
  | "safe_match"
  | "kit_combo"
  | "needs_review"
  | "no_suggestion"
  | "without_sku";
export type BrSteelProductKitAssociationSource = "manual" | "suggested";
export type BrSteelProductKitAssociationStatus = "active" | "ignored";

export interface BrSteelSkuAssociation {
  id: string;
  parentSku: string;
  childSku: string;
  normalizedParentSku: string;
  normalizedChildSku: string;
  source: BrSteelSkuAssociationSource;
  status: BrSteelSkuAssociationStatus;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrSteelResolvedParentProduct {
  sku: string;
  normalizedSku: string;
  title: string;
  productType: string;
  material: string;
  sourceSheets: string[];
  product: BrSteelProduct;
}

export interface BrSteelParentResolution {
  parentProduct: BrSteelResolvedParentProduct | null;
  originalSku: string | null;
  normalizedSku: string | null;
  matchedSku: string | null;
  matchSource: BrSteelParentMatchSource;
  confidence: number;
  associationId: string | null;
}

export interface BrSteelProductParentIndex {
  products: BrSteelProduct[];
  productsBySku: Map<string, BrSteelResolvedParentProduct>;
  associations: BrSteelSkuAssociation[];
  associationsByChildSku: Map<string, BrSteelSkuAssociation>;
}

export interface BrSteelListingSkuLike {
  sellerSku?: string | null;
}

export interface BrSteelProductAssociationStat {
  parentSku: string;
  normalizedParentSku: string;
  productName: string;
  productType: string;
  totalListings: number;
  exactListings: number;
  manualListings: number;
  bulkListings: number;
  suggestedListings: number;
  kitListings: number;
  associatedSkus: string[];
  kitSkus: string[];
  listingSkus: string[];
}

export interface BrSteelProductAssociationSuggestion {
  parentSku: string;
  productName: string;
  productType: string;
  score: number;
  reason: string;
  suggestedQuantity: number;
}

export interface BrSteelProductKitComponent {
  parentSku: string;
  normalizedParentSku: string;
  quantity: number;
  productName: string;
  productType: string;
}

export interface BrSteelProductKitAssociation {
  id: string;
  kitSku: string;
  normalizedKitSku: string;
  source: BrSteelProductKitAssociationSource;
  status: BrSteelProductKitAssociationStatus;
  components: BrSteelProductKitComponent[];
  createdAt: string;
  updatedAt: string;
}

export interface BrSteelUnmatchedListingGroup {
  key: string;
  sellerSku: string | null;
  normalizedSku: string | null;
  sampleTitle: string | null;
  thumbnail: string | null;
  totalListings: number;
  activeListings: number;
  pausedListings: number;
  closedListings: number;
  otherStatusListings: number;
  totalStock: number;
  totalSold: number;
  priceMin: number | null;
  priceMax: number | null;
  itemIds: string[];
  reviewStatus: BrSteelUnmatchedReviewStatus;
  reviewReason: string;
  suggestions: BrSteelProductAssociationSuggestion[];
  kitComposition: BrSteelProductKitAssociation | null;
}

export interface BrSteelProductAssociationOverview {
  totalListings: number;
  listingsWithSku: number;
  listingsWithoutSku: number;
  linkedListings: number;
  exactLinkedListings: number;
  associatedLinkedListings: number;
  unlinkedListings: number;
  totalAssociations: number;
  totalKitCompositions: number;
  kitConfiguredListingGroups: number;
  kitConfiguredListings: number;
  productStats: BrSteelProductAssociationStat[];
  unmatchedListingGroups: BrSteelUnmatchedListingGroup[];
}

let parentIndexCache: {
  expiresAt: number;
  value: Promise<BrSteelProductParentIndex>;
} | null = null;

type BrSteelUnmatchedListingGroupDraft = Omit<
  BrSteelUnmatchedListingGroup,
  "reviewStatus" | "reviewReason" | "suggestions" | "kitComposition"
>;

export function normalizeBrSteelSku(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function toStringValue(value: unknown) {
  return String(value ?? "").trim();
}

function toNumberValue(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toIsoValue(value: unknown, fallback: string) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return fallback;
}

function associationDocId(normalizedChildSku: string) {
  return normalizedChildSku || `sku-${Date.now()}`;
}

function kitAssociationDocId(normalizedKitSku: string) {
  return normalizedKitSku || `kit-${Date.now()}`;
}

function normalizeKitQuantity(value: unknown) {
  const parsed = toNumberValue(value, 0);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) return null;
  const quantity = Math.trunc(parsed);
  return quantity > 0 ? quantity : null;
}

function getListingSellerSku(data: DocumentData) {
  return (
    toStringValue(data.sellerSku) ||
    toStringValue(data.seller_sku) ||
    toStringValue(data.seller_custom_field) ||
    toStringValue(data.rawItem?.seller_custom_field) ||
    toStringValue(data.rawItem?.sellerSku) ||
    toStringValue(data.rawItem?.seller_sku)
  );
}

function getListingTitle(data: DocumentData) {
  return toStringValue(data.title) || toStringValue(data.rawItem?.title);
}

function getListingThumbnail(data: DocumentData) {
  return toStringValue(data.thumbnail) || toStringValue(data.rawItem?.thumbnail);
}

function getListingStatus(data: DocumentData) {
  return toStringValue(data.status) || toStringValue(data.rawItem?.status);
}

function getListingItemId(data: DocumentData) {
  return toStringValue(data.itemId) || toStringValue(data.item_id) || toStringValue(data.rawItem?.id);
}

function getListingPrice(data: DocumentData) {
  return toNumberValue(data.price ?? data.rawItem?.price, 0);
}

function getListingStock(data: DocumentData) {
  return toNumberValue(data.availableQuantity ?? data.available_quantity ?? data.rawItem?.available_quantity, 0);
}

function getListingSold(data: DocumentData) {
  return toNumberValue(data.soldQuantity ?? data.sold_quantity ?? data.rawItem?.sold_quantity, 0);
}

function buildProductTitle(product: BrSteelProduct) {
  return [product.productType, product.material, product.color].filter(Boolean).join(" · ") || product.sku;
}

function normalizeWords(value: unknown) {
  return String(value ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function longestCommonPrefixLength(a: string, b: string) {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) {
    index += 1;
  }
  return index;
}

function longestCommonSubstringLength(a: string, b: string) {
  if (!a || !b) return 0;

  const previous = new Array(b.length + 1).fill(0);
  const current = new Array(b.length + 1).fill(0);
  let best = 0;

  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = a[row - 1] === b[column - 1] ? previous[column - 1] + 1 : 0;
      best = Math.max(best, current[column]);
    }
    previous.splice(0, previous.length, ...current);
    current.fill(0);
  }

  return best;
}

function inferSuggestedQuantityFromSku(normalizedSku: string | null, normalizedParentSku: string) {
  if (!normalizedSku || !normalizedParentSku) return 1;

  const tokenIndex = normalizedSku.indexOf(normalizedParentSku);
  if (tokenIndex < 0) return 1;

  const prefix = normalizedSku.slice(0, tokenIndex);
  const quantityMatch = prefix.match(/^(?:KIT|COMBO)(\d{1,3})$/);
  if (!quantityMatch) return 1;

  const quantity = Number(quantityMatch[1]);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function scoreAssociationSuggestion(
  group: BrSteelUnmatchedListingGroupDraft,
  parentProduct: BrSteelResolvedParentProduct
): BrSteelProductAssociationSuggestion | null {
  if (!group.normalizedSku) return null;

  let score = 0;
  let reason = "";
  const productSku = parentProduct.normalizedSku;

  if (group.normalizedSku.includes(productSku)) {
    score = 96;
    reason = "SKU do anúncio contém o SKU mãe";
  } else if (productSku.includes(group.normalizedSku)) {
    score = 88;
    reason = "SKU mãe contém o SKU do anúncio";
  } else {
    const prefixLength = longestCommonPrefixLength(group.normalizedSku, productSku);
    if (prefixLength >= 4) {
      score = Math.max(score, Math.min(82, 42 + prefixLength * 5));
      reason = "Prefixo de SKU compatível";
    }

    const substringLength = longestCommonSubstringLength(group.normalizedSku, productSku);
    if (substringLength >= 5) {
      const substringScore = Math.min(76, 34 + substringLength * 4);
      if (substringScore > score) {
        score = substringScore;
        reason = "Trecho de SKU compatível";
      }
    }
  }

  const titleWords = normalizeWords(group.sampleTitle);
  const typeWords = normalizeWords(parentProduct.productType)
    .split(" ")
    .filter((word) => word.length >= 4);
  const matchingTypeWords = typeWords.filter((word) => titleWords.includes(word));
  if (matchingTypeWords.length >= Math.min(2, typeWords.length) && matchingTypeWords.length > 0) {
    if (score > 0) {
      score = Math.min(99, score + 4);
    }
  }

  if (score < 45) return null;

  return {
    parentSku: parentProduct.sku,
    productName: parentProduct.title,
    productType: parentProduct.productType,
    score,
    reason,
    suggestedQuantity: inferSuggestedQuantityFromSku(group.normalizedSku, parentProduct.normalizedSku),
  };
}

function isLikelyKitOrComboGroup(
  group: BrSteelUnmatchedListingGroupDraft,
  suggestions: BrSteelProductAssociationSuggestion[]
) {
  const sku = group.normalizedSku ?? "";
  const title = normalizeWords(group.sampleTitle);
  const strongSuggestions = suggestions.filter((suggestion) => suggestion.score >= 90);

  return (
    sku.startsWith("KIT") ||
    sku.includes("COMBO") ||
    title.includes(" KIT ") ||
    title.startsWith("KIT ") ||
    title.includes(" COMBO ") ||
    title.includes(" CONJUNTO ") ||
    strongSuggestions.length > 1
  );
}

function classifyUnmatchedListingGroup(
  group: BrSteelUnmatchedListingGroupDraft,
  suggestions: BrSteelProductAssociationSuggestion[],
  kitComposition: BrSteelProductKitAssociation | null
): Pick<BrSteelUnmatchedListingGroup, "reviewStatus" | "reviewReason"> {
  if (!group.normalizedSku || !group.sellerSku) {
    return {
      reviewStatus: "without_sku",
      reviewReason: "Anúncio sem SKU informado",
    };
  }

  if (kitComposition && kitComposition.components.length > 0) {
    return {
      reviewStatus: "kit_configured",
      reviewReason: `${kitComposition.components.length} componente(s) configurado(s)`,
    };
  }

  if (isLikelyKitOrComboGroup(group, suggestions)) {
    return {
      reviewStatus: "kit_combo",
      reviewReason: "Possível kit ou anúncio composto",
    };
  }

  const topSuggestion = suggestions[0] ?? null;
  if (!topSuggestion) {
    return {
      reviewStatus: "no_suggestion",
      reviewReason: "Nenhum produto mãe parecido pelo SKU",
    };
  }

  const topParentSku = normalizeBrSteelSku(topSuggestion.parentSku);
  const isSkuExtension = group.normalizedSku.startsWith(topParentSku);
  if (topSuggestion.score >= 90 && isSkuExtension) {
    return {
      reviewStatus: "safe_match",
      reviewReason: "SKU do anúncio parece extensão direta do SKU mãe",
    };
  }

  return {
    reviewStatus: "needs_review",
    reviewReason: "Sugestão encontrada, mas requer conferência",
  };
}

function toResolvedParentProduct(product: BrSteelProduct): BrSteelResolvedParentProduct | null {
  const normalizedSku = normalizeBrSteelSku(product.sku);
  if (!normalizedSku) return null;

  return {
    sku: product.sku,
    normalizedSku,
    title: buildProductTitle(product),
    productType: product.productType,
    material: product.material,
    sourceSheets: product.sourceSheets,
    product,
  };
}

function mapAssociation(id: string, data: DocumentData): BrSteelSkuAssociation | null {
  const now = new Date().toISOString();
  const parentSku = toStringValue(data.parentSku);
  const childSku = toStringValue(data.childSku);
  const normalizedParentSku = normalizeBrSteelSku(data.normalizedParentSku || parentSku);
  const normalizedChildSku = normalizeBrSteelSku(data.normalizedChildSku || childSku);

  if (!parentSku || !childSku || !normalizedParentSku || !normalizedChildSku) return null;

  return {
    id,
    parentSku,
    childSku,
    normalizedParentSku,
    normalizedChildSku,
    source: data.source === "bulk" || data.source === "suggested" ? data.source : "manual",
    status: data.status === "pending" || data.status === "ignored" ? data.status : "active",
    confidence: toNumberValue(data.confidence, 1),
    createdAt: toIsoValue(data.createdAt, now),
    updatedAt: toIsoValue(data.updatedAt, now),
  };
}

function mapKitAssociation(id: string, data: DocumentData): BrSteelProductKitAssociation | null {
  const now = new Date().toISOString();
  const kitSku = toStringValue(data.kitSku);
  const normalizedKitSku = normalizeBrSteelSku(data.normalizedKitSku || kitSku);
  const rawComponents = Array.isArray(data.components) ? data.components : [];
  const components = rawComponents
    .map((component): BrSteelProductKitComponent | null => {
      const parentSku = toStringValue(component?.parentSku);
      const normalizedParentSku = normalizeBrSteelSku(component?.normalizedParentSku || parentSku);
      const quantity = normalizeKitQuantity(component?.quantity);

      if (!parentSku || !normalizedParentSku || !quantity) return null;

      return {
        parentSku,
        normalizedParentSku,
        quantity,
        productName: toStringValue(component?.productName) || parentSku,
        productType: toStringValue(component?.productType) || "Produto BR Steel",
      };
    })
    .filter((component): component is BrSteelProductKitComponent => component !== null);

  if (!kitSku || !normalizedKitSku || components.length === 0) return null;

  return {
    id,
    kitSku,
    normalizedKitSku,
    source: data.source === "suggested" ? "suggested" : "manual",
    status: data.status === "ignored" ? "ignored" : "active",
    components,
    createdAt: toIsoValue(data.createdAt, now),
    updatedAt: toIsoValue(data.updatedAt, now),
  };
}

export async function loadActiveBrSteelSkuAssociations(): Promise<BrSteelSkuAssociation[]> {
  const snapshot = await adminDb
    .collection(ASSOCIATIONS_COLLECTION)
    .where("status", "==", "active")
    .get();

  return snapshot.docs
    .map((doc) => mapAssociation(doc.id, doc.data()))
    .filter((association): association is BrSteelSkuAssociation => association !== null);
}

export async function loadActiveBrSteelKitAssociations(): Promise<BrSteelProductKitAssociation[]> {
  const snapshot = await adminDb
    .collection(KIT_ASSOCIATIONS_COLLECTION)
    .where("status", "==", "active")
    .get();

  return snapshot.docs
    .map((doc) => mapKitAssociation(doc.id, doc.data()))
    .filter((association): association is BrSteelProductKitAssociation => association !== null);
}

async function loadFreshBrSteelProductParentIndex(): Promise<BrSteelProductParentIndex> {
  const [sheetResult, associations] = await Promise.all([
    fetchBrSteelProductsSheet(),
    loadActiveBrSteelSkuAssociations(),
  ]);

  const productsBySku = new Map<string, BrSteelResolvedParentProduct>();
  for (const product of sheetResult.products) {
    const resolvedProduct = toResolvedParentProduct(product);
    if (resolvedProduct) {
      productsBySku.set(resolvedProduct.normalizedSku, resolvedProduct);
    }
  }

  const associationsByChildSku = new Map<string, BrSteelSkuAssociation>();
  for (const association of associations) {
    associationsByChildSku.set(association.normalizedChildSku, association);
  }

  return {
    products: sheetResult.products,
    productsBySku,
    associations,
    associationsByChildSku,
  };
}

export async function loadBrSteelProductParentIndex(): Promise<BrSteelProductParentIndex> {
  const now = Date.now();
  if (parentIndexCache && parentIndexCache.expiresAt > now) {
    return parentIndexCache.value;
  }

  const value = loadFreshBrSteelProductParentIndex();
  parentIndexCache = {
    expiresAt: now + PARENT_INDEX_CACHE_MS,
    value,
  };

  return value;
}

export function resolveBrSteelParentForSku(
  sellerSku: string | null | undefined,
  index: BrSteelProductParentIndex
): BrSteelParentResolution {
  const originalSku = toStringValue(sellerSku) || null;
  const normalizedSku = normalizeBrSteelSku(sellerSku);

  if (!normalizedSku) {
    return {
      parentProduct: null,
      originalSku,
      normalizedSku: null,
      matchedSku: null,
      matchSource: "none",
      confidence: 0,
      associationId: null,
    };
  }

  const exactProduct = index.productsBySku.get(normalizedSku);
  if (exactProduct) {
    return {
      parentProduct: exactProduct,
      originalSku,
      normalizedSku,
      matchedSku: exactProduct.sku,
      matchSource: "exact",
      confidence: 1,
      associationId: null,
    };
  }

  const association = index.associationsByChildSku.get(normalizedSku);
  if (association) {
    const parentProduct = index.productsBySku.get(association.normalizedParentSku) ?? null;
    if (parentProduct) {
      return {
        parentProduct,
        originalSku,
        normalizedSku,
        matchedSku: association.childSku,
        matchSource: association.source,
        confidence: association.confidence,
        associationId: association.id,
      };
    }
  }

  return {
    parentProduct: null,
    originalSku,
    normalizedSku,
    matchedSku: null,
    matchSource: "none",
    confidence: 0,
    associationId: null,
  };
}

export async function resolveBrSteelParentsForListings<T extends BrSteelListingSkuLike>(
  listings: T[]
): Promise<Array<T & {
  parentProductSku: string | null;
  parentProductName: string | null;
  parentProductType: string | null;
  parentProductMatchSource: BrSteelParentMatchSource;
  parentProductMatchedSku: string | null;
  productKitSku: string | null;
  productKitComponents: BrSteelProductKitComponent[];
}>> {
  const [index, kitAssociations] = await Promise.all([
    loadBrSteelProductParentIndex(),
    loadActiveBrSteelKitAssociations(),
  ]);
  const kitAssociationsBySku = new Map(
    kitAssociations.map((association) => [association.normalizedKitSku, association])
  );

  return listings.map((listing) => {
    const resolution = resolveBrSteelParentForSku(listing.sellerSku, index);
    const kitComposition = resolution.normalizedSku
      ? kitAssociationsBySku.get(resolution.normalizedSku) ?? null
      : null;

    return {
      ...listing,
      parentProductSku: resolution.parentProduct?.sku ?? null,
      parentProductName: resolution.parentProduct?.title ?? null,
      parentProductType: resolution.parentProduct?.productType ?? null,
      parentProductMatchSource: resolution.matchSource,
      parentProductMatchedSku: resolution.matchedSku,
      productKitSku: kitComposition?.kitSku ?? null,
      productKitComponents: kitComposition?.components ?? [],
    };
  });
}

export async function getBrSteelProductAssociationOverview(): Promise<BrSteelProductAssociationOverview> {
  const [index, listingsSnapshot, kitAssociations] = await Promise.all([
    loadBrSteelProductParentIndex(),
    adminDb.collection(LISTINGS_COLLECTION).get(),
    loadActiveBrSteelKitAssociations(),
  ]);
  const kitAssociationsBySku = new Map(
    kitAssociations.map((association) => [association.normalizedKitSku, association])
  );

  const statsBySku = new Map<string, BrSteelProductAssociationStat>();
  for (const parentProduct of index.productsBySku.values()) {
    statsBySku.set(parentProduct.normalizedSku, {
      parentSku: parentProduct.sku,
      normalizedParentSku: parentProduct.normalizedSku,
      productName: parentProduct.title,
      productType: parentProduct.productType,
      totalListings: 0,
      exactListings: 0,
      manualListings: 0,
      bulkListings: 0,
      suggestedListings: 0,
      kitListings: 0,
      associatedSkus: [],
      kitSkus: [],
      listingSkus: [],
    });
  }

  for (const association of index.associations) {
    const stat = statsBySku.get(association.normalizedParentSku);
    if (stat) {
      stat.associatedSkus.push(association.childSku);
    }
  }

  let listingsWithSku = 0;
  let listingsWithoutSku = 0;
  let linkedListings = 0;
  let exactLinkedListings = 0;
  let associatedLinkedListings = 0;
  let unlinkedListings = 0;
  const unmatchedGroupsBySku = new Map<string, BrSteelUnmatchedListingGroupDraft>();

  for (const doc of listingsSnapshot.docs) {
    const data = doc.data();
    const sellerSku = getListingSellerSku(data);
    const normalizedSku = normalizeBrSteelSku(sellerSku);

    if (!normalizedSku) {
      listingsWithoutSku += 1;
      unlinkedListings += 1;
      const key = "__sem_sku__";
      const existingGroup = unmatchedGroupsBySku.get(key);
      const title = getListingTitle(data);
      const thumbnail = getListingThumbnail(data);
      const status = getListingStatus(data);
      const price = getListingPrice(data);
      const itemId = getListingItemId(data);
      const group = existingGroup ?? {
        key,
        sellerSku: null,
        normalizedSku: null,
        sampleTitle: title || null,
        thumbnail: thumbnail || null,
        totalListings: 0,
        activeListings: 0,
        pausedListings: 0,
        closedListings: 0,
        otherStatusListings: 0,
        totalStock: 0,
        totalSold: 0,
        priceMin: null,
        priceMax: null,
        itemIds: [],
      };

      group.totalListings += 1;
      group.sampleTitle ||= title || null;
      group.thumbnail ||= thumbnail || null;
      group.totalStock += getListingStock(data);
      group.totalSold += getListingSold(data);
      group.priceMin = price ? Math.min(group.priceMin ?? price, price) : group.priceMin;
      group.priceMax = price ? Math.max(group.priceMax ?? price, price) : group.priceMax;
      if (status === "active") group.activeListings += 1;
      else if (status === "paused") group.pausedListings += 1;
      else if (status === "closed") group.closedListings += 1;
      else group.otherStatusListings += 1;
      if (itemId && !group.itemIds.includes(itemId) && group.itemIds.length < 4) group.itemIds.push(itemId);
      unmatchedGroupsBySku.set(key, group);
      continue;
    }

    listingsWithSku += 1;
    const resolution = resolveBrSteelParentForSku(sellerSku, index);

    if (!resolution.parentProduct) {
      unlinkedListings += 1;
      const key = normalizedSku;
      const existingGroup = unmatchedGroupsBySku.get(key);
      const title = getListingTitle(data);
      const thumbnail = getListingThumbnail(data);
      const status = getListingStatus(data);
      const price = getListingPrice(data);
      const itemId = getListingItemId(data);
      const group = existingGroup ?? {
        key,
        sellerSku,
        normalizedSku,
        sampleTitle: title || null,
        thumbnail: thumbnail || null,
        totalListings: 0,
        activeListings: 0,
        pausedListings: 0,
        closedListings: 0,
        otherStatusListings: 0,
        totalStock: 0,
        totalSold: 0,
        priceMin: null,
        priceMax: null,
        itemIds: [],
      };

      group.totalListings += 1;
      group.sampleTitle ||= title || null;
      group.thumbnail ||= thumbnail || null;
      group.totalStock += getListingStock(data);
      group.totalSold += getListingSold(data);
      group.priceMin = price ? Math.min(group.priceMin ?? price, price) : group.priceMin;
      group.priceMax = price ? Math.max(group.priceMax ?? price, price) : group.priceMax;
      if (status === "active") group.activeListings += 1;
      else if (status === "paused") group.pausedListings += 1;
      else if (status === "closed") group.closedListings += 1;
      else group.otherStatusListings += 1;
      if (itemId && !group.itemIds.includes(itemId) && group.itemIds.length < 4) group.itemIds.push(itemId);
      unmatchedGroupsBySku.set(key, group);
      continue;
    }

    const stat = statsBySku.get(resolution.parentProduct.normalizedSku);
    if (!stat) continue;

    linkedListings += 1;
    stat.totalListings += 1;
    stat.listingSkus.push(sellerSku);

    if (resolution.matchSource === "exact") {
      exactLinkedListings += 1;
      stat.exactListings += 1;
    } else if (resolution.matchSource === "manual") {
      associatedLinkedListings += 1;
      stat.manualListings += 1;
    } else if (resolution.matchSource === "bulk") {
      associatedLinkedListings += 1;
      stat.bulkListings += 1;
    } else if (resolution.matchSource === "suggested") {
      associatedLinkedListings += 1;
      stat.suggestedListings += 1;
    }
  }

  const parentProducts = Array.from(index.productsBySku.values());
  const unmatchedListingGroups = Array.from(unmatchedGroupsBySku.values())
    .map((group) => {
      const suggestions = parentProducts
        .map((parentProduct) => scoreAssociationSuggestion(group, parentProduct))
        .filter((suggestion): suggestion is BrSteelProductAssociationSuggestion => suggestion !== null)
        .sort((a, b) => b.score - a.score || a.parentSku.localeCompare(b.parentSku, "pt-BR"))
        .slice(0, 3);
      const kitComposition = group.normalizedSku ? kitAssociationsBySku.get(group.normalizedSku) ?? null : null;
      const review = classifyUnmatchedListingGroup(group, suggestions, kitComposition);

      return {
        ...group,
        ...review,
        suggestions,
        kitComposition,
      };
    })
    .sort((a, b) => {
      const suggestionDiff = (b.suggestions[0]?.score ?? 0) - (a.suggestions[0]?.score ?? 0);
      if (suggestionDiff !== 0) return suggestionDiff;
      const soldDiff = b.totalSold - a.totalSold;
      if (soldDiff !== 0) return soldDiff;
      const listingDiff = b.totalListings - a.totalListings;
      if (listingDiff !== 0) return listingDiff;
      return (a.sellerSku ?? "").localeCompare(b.sellerSku ?? "", "pt-BR");
    });
  let kitConfiguredListingGroups = 0;
  let kitConfiguredListings = 0;

  for (const group of unmatchedListingGroups) {
    if (!group.kitComposition) continue;

    kitConfiguredListingGroups += 1;
    kitConfiguredListings += group.totalListings;

    for (const component of group.kitComposition.components) {
      const stat = statsBySku.get(component.normalizedParentSku);
      if (!stat) continue;

      stat.kitListings += group.totalListings;
      if (group.sellerSku) {
        stat.kitSkus.push(group.sellerSku);
      }
    }
  }

  const productStats = Array.from(statsBySku.values()).map((stat) => ({
    ...stat,
    associatedSkus: Array.from(new Set(stat.associatedSkus)).sort((a, b) => a.localeCompare(b, "pt-BR")),
    kitSkus: Array.from(new Set(stat.kitSkus)).sort((a, b) => a.localeCompare(b, "pt-BR")),
    listingSkus: Array.from(new Set(stat.listingSkus)).sort((a, b) => a.localeCompare(b, "pt-BR")),
  }));

  return {
    totalListings: listingsSnapshot.size,
    listingsWithSku,
    listingsWithoutSku,
    linkedListings,
    exactLinkedListings,
    associatedLinkedListings,
    unlinkedListings,
    totalAssociations: index.associations.length,
    totalKitCompositions: kitAssociations.length,
    kitConfiguredListingGroups,
    kitConfiguredListings,
    productStats,
    unmatchedListingGroups,
  };
}

export interface SaveBrSteelSkuAssociationInput {
  parentSku: string;
  childSku: string;
  source?: BrSteelSkuAssociationSource;
  status?: BrSteelSkuAssociationStatus;
  confidence?: number;
}

export async function saveBrSteelSkuAssociations(inputs: SaveBrSteelSkuAssociationInput[]) {
  if (!inputs.length) return { saved: 0, skipped: 0, conflicts: [] as Array<{ childSku: string; parentSku: string }> };

  const [sheetResult, activeAssociations] = await Promise.all([
    fetchBrSteelProductsSheet(),
    loadActiveBrSteelSkuAssociations(),
  ]);
  const parentSkuByNormalized = new Map(
    sheetResult.products
      .map((product) => [normalizeBrSteelSku(product.sku), product.sku] as const)
      .filter(([normalizedSku]) => Boolean(normalizedSku))
  );
  const parentSkus = new Set(parentSkuByNormalized.keys());
  const activeByChildSku = new Map(activeAssociations.map((association) => [association.normalizedChildSku, association]));
  const now = new Date().toISOString();
  const batch = adminDb.batch();
  const conflicts: Array<{ childSku: string; parentSku: string }> = [];
  let saved = 0;
  let skipped = 0;

  for (const input of inputs) {
    const parentSku = toStringValue(input.parentSku);
    const childSku = toStringValue(input.childSku);
    const normalizedParentSku = normalizeBrSteelSku(parentSku);
    const normalizedChildSku = normalizeBrSteelSku(childSku);

    if (!parentSku || !childSku || !normalizedParentSku || !normalizedChildSku || !parentSkus.has(normalizedParentSku)) {
      skipped += 1;
      continue;
    }
    if (normalizedChildSku === normalizedParentSku) {
      skipped += 1;
      continue;
    }

    const exactParentSku = parentSkuByNormalized.get(normalizedChildSku);
    if (exactParentSku) {
      conflicts.push({ childSku, parentSku: exactParentSku });
      continue;
    }

    const existing = activeByChildSku.get(normalizedChildSku);
    if (existing && existing.normalizedParentSku !== normalizedParentSku) {
      conflicts.push({ childSku, parentSku: existing.parentSku });
      continue;
    }

    const ref = adminDb.collection(ASSOCIATIONS_COLLECTION).doc(associationDocId(normalizedChildSku));
    batch.set(
      ref,
      {
        parentSku,
        childSku,
        normalizedParentSku,
        normalizedChildSku,
        source: input.source ?? "manual",
        status: input.status ?? "active",
        confidence: input.confidence ?? 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      },
      { merge: true }
    );
    activeByChildSku.set(normalizedChildSku, {
      id: ref.id,
      parentSku,
      childSku,
      normalizedParentSku,
      normalizedChildSku,
      source: input.source ?? "manual",
      status: input.status ?? "active",
      confidence: input.confidence ?? 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    saved += 1;
  }

  if (saved > 0) {
    await batch.commit();
    parentIndexCache = null;
  }

  return { saved, skipped, conflicts };
}

export interface SaveBrSteelProductKitCompositionInput {
  kitSku: string;
  components: Array<{
    parentSku: string;
    quantity: number;
  }>;
  source?: BrSteelProductKitAssociationSource;
}

export async function saveBrSteelProductKitComposition(input: SaveBrSteelProductKitCompositionInput) {
  const kitSku = toStringValue(input.kitSku);
  const normalizedKitSku = normalizeBrSteelSku(kitSku);
  const requestedComponents = Array.isArray(input.components) ? input.components : [];

  if (!kitSku || !normalizedKitSku) {
    return { saved: 0, skipped: requestedComponents.length, components: [] as BrSteelProductKitComponent[] };
  }

  const index = await loadBrSteelProductParentIndex();
  const componentsBySku = new Map<string, BrSteelProductKitComponent>();
  let skipped = 0;

  for (const component of requestedComponents) {
    const parentSku = toStringValue(component.parentSku);
    const normalizedParentSku = normalizeBrSteelSku(parentSku);
    const quantity = normalizeKitQuantity(component.quantity);
    const parentProduct = index.productsBySku.get(normalizedParentSku);

    if (!parentSku || !normalizedParentSku || !quantity || !parentProduct || normalizedParentSku === normalizedKitSku) {
      skipped += 1;
      continue;
    }

    const existing = componentsBySku.get(normalizedParentSku);
    if (existing) {
      existing.quantity += quantity;
      continue;
    }

    componentsBySku.set(normalizedParentSku, {
      parentSku: parentProduct.sku,
      normalizedParentSku,
      quantity,
      productName: parentProduct.title,
      productType: parentProduct.productType,
    });
  }

  const components = Array.from(componentsBySku.values()).sort((a, b) => a.parentSku.localeCompare(b.parentSku, "pt-BR"));
  if (components.length === 0) {
    return { saved: 0, skipped, components };
  }

  const now = new Date().toISOString();
  const ref = adminDb.collection(KIT_ASSOCIATIONS_COLLECTION).doc(kitAssociationDocId(normalizedKitSku));
  const existing = await ref.get();
  const existingAssociation = existing.exists ? mapKitAssociation(existing.id, existing.data() ?? {}) : null;

  await ref.set(
    {
      kitSku,
      normalizedKitSku,
      source: input.source ?? "manual",
      status: "active",
      components,
      createdAt: existingAssociation?.createdAt ?? now,
      updatedAt: now,
    },
    { merge: true }
  );

  return { saved: 1, skipped, components };
}

export async function approveSafeBrSteelSkuAssociations() {
  const overview = await getBrSteelProductAssociationOverview();
  const safeInputs = overview.unmatchedListingGroups
    .filter((group) => group.reviewStatus === "safe_match" && group.sellerSku && group.suggestions[0])
    .map((group) => ({
      parentSku: group.suggestions[0].parentSku,
      childSku: group.sellerSku as string,
      source: "suggested" as const,
      confidence: group.suggestions[0].score / 100,
    }));

  const result = await saveBrSteelSkuAssociations(safeInputs);

  return {
    reviewedGroups: overview.unmatchedListingGroups.length,
    attempted: safeInputs.length,
    saved: result.saved,
    skipped: result.skipped,
    conflicts: result.conflicts,
  };
}

export async function replaceBrSteelSkuAssociationsForParent(input: {
  parentSku: string;
  childSkus: string[];
  source?: BrSteelSkuAssociationSource;
}) {
  const parentSku = toStringValue(input.parentSku);
  const normalizedParentSku = normalizeBrSteelSku(parentSku);
  const requestedChildSkus = Array.from(new Set(input.childSkus.map(toStringValue).filter(Boolean)));
  const requestedByNormalizedSku = new Map(
    requestedChildSkus
      .map((childSku) => [normalizeBrSteelSku(childSku), childSku] as const)
      .filter(([normalizedChildSku]) => normalizedChildSku && normalizedChildSku !== normalizedParentSku)
  );

  if (!parentSku || !normalizedParentSku) {
    return { saved: 0, removed: 0, skipped: requestedChildSkus.length, conflicts: [] as Array<{ childSku: string; parentSku: string }> };
  }

  const [sheetResult, activeAssociations] = await Promise.all([
    fetchBrSteelProductsSheet(),
    loadActiveBrSteelSkuAssociations(),
  ]);
  const parentSkuByNormalized = new Map(
    sheetResult.products
      .map((product) => [normalizeBrSteelSku(product.sku), product.sku] as const)
      .filter(([normalizedSku]) => Boolean(normalizedSku))
  );
  if (!parentSkuByNormalized.has(normalizedParentSku)) {
    return { saved: 0, removed: 0, skipped: requestedChildSkus.length, conflicts: [] as Array<{ childSku: string; parentSku: string }> };
  }

  const activeByChildSku = new Map(activeAssociations.map((association) => [association.normalizedChildSku, association]));
  const existingForParent = activeAssociations.filter((association) => association.normalizedParentSku === normalizedParentSku);
  const conflicts: Array<{ childSku: string; parentSku: string }> = [];
  const now = new Date().toISOString();
  const batch = adminDb.batch();
  let saved = 0;
  let removed = 0;
  let skipped = requestedChildSkus.length - requestedByNormalizedSku.size;

  for (const [normalizedChildSku, childSku] of requestedByNormalizedSku.entries()) {
    const exactParentSku = parentSkuByNormalized.get(normalizedChildSku);
    if (exactParentSku) {
      conflicts.push({ childSku, parentSku: exactParentSku });
      continue;
    }

    const existing = activeByChildSku.get(normalizedChildSku);
    if (existing && existing.normalizedParentSku !== normalizedParentSku) {
      conflicts.push({ childSku, parentSku: existing.parentSku });
      continue;
    }

    const ref = adminDb.collection(ASSOCIATIONS_COLLECTION).doc(associationDocId(normalizedChildSku));
    batch.set(
      ref,
      {
        parentSku,
        childSku,
        normalizedParentSku,
        normalizedChildSku,
        source: input.source ?? existing?.source ?? "manual",
        status: "active",
        confidence: 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      },
      { merge: true }
    );
    saved += 1;
  }

  for (const association of existingForParent) {
    if (requestedByNormalizedSku.has(association.normalizedChildSku)) continue;

    const ref = adminDb.collection(ASSOCIATIONS_COLLECTION).doc(association.id);
    batch.set(
      ref,
      {
        status: "ignored",
        updatedAt: now,
      },
      { merge: true }
    );
    removed += 1;
  }

  if (saved > 0 || removed > 0) {
    await batch.commit();
    parentIndexCache = null;
  }

  return { saved, removed, skipped, conflicts };
}
