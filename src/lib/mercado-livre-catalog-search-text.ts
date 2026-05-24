import type { MercadoLivreSearchItem } from '@/types/mercado-livre-catalog-search';

type MatchType = 'high' | 'medium' | 'low' | 'none';

const STOP_WORDS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'para',
  'com',
  'sem',
  'e',
  'ou',
  'em',
  'a',
  'o',
  'as',
  'os',
  'um',
  'uma',
  'gb',
  'ram',
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function pushString(values: string[], value: unknown) {
  if (typeof value !== 'string') return;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized) values.push(normalized);
}

function pushRecordStrings(values: string[], record: Record<string, unknown>, keys: string[]) {
  keys.forEach((key) => pushString(values, record[key]));
}

function pushAttributeStrings(values: string[], rawAttributes: unknown) {
  if (!Array.isArray(rawAttributes)) return;

  rawAttributes.forEach((entry) => {
    const attribute = asRecord(entry);
    pushRecordStrings(values, attribute, ['id', 'name', 'value_id', 'value_name', 'valueName']);

    const rawValues = Array.isArray(attribute.values) ? attribute.values : [];
    rawValues.forEach((rawValue) => {
      const value = asRecord(rawValue);
      pushRecordStrings(values, value, ['id', 'name', 'value_id', 'value_name']);
    });
  });
}

function getMarketplaceDataText(item: MercadoLivreSearchItem) {
  const data = item.marketplaceData;
  const values: string[] = [];
  const catalogProduct = asRecord(data.catalogProduct);
  const referenceOffer = asRecord(data.referenceOffer);
  const referenceItem = asRecord(data.referenceItem);
  const seller = asRecord(data.seller);
  const category = asRecord(data.category);

  pushRecordStrings(values, catalogProduct, ['id', 'name', 'title', 'status', 'domain_id', 'family_name', 'category_id']);
  pushAttributeStrings(values, catalogProduct.attributes);

  [referenceOffer, referenceItem].forEach((record) => {
    pushRecordStrings(values, record, [
      'id',
      'title',
      'status',
      'condition',
      'listing_type_id',
      'catalog_product_id',
      'category_id',
      'official_store_name',
    ]);
    pushAttributeStrings(values, record.attributes);
    pushRecordStrings(values, asRecord(record.shipping), ['mode', 'logistic_type', 'dimensions']);
  });

  pushRecordStrings(values, seller, ['id', 'nickname', 'site_id']);
  pushRecordStrings(values, category, ['id', 'name', 'permalink']);

  return values;
}

export function normalizeMercadoLivreSearchText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function getMercadoLivreSearchableText(item: MercadoLivreSearchItem) {
  return [
    item.title,
    item.id,
    item.referenceItemId,
    item.catalogProductId,
    item.brand,
    item.model,
    item.sellerNickname,
    item.sellerCity,
    item.sellerState,
    item.officialStoreName,
    item.listingTypeId,
    item.shippingMode,
    item.logisticType,
    item.shippingDimensions,
    item.categoryInfo?.path,
    ...item.shippingTags,
    ...item.categoryTrends.map((trend) => trend.keyword),
    ...item.attributes.flatMap((attribute) => [attribute.id, attribute.name, attribute.valueId || '', attribute.valueName]),
    ...item.questions.flatMap((question) => [question.text, question.answer?.text || '']),
    ...getMarketplaceDataText(item),
  ]
    .filter(Boolean)
    .join(' ');
}

export function calculateMercadoLivreSearchTermMatchScore(
  searchTerm: string,
  item: MercadoLivreSearchItem
): { score: number; type: MatchType } {
  const searchWords = normalizeMercadoLivreSearchText(searchTerm)
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

  if (searchWords.length === 0) return { score: 0, type: 'none' };

  const titleText = normalizeMercadoLivreSearchText(item.title || '');
  const modelText = normalizeMercadoLivreSearchText(item.model || '');
  const brandText = normalizeMercadoLivreSearchText(item.brand || '');
  const enrichedText = normalizeMercadoLivreSearchText(getMercadoLivreSearchableText(item));

  const modelMatches = searchWords.filter((word) => modelText.includes(word)).length;
  const titleMatches = searchWords.filter((word) => titleText.includes(word)).length;
  const brandMatches = searchWords.filter((word) => brandText.includes(word)).length;
  const enrichedMatches = searchWords.filter((word) => enrichedText.includes(word)).length;

  let score = 0;
  if (modelMatches > 0) score += Math.min(30, (modelMatches / searchWords.length) * 30);
  if (brandMatches > 0) score += Math.min(15, (brandMatches / searchWords.length) * 15);
  if (titleMatches > 0) score += Math.min(45, (titleMatches / searchWords.length) * 45);
  if (enrichedMatches > 0) score += Math.min(10, (enrichedMatches / searchWords.length) * 10);

  const type: MatchType = score >= 70 ? 'high' : score >= 40 ? 'medium' : score > 0 ? 'low' : 'none';
  return { score, type };
}
