import { adminDb } from '@/lib/firebase-admin';
import type { MlChatConversationDoc } from '@/lib/ml-chat-types';
import type { MlQuestionDoc } from '@/lib/ml-question-types';
import type { MlListingCacheRow } from '@/services/ml-listings-cache';

const LISTINGS_COLLECTION = 'anuncios';

export type MlSupportOrderItemContext = {
  itemId: string | null;
  title: string | null;
  sellerSku: string | null;
  quantity: number | null;
  unitPrice: number | null;
  totalAmount: number | null;
};

export type MlSupportListingContext = {
  itemId: string;
  title: string | null;
  sellerSku: string | null;
  status: string | null;
  listingTypeId: string | null;
  price: number | null;
  availableQuantity: number | null;
  soldQuantity: number | null;
  visitsLast30Days: number | null;
  visitsTotal: number | null;
  qualityScore: number | null;
  health: number | null;
  thumbnail: string | null;
  permalink: string | null;
  logisticType: string | null;
  freeShipping: boolean | null;
  catalogProductId: string | null;
  adsCost: number | null;
  adsRoas: number | null;
  adsAcos: number | null;
  adsUnitsQuantity: number | null;
  adsClicks: number | null;
  adsPrints: number | null;
  adsCtr: number | null;
};

export type MlSupportContextAlert = {
  id: string;
  severity: 'info' | 'warning' | 'critical' | 'positive';
  title: string;
  description: string;
};

export type MlSupportContext = {
  source: 'conversation' | 'question';
  matchedBy: 'itemId' | 'sku' | 'title' | 'fallback' | null;
  primaryItemId: string | null;
  listing: MlSupportListingContext | null;
  items: Array<MlSupportOrderItemContext & { listing: MlSupportListingContext | null }>;
  order: {
    packId?: string | null;
    orderIds: string[];
    shippingId?: string | number | null;
    claimId?: string | number | null;
    totalAmount?: number | null;
    status?: string | null;
    createdAt?: string | null;
  };
  customer: {
    buyerId?: string | number | null;
    buyerName?: string | null;
    buyerEmail?: string | null;
  };
  alerts: MlSupportContextAlert[];
};

