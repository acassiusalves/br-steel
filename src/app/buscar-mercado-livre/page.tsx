'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useFormState } from 'react-dom';
import { useSearchParams, useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Loader2, Filter, Settings2, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast'; // CORRECTED IMPORT

import { MlResultsTable, ProductResultWithViability, MlProductInfo } from '@/components/ml-results-table';
import { FiltersSidebar } from '@/components/filters-sidebar';
import { DeepSearchDialog } from '@/components/deep-search-dialog';

import { searchMercadoLivreAction, createCatalogListingAction, saveProductMatchTrainingAction, MlProductTrainingInput } from '@/app/actions';
import { DeepSearchConfig } from '@/lib/deep-search-types';
import { MlSearchResult } from '@/lib/types'; // CHANGED to MlSearchResult
import { formatCurrency } from '@/lib/utils';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

// Tipos para os filtros - Alinhado com FiltersSidebar
interface FilterState {
    minPrice?: number;
    maxPrice?: number;
    minSold?: number;
    condition?: string;
    listingType?: string;
    shipping?: string[];
    minReputation?: number;
    hasFull?: boolean;
    hasFlex?: boolean;
    freeShipping?: boolean;
    brands?: string[];
    sellerLocation?: string[];
    storeTypes?: string[];
    minReviewRating?: number;
    [key: string]: any; // Index signature para compatibilidade
}

function BuscarMercadoLivreContent() {
    const { toast } = useToast();
    const searchParams = useSearchParams();
    const router = useRouter();
    const initialQuery = searchParams.get('q') || '';

    // State do formulário de busca
    const [query, setQuery] = useState(initialQuery);
    const [isSearching, setIsSearching] = useState(false);
    
    // Resultados e Estado da Tabela
    const [results, setResults] = useState<ProductResultWithViability[]>([]);
    const [selectedRowIds, setSelectedRowIds] = useState<Record<string, boolean>>({});
    
    // Filtros e Ordenação
    const [showFilters, setShowFilters] = useState(true);
    const [activeFilters, setActiveFilters] = useState<FilterState>({});
    const [sortBy, setSortBy] = useState<string>('relevance');

    // Deep Search
    const [isDeepSearchOpen, setIsDeepSearchOpen] = useState(false);

    // Viabilidade e Custos
    const [showViability, setShowViability] = useState(false);
    const [userCosts, setUserCosts] = useState<Record<string, number>>({});

    // Efeito para buscar se houver query na URL ao carregar
    useEffect(() => {
        if (initialQuery && results.length === 0 && !isSearching) {
            handleSearch(initialQuery);
        }
    }, [initialQuery]);

    // Handler de busca
    const handleSearch = async (searchQuery: string) => {
        if (!searchQuery.trim()) return;

        setIsSearching(true);
        setResults([]);
        setSelectedRowIds({});
        
        // Atualiza URL
        const params = new URLSearchParams(searchParams.toString());
        params.set('q', searchQuery);
        router.push(`?${params.toString()}`);

        try {
            const formData = new FormData();
            formData.append('productName', searchQuery);
            // Configurar opções padrão para a busca inicial
            formData.append('includeEnrichment', 'true'); 

            const response = await searchMercadoLivreAction(null, formData);

            if (response?.error) {
                toast({ title: 'Erro', description: response.error, variant: 'destructive' });
            } else if (response?.result) {
               // Adicionar campos de viabilidade vazios/iniciais
               const productsWithViability: ProductResultWithViability[] = response.result.map((p: MlSearchResult) => ({
                   ...p,
                   viability: undefined // Será calculado se 'showViability' for true e tiver custo
               }));
               setResults(productsWithViability);
               toast({ title: 'Sucesso', description: `${response.result.length} produtos encontrados.` });
            }
        } catch (error) {
            console.error(error);
            toast({ title: 'Erro', description: 'Erro ao buscar produtos. Tente novamente.', variant: 'destructive' });
        } finally {
            setIsSearching(false);
        }
    };

    // Handler para iniciar Deep Search
    const handleDeepSearchStart = async (config: DeepSearchConfig) => {
        setIsDeepSearchOpen(false);
        setIsSearching(true);
        toast({ title: 'Deep Search', description: 'Iniciando Deep Search... Isso pode levar alguns instantes.' });

        try {
            // Em uma implementação real, chamaria uma action de deep search
            // Por enquanto, vamos usar a busca normal mas com parâmetros específicos se disponível
            // Ou implementar a lógica client-side de iterar sobre os produtos base
            
            // SIMULAÇÃO: Para este MVP, re-executa a busca normal
            // Idealmente: await deepSearchAction(config);
            
            // Se tiver produtos base selecionados, usa o título do primeiro como query refinada
            const baseProduct = config.baseProducts[0];
            const queryToUse = baseProduct ? baseProduct.title : query;
            
            await handleSearch(queryToUse);
            
        } catch (error) {
           console.error(error);
           toast({ title: 'Erro', description: 'Erro no Deep Search', variant: 'destructive' });
           setIsSearching(false);
        }
    };

    // Handler para criar anúncios
    const handleCreateListing = async (products: MlSearchResult[]) => {
        // Implementação simplificada sem toast.promise customizado ou adaptador
        toast({ title: 'Criando anúncios...', description: 'Processando...' });
        
        let successCount = 0;
        let errorCount = 0;

        for (const product of products) {
            // Exemplo simplificado
            const formData = new FormData();
            formData.append('catalogProductId', product.id);
            // ... outros campos ...
            
            const res = await createCatalogListingAction(null, formData);
            if (res?.error) errorCount++; else successCount++;
        }

        toast({ title: 'Finalizado', description: `Sucesso: ${successCount}, Erros: ${errorCount}` });
    };

    // Handler para Toggle de Seleção
    const handleToggleRow = (id: string) => {
        setSelectedRowIds(prev => ({
            ...prev,
            [id]: !prev[id]
        }));
    };

    const handleToggleSelectAll = () => {
        const allSelected = results.every(r => selectedRowIds[r.id]);
        if (allSelected) {
            setSelectedRowIds({});
        } else {
            const newSelected: Record<string, boolean> = {};
            results.forEach(r => newSelected[r.id] = true);
            setSelectedRowIds(newSelected);
        }
    };

    // Handler de Custo Manual
    const handleManualCostChange = (productId: string, cost: number | null) => {
        setUserCosts(prev => ({
            ...prev,
            [productId]: cost !== null ? cost : 0 // 0 ou undefined para remover
        }));
        
        // Recalcular viabilidade localmente
        setResults(prev => prev.map(p => {
             if (p.id === productId) {
                 // Recalcular margens com novo custo
                 // Simplificado:
                 return {
                     ...p,
                     viability: cost !== null ? {
                         ...p.viability, // manter outros campos
                         cost: cost,
                         costSource: 'manual',
                         matchConfidence: p.viability?.matchConfidence || 'none',
                         classic: {
                             margin: calculateMargin(p.price, cost, 0.11, 5), // Exemplo: 11% + 5 fixo
                             profit: (p.price * (1 - 0.11)) - 5 - cost
                         },
                         premium: {
                             margin: calculateMargin(p.price, cost, 0.16, 5),
                             profit: (p.price * (1 - 0.16)) - 5 - cost
                         }
                     } as any : p.viability
                 };
             }
             return p;
        }));
    };

    // Função auxiliar de margem (simplificada)
    const calculateMargin = (price: number, cost: number, feePercent: number, fixedFee: number) => {
        const net = price * (1 - feePercent) - fixedFee;
        if (net <= 0) return -100;
        return ((net - cost) / net) * 100;
    };


    // Filtro e Ordenação dos Resultados
    const filteredResults = React.useMemo(() => {
        let filtered = [...results];

        // Aplica filtros (Exemplos)
        if (activeFilters.minPrice) filtered = filtered.filter(p => p.price >= activeFilters.minPrice!);
        if (activeFilters.maxPrice) filtered = filtered.filter(p => p.price <= activeFilters.maxPrice!);
        if (activeFilters.condition) filtered = filtered.filter(p => p.condition === activeFilters.condition);
        // ... outros filtros

        // Ordenação
        filtered.sort((a, b) => {
            switch (sortBy) {
                case 'price_asc': return a.price - b.price;
                case 'price_desc': return b.price - a.price;
                case 'sold_desc': return (b.sold_quantity || 0) - (a.sold_quantity || 0);
                case 'relevance': default: return 0; // Mantém ordem original (relevância do ML)
            }
        });

        return filtered;
    }, [results, activeFilters, sortBy]);

    // Produtos selecionados para Deep Search
    const selectedProducts: MlSearchResult[] = results.filter(p => selectedRowIds[p.id]);

    return (
        <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 p-4 md:p-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Buscar no Mercado Livre</h1>
                    <p className="text-muted-foreground">
                        Pesquise produtos, analise a concorrência e encontre oportunidades.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setShowViability(!showViability)}
                        className={showViability ? "bg-green-50 text-green-700 border-green-200" : ""}
                    >
                        <DollarSignIcon className="mr-2 h-4 w-4" />
                        {showViability ? 'Ocultar Viabilidade' : 'Analisar Viabilidade'}
                    </Button>
                    <Button 
                        variant="default"
                        disabled={selectedProducts.length === 0}
                        onClick={() => setIsDeepSearchOpen(true)}
                    >
                        <Sparkles className="mr-2 h-4 w-4" />
                        Deep Search ({selectedProducts.length})
                    </Button>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Buscar por produto, marca, modelo ou EAN..."
                        className="pl-8"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch(query)}
                    />
                </div>
                <Button onClick={() => handleSearch(query)} disabled={isSearching}>
                    {isSearching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Buscar
                </Button>
                <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowFilters(!showFilters)}
                    className={showFilters ? "bg-muted" : ""}
                >
                    <Filter className="h-4 w-4" />
                </Button>
            </div>

            <div className="flex flex-1 gap-6 overflow-hidden">
                {/* Sidebar de Filtros */}
                {showFilters && (
                    <FiltersSidebar
                        className="w-64 hidden md:block overflow-y-auto"
                        dynamicFilterOptions={[]} // Passar filtros dinâmicos extraídos dos resultados se houver
                        brandOptions={[]} // Extrair marcas dos resultados
                        shippingOptions={[]}
                        storeTypeOptions={{ official: 0, nonOfficial: 0 }}
                        activeFilters={activeFilters as any} // Cast simples para resolver erro de tipo
                        selectedBrands={activeFilters.brands || []}
                        selectedShipping={activeFilters.shipping || []}
                        selectedStoreTypes={activeFilters.storeTypes || []}
                        brandSearch=""
                        modelSearch=""
                        onFilterChange={(filterId, values) => {
                            setActiveFilters(prev => ({ ...prev, [filterId]: values }));
                        }}
                        onBrandChange={(brands) => {
                             setActiveFilters(prev => ({ ...prev, brands }));
                        }}
                        onShippingChange={(shipping) => {
                            setActiveFilters(prev => ({ ...prev, shipping }));
                        }}
                        onStoreTypeChange={(storeTypes) => {
                            setActiveFilters(prev => ({ ...prev, storeTypes }));
                        }}
                        onBrandSearchChange={() => {}}
                        onModelSearchChange={() => {}}
                    />
                )}

                {/* Área Principal - Resultados */}
                <div className="flex flex-1 flex-col overflow-hidden rounded-lg border bg-background shadow-sm">
                    {/* Toolbar da Tabela */}
                    <div className="flex items-center justify-between border-b p-2 bg-muted/20">
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">
                                {filteredResults.length} resultados encontrados
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">Ordenar por:</span>
                            <Select value={sortBy} onValueChange={setSortBy}>
                                <SelectTrigger className="h-8 w-[180px]">
                                    <SelectValue placeholder="Relevância" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="relevance">Mais relevantes</SelectItem>
                                    <SelectItem value="price_asc">Menor preço</SelectItem>
                                    <SelectItem value="price_desc">Maior preço</SelectItem>
                                    <SelectItem value="sold_desc">Mais vendidos</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Tabela de Resultados */}
                    <div className="flex-1 overflow-y-auto p-4">
                        {isSearching ? (
                            <div className="flex flex-col items-center justify-center h-full gap-4">
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                <p className="text-muted-foreground">Buscando produtos...</p>
                            </div>
                        ) : (
                            <MlResultsTable
                                results={filteredResults}
                                selectedRowIds={selectedRowIds}
                                onToggleRowSelection={handleToggleRow}
                                onToggleSelectAll={handleToggleSelectAll}
                                onCreateListing={handleCreateListing}
                                canCreateListing={true}
                                searchTerm={query}
                                showViability={showViability}
                                onManualCostChange={handleManualCostChange}
                                onTrainMatch={async (info) => {
                                    // Falta info de feedSku e feedProductName
                                    // TODO: Implementar dialog de seleção de treino
                                    toast({ title: 'Indisponível', description: 'Treinamento de match será implementado em breve.', variant: 'default' });
                                    // const trainingInput: MlProductTrainingInput = {
                                    //     id: info.productId,
                                    //     productName: info.productName,
                                    //     mlBrand: info.brand || '',
                                    //     mlModel: info.model || '',
                                    //     mlStorage: info.storage,
                                    //     mlRam: info.ram,
                                    //     feedSku: '???', // FALTANDO
                                    //     feedProductName: '???', // FALTANDO
                                    //     attributes: info.attributes
                                    // };
                                    // await saveProductMatchTrainingAction(trainingInput);
                                }}
                            />
                        )}
                    </div>
                </div>
            </div>

            {/* Dialogs */}
            <DeepSearchDialog
                open={isDeepSearchOpen}
                onOpenChange={setIsDeepSearchOpen}
                selectedProducts={selectedProducts as any} // Cast simples se houver mismatch com ProductResult do DeepSearch
                onStart={handleDeepSearchStart}
            />
        </div>
    );
}

export default function BuscarMercadoLivrePage() {
    return (
        <Suspense fallback={<div className="p-4">Carregando...</div>}>
            <BuscarMercadoLivreContent />
        </Suspense>
    );
}

function DollarSignIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" x2="12" y1="2" y2="22" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  )
}
