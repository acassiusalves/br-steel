'use server';

import { getMlCredentialsByIdAdmin } from '@/services/firestore-admin';
import type { MercadoLivreCredentials, CreateListingPayload, MyItem } from '@/lib/types';
import { adminDb } from '@/lib/firebase-admin';
import { getShippingCostFor1To2Kg } from '@/lib/utils';
import { getStockRange, getStockLevel, STOCK_RANGES } from '@/lib/ml-utils';


type MlTokenResponse = {
  access_token: string;
  expires_in: number; // em segundos (geralmente ~21600 = 6h)
};

// Agora o cache guarda tokens por conta
const _tokenCache: Record<string, { token: string; expiresAt: number }> = {};
const TOKEN_LIFETIME_MS = 6 * 60 * 60 * 1000; // 6 horas em ms

export async function generateNewAccessToken(creds: {
    appId: string;
    clientSecret: string;
    refreshToken: string;
}): Promise<string> {
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: creds.appId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
    });

    const r = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        cache: 'no-store',
    });

    if (!r.ok) {
        const msg = await r.text();
        console.error("ML Token Generation Error:", msg);
        throw new Error(`Falha ao renovar token do Mercado Livre: ${msg}`);
    }

    const j = await r.json() as MlTokenResponse;
    return j.access_token;
}

export async function getMlToken(accountIdentifier?: string): Promise<string> {
  // CORREÇÃO: Usa o ID fornecido ou o fallback para a conta principal 'BtAEb2czqoWWZnNwUkRq'
  const accountIdToUse = accountIdentifier || "BtAEb2czqoWWZnNwUkRq";
  const cacheKey = accountIdToUse;
  
  const cached = _tokenCache[cacheKey];

  if (cached && Date.now() < cached.expiresAt - 60_000) { // 60s buffer
    return cached.token;
  }

  // A função getMlCredentialsByIdAdmin busca pelo ID do documento na coleção 'mercadoLivreAccounts' usando Admin SDK
  console.log(`[getMlToken] Buscando credenciais para conta ${accountIdToUse}...`);
  const creds = await getMlCredentialsByIdAdmin(accountIdToUse);

  if (!creds) {
    throw new Error(`Credenciais para a conta ID '${cacheKey}' do Mercado Livre não foram encontradas.`);
  }
  
  // Tenta renovar o token SEMPRE que possível
  const appId = creds.appId || creds.clientId; // Suporta ambos os nomes de campo

  if (appId && creds.clientSecret && creds.refreshToken) {
    try {
      const token = await generateNewAccessToken({
        appId: appId,
        clientSecret: creds.clientSecret,
        refreshToken: creds.refreshToken,
      });
      _tokenCache[cacheKey] = {
        token: token,
        expiresAt: Date.now() + TOKEN_LIFETIME_MS,
      };
      return token;
    } catch(e) {
      console.error("Falha ao renovar o token, usando o accessToken do banco de dados como fallback.", e);
      if (creds.accessToken) {
        _tokenCache[cacheKey] = {
          token: creds.accessToken,
          expiresAt: Date.now() + TOKEN_LIFETIME_MS,
        };
        return creds.accessToken;
      }
      throw new Error("Não foi possível obter um token de acesso válido.");
    }
  }

  // Se não tiver refresh token mas tiver um access token, usa ele como último recurso
  if (creds.accessToken) {
    _tokenCache[cacheKey] = {
      token: creds.accessToken,
      expiresAt: Date.now() + TOKEN_LIFETIME_MS,
    };
    return creds.accessToken;
  }

  throw new Error(`Credenciais para a conta '${cacheKey}' do ML estão incompletas. Verifique clientId (ou appId), clientSecret e refreshToken.`);
}


export async function searchMercadoLivreProducts(query: string, limit: number = 20): Promise<any[]> {
    const token = await getMlToken(); // Usa a conta primária para buscas
    const url = new URL("https://api.mercadolibre.com/sites/MLB/search");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));
    
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Erro na API do Mercado Livre: ${errorData.message}`);
    }
    
    const data = await response.json();
    return data.results || [];
}

/** Se já existir no arquivo, mantenha. Só certifique-se de exportar. */
export async function getSellersReputation(
  sellerIds: number[],
  token: string
): Promise<Record<number, any>> {
  if (!sellerIds?.length) return {};
  const uniq = Array.from(new Set(sellerIds)).filter(Boolean);

  // consulta em lotes simples
  const out: Record<number, any> = {};
  const CONCURRENCY = 8;
  for (let i = 0; i < uniq.length; i += CONCURRENCY) {
    const batch = uniq.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (sid) => {
        const r = await fetch(`https://api.mercadolibre.com/users/${sid}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!r.ok) return;
        const j = await r.json();
        out[sid] = {
          nickname: j?.nickname ?? null,
          level_id: j?.seller_reputation?.level_id ?? null,
          power_seller_status: j?.seller_reputation?.power_seller_status ?? null,
          metrics: {
            claims_rate: j?.seller_reputation?.metrics?.claims_rate ?? 0,
            cancellations_rate: j?.seller_reputation?.metrics?.cancellations_rate ?? 0,
            delayed_rate: j?.seller_reputation?.metrics?.delayed_rate ?? 0,
          },
        };
      })
    );
  }
  return out;
}