function asString(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function asNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function uniqueStrings(values: Array<unknown>): string[] {
  return Array.from(new Set(values.map(asString).filter(Boolean) as string[]));
}

function normalizeQualityScore(row: MlListingCacheRow | null | undefined): number | null {
  const raw = row?.performanceScore ?? row?.health ?? null;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
}

function toListingContext(row: MlListingCacheRow | null | undefined): MlSupportListingContext | null {
  if (!row?.itemId) return null;
  return {
    itemId: row.itemId,
    title: row.title ?? null,
    sellerSku: row.sellerSku ?? null,
    status: row.status ?? null,
    listingTypeId: row.listingTypeId ?? null,
    price: row.price ?? null,
    availableQuantity: row.availableQuantity ?? null,
    soldQuantity: row.soldQuantity ?? null,
    visitsLast30Days: row.visitsLast30Days ?? null,
    visitsTotal: row.visitsTotal ?? null,
    qualityScore: normalizeQualityScore(row),
    health: row.health ?? null,
    thumbnail: row.thumbnail ?? null,
    permalink: row.permalink ?? null,
    logisticType: row.logisticType ?? null,
    freeShipping: row.freeShipping ?? null,
    catalogProductId: row.catalogProductId ?? null,
    adsCost: row.adsCost ?? null,
    adsRoas: row.adsRoas ?? null,
    adsAcos: row.adsAcos ?? null,
    adsUnitsQuantity: row.adsUnitsQuantity ?? null,
    adsClicks: row.adsClicks ?? null,
    adsPrints: row.adsPrints ?? null,
    adsCtr: row.adsCtr ?? null,
  };
}

async function loadListingByItemId(
  accountId: string | null | undefined,
  itemId: string | null | undefined,
): Promise<MlListingCacheRow | null> {
  if (!accountId || !itemId) return null;
  const snap = await adminDb.collection(LISTINGS_COLLECTION).doc(`${accountId}:${itemId}`).get();
  if (!snap.exists) return null;
  return snap.data() as MlListingCacheRow;
}

async function loadListingBySku(
  accountId: string | null | undefined,
  sellerSku: string | null | undefined,
): Promise<MlListingCacheRow | null> {
  if (!accountId || !sellerSku) return null;
  const snap = await adminDb
    .collection(LISTINGS_COLLECTION)
    .where('accountId', '==', accountId)
    .where('sellerSku', '==', sellerSku)
    .limit(1)
    .get();
  return (snap.docs[0]?.data() as MlListingCacheRow | undefined) || null;
}

async function loadListingByTitle(
  accountId: string | null | undefined,
  title: string | null | undefined,
): Promise<MlListingCacheRow | null> {
  if (!accountId || !title) return null;
  const snap = await adminDb
    .collection(LISTINGS_COLLECTION)
    .where('title', '==', title)
    .limit(5)
    .get();

  const exactAccount = snap.docs
    .map((doc) => doc.data() as MlListingCacheRow)
    .find((row) => row.accountId === accountId);
  return exactAccount || (snap.docs[0]?.data() as MlListingCacheRow | undefined) || null;
}

async function resolveListings(input: {
  accountId: string;
  itemIds: string[];
  skus: string[];
  titles?: string[];
}): Promise<{ listingsByItemId: Map<string, MlSupportListingContext>; primary: MlSupportListingContext | null; matchedBy: MlSupportContext['matchedBy'] }> {
  const listingsByItemId = new Map<string, MlSupportListingContext>();
  let primary: MlSupportListingContext | null = null;
  let matchedBy: MlSupportContext['matchedBy'] = null;

  for (const itemId of input.itemIds) {
    const listing = toListingContext(await loadListingByItemId(input.accountId, itemId));
    if (listing) {
      listingsByItemId.set(listing.itemId, listing);
      if (!primary) {
        primary = listing;
        matchedBy = 'itemId';
      }
    }
  }

  if (!primary) {
    for (const sku of input.skus) {
      const listing = toListingContext(await loadListingBySku(input.accountId, sku));
      if (listing) {
        listingsByItemId.set(listing.itemId, listing);
        primary = listing;
        matchedBy = 'sku';
        break;
      }
    }
  }

  if (!primary) {
    for (const title of input.titles || []) {
      const listing = toListingContext(await loadListingByTitle(input.accountId, title));
      if (listing) {
        listingsByItemId.set(listing.itemId, listing);
        primary = listing;
        matchedBy = 'title';
        break;
      }
    }
  }

  return { listingsByItemId, primary, matchedBy };
}

function buildAlerts(listing: MlSupportListingContext | null): MlSupportContextAlert[] {
  if (!listing) {
    return [
      {
        id: 'no-listing-context',
        severity: 'warning',
        title: 'Anuncio nao cruzado',
        description: 'Nao encontramos este item no cache local de anuncios. Sincronize os anuncios para enriquecer o atendimento.',
      },
    ];
  }

  const alerts: MlSupportContextAlert[] = [];
  if (listing.status && listing.status !== 'active') {
    alerts.push({
      id: 'listing-not-active',
      severity: 'warning',
      title: 'Anuncio nao ativo',
      description: `Status atual no Mercado Livre: ${listing.status}.`,
    });
  }
  if ((listing.availableQuantity ?? 0) <= 0) {
    alerts.push({
      id: 'no-stock',
      severity: 'critical',
      title: 'Sem estoque no ML',
      description: 'O anuncio esta sem quantidade disponivel no Mercado Livre.',
    });
  } else if ((listing.availableQuantity ?? 0) <= 3) {
    alerts.push({
      id: 'low-stock',
      severity: 'warning',
      title: 'Estoque baixo',
      description: `Restam ${listing.availableQuantity} unidade(s) no anuncio.`,
    });
  }
  if (listing.qualityScore !== null && listing.qualityScore < 60) {
    alerts.push({
      id: 'low-quality',
      severity: 'warning',
      title: 'Qualidade baixa',
      description: `Qualidade estimada do anuncio em ${listing.qualityScore}%.`,
    });
  }
  if ((listing.visitsLast30Days ?? 0) === 0 && listing.status === 'active') {
    alerts.push({
      id: 'no-visits',
      severity: 'info',
      title: 'Sem visitas recentes',
      description: 'O anuncio nao registrou visitas nos ultimos 30 dias no cache local.',
    });
  }
  if ((listing.adsCost ?? 0) >= 50 && (listing.adsUnitsQuantity ?? 0) === 0) {
    alerts.push({
      id: 'ads-no-sales',
      severity: 'critical',
      title: 'Ads com gasto sem venda',
      description: 'Houve investimento em Ads no periodo sincronizado sem unidades atribuidas.',
    });
  }
  if (alerts.length === 0) {
    alerts.push({
      id: 'listing-ok',
      severity: 'positive',
      title: 'Contexto do anuncio OK',
      description: 'Nao ha alertas criticos no cache local deste anuncio.',
    });
  }
  return alerts;
}

export async function buildConversationSupportContext(
  conv: MlChatConversationDoc,
): Promise<MlSupportContext> {
  const rawItems = Array.isArray(conv.items) ? conv.items : [];
  const legacyTitles = uniqueStrings(Array.isArray(conv.itemTitles) ? conv.itemTitles : []);
  const itemIds = uniqueStrings([
    ...(Array.isArray((conv as any).itemIds) ? (conv as any).itemIds : []),
    ...rawItems.map((item: any) => item?.itemId),
  ]);
  const skus = uniqueStrings(rawItems.map((item: any) => item?.sellerSku));
  const titles = uniqueStrings([
    ...rawItems.map((item: any) => item?.title),
    ...legacyTitles,
  ]);
  const resolved = await resolveListings({
    accountId: conv.accountId,
    itemIds,
    skus,
    titles,
  });

  const items = rawItems.map((item: any) => {
    const itemId = asString(item?.itemId);
    const listing = itemId ? resolved.listingsByItemId.get(itemId) || null : null;
    return {
      itemId,
      title: asString(item?.title),
      sellerSku: asString(item?.sellerSku),
      quantity: asNumber(item?.quantity),
      unitPrice: asNumber(item?.unitPrice),
      totalAmount: asNumber(item?.totalAmount),
      listing,
    };
  });

  if (items.length === 0 && resolved.primary) {
    items.push({
      itemId: resolved.primary.itemId,
      title: resolved.primary.title,
      sellerSku: resolved.primary.sellerSku,
      quantity: null,
      unitPrice: resolved.primary.price,
      totalAmount: null,
      listing: resolved.primary,
    });
  }

  if (items.length === 0 && legacyTitles.length > 0) {
    items.push({
      itemId: resolved.primary?.itemId || null,
      title: legacyTitles[0],
      sellerSku: resolved.primary?.sellerSku || null,
      quantity: null,
      unitPrice: resolved.primary?.price ?? null,
      totalAmount: null,
      listing: resolved.primary,
    });
  }

  const fallbackListing: MlSupportListingContext | null = resolved.primary || (titles[0]
    ? {
        itemId: itemIds[0] || 'sem-item-id',
        title: titles[0],
        sellerSku: skus[0] || null,
        status: null,
        listingTypeId: null,
        price: null,
        availableQuantity: null,
        soldQuantity: null,
        visitsLast30Days: null,
        visitsTotal: null,
        qualityScore: null,
        health: null,
        thumbnail: null,
        permalink: null,
        logisticType: null,
        freeShipping: null,
        catalogProductId: null,
        adsCost: null,
        adsRoas: null,
        adsAcos: null,
        adsUnitsQuantity: null,
        adsClicks: null,
        adsPrints: null,
        adsCtr: null,
      }
    : null);
  const alerts = resolved.primary
    ? buildAlerts(resolved.primary)
    : fallbackListing
      ? [
          {
            id: 'partial-conversation-context',
            severity: 'info' as const,
            title: 'Dados parciais do produto',
            description: 'Temos o produto salvo na conversa, mas as metricas dependem do cruzamento com o cache local de anuncios.',
          },
        ]
      : buildAlerts(null);

  return {
    source: 'conversation',
    matchedBy: resolved.matchedBy || (fallbackListing ? 'fallback' : null),
    primaryItemId: fallbackListing?.itemId || itemIds[0] || null,
    listing: fallbackListing,
    items,
    order: {
      packId: conv.packId,
      orderIds: Array.isArray(conv.orderIds) ? conv.orderIds : [],
      shippingId: conv.shippingId ?? null,
      claimId: conv.claimId ?? null,
      totalAmount: asNumber((conv as any).orderTotalAmount),
      status: asString((conv as any).orderStatus),
      createdAt: asString((conv as any).orderCreatedAt),
    },
    customer: {
      buyerId: conv.buyerId ?? null,
      buyerName: conv.buyerName ?? null,
      buyerEmail: conv.buyerEmail ?? null,
    },
    alerts,
  };
}

export async function buildQuestionSupportContext(
  question: MlQuestionDoc,
): Promise<MlSupportContext> {
  const itemId = asString(question.itemId);
  const resolved = await resolveListings({
    accountId: question.accountId,
    itemIds: itemId ? [itemId] : [],
    skus: [],
    titles: question.itemTitle ? [question.itemTitle] : [],
  });

  const fallbackListing: MlSupportListingContext | null = resolved.primary || (itemId
    ? {
        itemId,
        title: question.itemTitle ?? itemId,
        sellerSku: null,
        status: null,
        listingTypeId: null,
        price: null,
        availableQuantity: null,
        soldQuantity: null,
        visitsLast30Days: null,
        visitsTotal: null,
        qualityScore: null,
        health: null,
        thumbnail: question.thumbnail ?? null,
        permalink: question.itemPermalink ?? null,
        logisticType: null,
        freeShipping: null,
        catalogProductId: null,
        adsCost: null,
        adsRoas: null,
        adsAcos: null,
        adsUnitsQuantity: null,
        adsClicks: null,
        adsPrints: null,
        adsCtr: null,
      }
	    : null);

  const alerts = resolved.primary
    ? buildAlerts(fallbackListing)
    : fallbackListing
      ? [
          {
            id: 'partial-listing-context',
            severity: 'info' as const,
            title: 'Dados parciais do anuncio',
            description: 'Temos os dados da pergunta, mas as metricas do anuncio dependem do cache local de anuncios.',
          },
        ]
      : buildAlerts(null);

  return {
    source: 'question',
    matchedBy: resolved.matchedBy || (fallbackListing ? 'fallback' : null),
    primaryItemId: fallbackListing?.itemId || itemId || null,
    listing: fallbackListing,
    items: fallbackListing
      ? [
          {
            itemId: fallbackListing.itemId,
            title: fallbackListing.title,
            sellerSku: fallbackListing.sellerSku,
            quantity: null,
            unitPrice: fallbackListing.price,
            totalAmount: null,
            listing: fallbackListing,
          },
        ]
      : [],
    order: { orderIds: [] },
    customer: {
      buyerId: question.buyerId ?? null,
      buyerName: question.buyerName ?? null,
      buyerEmail: question.buyerEmail ?? null,
    },
    alerts,
  };
}
