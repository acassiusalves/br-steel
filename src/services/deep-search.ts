
// @ts-nocheck
import { generateText, generateObject } from '@/server/ai';
import { z } from 'zod';
import { 
  AggregatedSearchResult, 
  DeepSearchConfig, 
  DeepSearchProgress, 
  ProductDNA, 
  RateLimitConfig, 
  SearchStrategy,
  ProductValidationResult,
  DeepSearchPhase,
  DeepSearchResult,
  AggregatedDeepSearchResult
} from '@/lib/deep-search-types';
import { getMlToken, getSellersReputation } from '@/services/mercadolivre';
import { getCatalogOfferCount, getCategoryInfo } from '@/lib/ml';
import { enrichCatalogProducts } from '@/services/ml-enrichment';

// Schemas Zod para outputs da IA
const ProductDNASchema = z.object({
  brand: z.string().nullable().describe("Marca normalizada do produto"),
  productLine: z.string().nullable().describe("Linha do produto ex: Redmi Note, Galaxy S"),
  modelNumber: z.string().nullable().describe("Número do modelo ex: 13, 24"),
  modelSuffix: z.string().nullable().describe("Sufixo do modelo ex: Pro, Ultra, C, Play"),
  storage: z.string().nullable().describe("Capacidade de armazenamento ex: 128GB"),
  ram: z.string().nullable().describe("Memória RAM ex: 8GB"),
  color: z.string().nullable().describe("Cor normalizada"),
  region: z.string().nullable().describe("Versão regional ex: Global, India"),
  keyAttributes: z.record(z.string()).describe("Outros atributos chave identificados"),
  confidence: z.object({
    overall: z.number(),
    fields: z.record(z.number())
  })
});

const SearchStrategiesSchema = z.object({
  strategies: z.array(z.object({
    type: z.enum(["exact_match", "broad_match", "fuzzy_match", "spec_match"]),
    query: z.string(),
    filters: z.record(z.string()),
    min_price: z.number().optional(),
    max_price: z.number().optional(),
    rationale: z.string().describe("Por que esta estratégia foi escolhida")
  })),
  totalExpectedResults: z.number()
});

const ValidationSchema = z.object({
  verdict: z.enum(['MATCH', 'PROBABLE_MATCH', 'NO_MATCH']),
  confidence: z.number(),
  reasoning: z.string(),
  comparison: z.object({
    brandMatch: z.enum(['exact', 'close', 'different']),
    modelMatch: z.enum(['exact', 'variant', 'different']),
    storageMatch: z.enum(['exact', 'unspecified', 'different']),
    ramMatch: z.enum(['exact', 'unspecified', 'different'])
  })
});


// Classe principal do serviço
export class DeepSearchService {
  private config: DeepSearchConfig;
  private progressCallback?: (progress: DeepSearchProgress) => void;
  
  constructor(config: DeepSearchConfig, onProgress?: (p: DeepSearchProgress) => void) {
    this.config = config;
    this.progressCallback = onProgress;
  }

  private updateProgress(p: Partial<DeepSearchProgress>) {
    if (this.progressCallback) {
      // @ts-ignore
      this.progressCallback(p);
    }
  }

  async execute(): Promise<DeepSearchResult> {
    const sessionId = generateSessionId();
    const startTime = Date.now();
    const results: AggregatedDeepSearchResult[] = [];

    let totalQueries = 0;
    let totalItemsScanned = 0;
    let uniqueMatches = 0;

    try {
      this.updateProgress({ phase: 'extracting_dna', message: 'Extraindo DNA dos produtos base...' });

      // 1. Extrair DNA de cada produto base
      const dnas = await Promise.all(this.config.baseProducts.map(p => this.extractProductDNA(p)));

      for (let i = 0; i < dnas.length; i++) {
        const dna = dnas[i];
        const baseProduct = this.config.baseProducts[i];
        
        this.updateProgress({ phase: 'generating_strategies', message: `Gerando estratégias para ${baseProduct.name}...` });
        
        // 2. Gerar estratégias de busca
        const strategies = await this.generateSearchStrategies(dna);
        totalQueries += strategies.length;

        // 3. Executar buscas
        this.updateProgress({ phase: 'searching', message: `Executando ${strategies.length} estratégias de busca...` });
        const rawItems = await this.executeStrategies(strategies);
        totalItemsScanned += rawItems.length;

        // 4. Validar e filtrar resultados
        this.updateProgress({ phase: 'matching', message: `Validando ${rawItems.length} candidatos...` });
        const validatedItems = await this.validateMatches(dna, rawItems);
        uniqueMatches += validatedItems.length;

        // 5. Agregar e enriquecer
        this.updateProgress({ phase: 'aggregating', message: 'Agregando resultados...' });
        const aggregated = await this.aggregateResults(baseProduct, dna, validatedItems);
        results.push(aggregated);
      }

      const endTime = Date.now();

      return {
        sessionId,
        config: this.config,
        progress: {
            phase: 'completed',
            currentQuery: totalQueries,
            totalQueries,
            resultsFound: totalItemsScanned,
            matchedResults: uniqueMatches,
            message: 'Deep Search concluído com sucesso.',
            errors: []
        },
        results,
        metadata: {
          totalQueries,
          totalItemsScanned,
          uniqueMatches,
          executionTimeMs: endTime - startTime,
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date(endTime).toISOString()
        }
      };

    } catch (error: any) {
        console.error("Deep Search Error:", error);
        throw error;
    }
  }