const ML_API_BASE = "https://api.mercadolibre.com";


export async function createListingFromCatalog(payload: CreateListingPayload, accessToken: string) {
    try {
        const itemPayload = {
            site_id: payload.site_id,
            category_id: payload.category_id,
            currency_id: payload.currency_id,
            available_quantity: payload.available_quantity,
            buying_mode: payload.buying_mode,
            pictures: payload.pictures,
            sale_terms: payload.sale_terms,
            attributes: payload.attributes,
            catalog_product_id: payload.catalog_product_id,
            catalog_listing: payload.catalog_listing,
            shipping: payload.shipping,
            price: payload.price,
            listing_type_id: payload.listing_type_id,
            ...(payload.title && { title: payload.title }),
        };

        const createItemUrl = `${ML_API_BASE}/items`;

        const response = await fetch(createItemUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify(itemPayload),
        });

        const responseData = await response.json();

        if (!response.ok) {
            console.error('ML API Error Response:', JSON.stringify(responseData, null, 2));
            const errorMessage = responseData.message || 'Erro desconhecido da API do ML.';
            const finalError = responseData.cause?.[0]?.message || errorMessage;
            return { data: responseData, error: finalError };
        }

        return { data: responseData, error: null };
    } catch (e: any) {
        console.error("Error in createListingFromCatalog:", e);
        return { data: null, error: e.message || 'Erro inesperado ao criar o anúncio.' };
    }
}

export interface SearchOrdersParams {
    seller?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    sort?: 'date_asc' | 'date_desc';
    offset?: number;
    limit?: number;
}