  // --- Passo 1: Extração de DNA ---
  private async extractProductDNA(product: any): Promise<ProductDNA> {
    const prompt = `Analise o seguinte produto e extraia seu "DNA" técnico para identificação precisa em outros anúncios.
    Título: ${product.name}
    Atributos: ${JSON.stringify(product.attributes)}
    Brand: ${product.brand}
    Model: ${product.model}
    
    Identifique marca, linha, modelo exato, sufixos, capacidade, cor, ram, etc.`;

    const result = await generateObject({
      model: 'gpt-4o',
      schema: ProductDNASchema,
      prompt,
      temperature: 0
    });

    return result.object as ProductDNA;
  }

  // --- Passo 2: Estratégias de Busca ---
  private async generateSearchStrategies(dna: ProductDNA): Promise<any[]> {
    const prompt = `Com base no DNA do produto abaixo, gere 3 a 5 estratégias de busca para encontrar anúncios deste exato produto no Mercado Livre.
    DNA: ${JSON.stringify(dna)}
    
    Considere variações de título comuns usadas por vendedores.
    Inclua filtros negativos se necessário para excluir modelos parecidos (ex: excluir "Lite" se o produto for "Pro").`;

    const result = await generateObject({
      model: 'gpt-4o',
      schema: SearchStrategiesSchema,
      prompt,
      temperature: 0.2
    });

    return result.object.strategies;
  }