export async function getUserIdFromToken(token: string): Promise<number | null> {
  try {
    const response = await fetch(`${ML_API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store'
    });

    if (!response.ok) {
      console.warn('Falha ao obter /users/me, tentando com as credenciais do DB');
      return null;
    }

    const data = await response.json();
    return data?.id || null;
  } catch (e) {
    console.error('Erro ao buscar ID do usuário do ML', e);
    return null;
  }
}

// Additional helper functions needed for ml-enrichment.ts 
// that were not in the initially viewed chunk of mercadolivre.ts

export interface ItemVisits {
  itemId: string;
  totalVisits: number;
}

export interface ItemReviews {
    itemId: string;
    rating_average: number;
    reviews_count: number;
}

export async function getItemsVisits(itemIds: string[], accountId?: string): Promise<{ success: boolean; data: ItemVisits[]; error?: string }> {
    try {
        const token = await getMlToken(accountId);
        const url = `${ML_API_BASE}/items/visits?ids=${itemIds.join(',')}`;
        
        const response = await fetch(url, {
             headers: { Authorization: `Bearer ${token}` },
             cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error(`Erro ao buscar visitas: ${response.statusText}`);
        }

        const data = await response.json();
        // A API retorna um objeto onde as chaves são os IDs e valores são as visitas, ou um array?
        // Documentação ML diz: { "ITEM_ID": VISITS, ... }
        
        const visits: ItemVisits[] = Object.entries(data).map(([key, value]) => ({
            itemId: key,
            totalVisits: Number(value)
        }));

        return { success: true, data: visits };
    } catch (e: any) {
        console.error("Error getting item visits:", e);
        return { success: false, data: [], error: e.message };
    }
}

export async function getSellersReputationCached(sellerIds: number[], token: string) {
    // Wrapper simples para getSellersReputation
    return getSellersReputation(sellerIds, token);
}

export async function getItemsReviews(itemIds: string[], accountId?: string): Promise<{ success: boolean; data: ItemReviews[] }> {
    // Placeholder - ML API não tem endpoint direto público fácil de reviews em lote para itens de terceiros.
    // As reviews geralmente vêm detalhes do item ou endpoint de opiniões.
    // Retornando vazio para evitar erros
    return { success: true, data: [] };
}

export interface CompetitorData {
  id: string;
  price: number;
  permalink: string;
  seller_id: number;
  thumbnail: string;
  condition: string;
  stockRange?: { min: number; max: number; label: string };
  stockLevel?: 'none' | 'low' | 'medium' | 'high' | 'very_high';
  visits?: number;
  reputation?: {
      level_id: string;
      power_seller_status: string;
      transactions_total: number;
  };
}


export async function getCatalogCompetition(
  catalogProductId: string,
  accountId?: string,
  options?: any
): Promise<{ 
    success: boolean; 
    competitors: CompetitorData[]; 
    totalCompetitors: number;
    lowestPrice: number | null;
    highestPrice: number | null;
    averagePrice: number | null;
    error?: string 
}> {
    try {
        const token = await getMlToken(accountId);
        // Busca items do produto de catálogo
        // GET /products/{id}/items
        const url = `${ML_API_BASE}/products/${catalogProductId}/items?limit=50`;
        const response = await fetch(url, {
             headers: { Authorization: `Bearer ${token}` },
             cache: 'no-store'
        });
        
         if (!response.ok) {
             // Se falhar (ex: 404), retorna vazio
             return { success: false, competitors: [], totalCompetitors: 0, lowestPrice: null, highestPrice: null, averagePrice: null };
         }
         
         const data = await response.json();
         const results = data.results || [];
         
         const competitors: CompetitorData[] = results.map((item: any) => ({
             id: item.item_id,
             price: item.price,
             permalink: item.permalink,
             seller_id: item.seller_id,
             thumbnail: '', // Não vem nesse endpoint
             condition: item.condition,
         }));
         
         const prices = competitors.map(c => c.price).filter(p => p > 0);
         
         return {
             success: true,
             competitors,
             totalCompetitors: data.paging?.total || competitors.length,
             lowestPrice: prices.length ? Math.min(...prices) : null,
             highestPrice: prices.length ? Math.max(...prices) : null,
             averagePrice: prices.length ? prices.reduce((a,b)=>a+b,0)/prices.length : null
         };
         
    } catch (e: any) {
        return { success: false, competitors: [], totalCompetitors: 0, lowestPrice: null, highestPrice: null, averagePrice: null, error: e.message };
    }
}

export type BuyBoxStatus = 'winner' | 'competitor' | 'not_in_buybox' | 'unknown';

export async function getBuyBoxStatus(
  catalogProductId: string,
  myItemIds: string[],
  accountId?: string
): Promise<BuyBoxStatus> {
    try {
         const competition = await getCatalogCompetition(catalogProductId, accountId);
         if (!competition.success || competition.competitors.length === 0) return 'unknown';
         
         const winner = competition.competitors[0]; // Assumindo ordenação por preço/relevância que o ML retorna
         
         if (myItemIds.includes(winner.id)) return 'winner';
         
         const amIInList = competition.competitors.some(c => myItemIds.includes(c.id));
         return amIInList ? 'competitor' : 'not_in_buybox';
         
    } catch {
        return 'unknown';
    }
}

export async function getQuestionsFromMultipleItems(itemIds: string[], accountId?: string, limitPerItem = 2) {
    // Implementação simplificada
    return { success: true, questions: [] };
}

export async function getShippingSimulation(itemId: string, zipCode: string, accountId?: string) {
    // Implementação simplificada
    return { success: true, options: [] };
}

export async function getCategoryTrends(categoryId: string, accountId?: string) {
     try {
        const token = await getMlToken(accountId);
        const url = `${ML_API_BASE}/trends/MLB/${categoryId}`;
        
        const response = await fetch(url, {
             headers: { Authorization: `Bearer ${token}` },
             cache: 'no-store'
        });

        if (!response.ok) return { success: false, trends: [] };
        
        const data = await response.json();
        return { success: true, trends: data };
    } catch {
        return { success: false, trends: [] };
    }
}

export async function getCategoryInfo(categoryId: string, accountId?: string) {
    try {
        const token = await getMlToken(accountId);
        const url = `${ML_API_BASE}/categories/${categoryId}`;
        
        const response = await fetch(url, {
             headers: { Authorization: `Bearer ${token}` },
             cache: 'no-store'
        });

        if (!response.ok) return { success: false };
        
        const data = await response.json();
        return { 
            success: true, 
            name: data.name, 
            path_from_root: data.path_from_root 
        };
    } catch {
        return { success: false };
    }
}