  // --- Passo 3: Execução de Busca ---
  private async executeStrategies(strategies: any[]): Promise<any[]> {
    const allItems: any[] = [];
    const seenIds = new Set<string>();

    const token = await getMlToken();

    for (const strategy of strategies) {
      const url = new URL("https://api.mercadolibre.com/sites/MLB/search");
      url.searchParams.set("q", strategy.query);
      url.searchParams.set("status", "active");
      if (strategy.min_price) url.searchParams.set("price", `${strategy.min_price}-*`);
      
      try {
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` }
        });
        
        if (res.ok) {
          const data = await res.json();
          const items = data.results || [];
          
          for (const item of items) {
            if (!seenIds.has(item.id)) {
              seenIds.add(item.id);
              allItems.push({ ...item, _strategy: strategy.type });
            }
          }
        }
      } catch (e) {
        console.error(`Erro na estratégia ${strategy.query}:`, e);
      }
      
      await sleep(200); // Rate limit friendly
    }

    return allItems;
  }

  // --- Passo 4: Validação de Matches ---
  private async validateMatches(dna: ProductDNA, items: any[]): Promise<any[]> {
    // Filtragem preliminar rápida (hard filters)
    const candidates = items.filter(item => {
        // Exemplo: se DNA diz "Pro", título não pode ter "Lite" 
        // Implementar lógica de pré-filtro aqui se necessário para economizar tokens
        return true; 
    });

    // Validação via LLM em batches
    const validatedItems = [];
    const BATCH_SIZE = 10;
    
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        const batch = candidates.slice(i, i + BATCH_SIZE);
        const validations = await Promise.all(batch.map(item => this.validateItem(dna, item)));
        
        for (let j = 0; j < batch.length; j++) {
            if (validations[j].verdict === 'MATCH' || validations[j].verdict === 'PROBABLE_MATCH') {
                validatedItems.push({
                    ...batch[j],
                    matchValidation: validations[j]
                });
            }
        }
    }

    return validatedItems;
  }

  private async validateItem(dna: ProductDNA, item: any): Promise<any> {
    // Constroi prompt curto
    const prompt = `Valide se o Anúncio corresponde EXATAMENTE ao Produto Base.
    Produto Base (DNA): ${JSON.stringify(dna)}
    Anúncio Candidato:
    Título: ${item.title}
    Preço: ${item.price}
    Atributos: ${JSON.stringify(item.attributes?.filter((a:any) => ['BRAND','MODEL','MEMORY_RAM','INTERNAL_MEMORY'].includes(a.id)))}
    
    Se houver divergência em modelo, versão, ram ou armazenamento, é NO_MATCH.
    Cor diferente é MATCH (mesmo produto, variação).
    Usado/Novo não importa para identidade do produto.`;

    try {
        const result = await generateObject({
            model: 'gpt-4o-mini', // Modelo mais rápido e barato
            schema: ValidationSchema,
            prompt,
            temperature: 0
        });
        return result.object;
    } catch (e) {
        return { verdict: 'NO_MATCH', confidence: 0, reasoning: 'Error' };
    }
  }

  // --- Passo 5: Agregação ---
  private async aggregateResults(baseProduct: any, dna: ProductDNA, items: any[]): Promise<AggregatedDeepSearchResult> {
    
    const token = await getMlToken();
    
    // Buscar reputação vendedores
    const sellerIds = [...new Set(items.map(i => i.seller?.id))].filter(Boolean);
    const reputations = await getSellersReputation(sellerIds, token);
    
    // Agrupar items idênticos (catalog vs item único)
    // Para simplificar, tratamos cada ML Item como uma entrada na lista final

    const deepSearchItems = items.map(item => {
        const rep = reputations[item.seller?.id];
        return {
            itemId: item.id,
            sellerId: item.seller?.id,
            sellerNickname: rep?.nickname || item.seller?.nickname || "Unknown",
            price: item.price,
            listingType: item.listing_type_id === 'gold_pro' ? 'gold_pro' : 'gold_special', // simplificação
            visits: 0, // Precisa de chamada extra de visits se quiser
            isOfficialStore: !!item.official_store_id,
            availableQuantity: item.available_quantity,
            permalink: item.permalink,
            thumbnail: item.thumbnail,
            foundByQuery: item._strategy,
            matchConfidence: item.matchValidation?.confidence || 0
        };
    });

    // Calcular estatísticas
    const prices = deepSearchItems.map(i => i.price);
    const totalVisits = 0; // Se tivesse buscado visitas
    const officialStores = deepSearchItems.filter(i => i.isOfficialStore);
    
    // Dedulicar por ID
    const dedupedItems = deepSearchItems.filter((v,i,a)=>a.findIndex(v2=>v2.itemId===v.itemId)===i);

    const classicItems = dedupedItems.filter(i => i.listingType !== 'gold_pro');
    const premiumItems = dedupedItems.filter(i => i.listingType === 'gold_pro');

    let avgConfidence = 0;
    if (dedupedItems.length > 0) {
        avgConfidence = dedupedItems.reduce((acc, i) => acc + i.matchConfidence, 0) / dedupedItems.length;
    }

    return {
      uniqueId: baseProduct.id || baseProduct.catalog_product_id,
      productDNA: dna,
      productName: baseProduct.name,
      thumbnail: baseProduct.thumbnail,
      items: dedupedItems.map(i => ({
        ...i,
        // Remover campos internos se não precisar
        matchConfidence: i.matchConfidence,
      })),
      stats: {
        totalListings: dedupedItems.length,
        uniqueSellers: new Set(dedupedItems.map(i => i.sellerId)).size,
        priceRange: {
          min: Math.min(...prices),
          max: Math.max(...prices),
          avg: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
        },
        totalVisits,
        officialStoreCount: officialStores.length,
        bestClassicPrice: classicItems.length > 0 ? Math.min(...classicItems.map(i => i.price)) : undefined,
        bestPremiumPrice: premiumItems.length > 0 ? Math.min(...premiumItems.map(i => i.price)) : undefined,
      },
      averageMatchConfidence: avgConfidence,
    };
  }
}

// Helpers
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateSessionId(): string {
  return `ds_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
