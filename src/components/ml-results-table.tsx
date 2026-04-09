'use client';

import * as React from 'react';
import { useRef, useState, useMemo, useEffect } from "react"
import Link from 'next/link';
import Image from 'next/image';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from "@/components/ui/input"
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { Card } from "@/components/ui/card"
import {
    ExternalLink,
    MoreHorizontal,
    AlertCircle,
    CheckCircle2,
    DollarSign,
    Package,
    TrendingUp,
    TrendingDown,
    Truck,
    Star,
    Store,
    Building2,
    MapPin,
    Calendar,
    Search,
    Filter,
    ArrowUpDown,
    CheckCircle,
    User,
    Edit,
    Trash2,
    Eye,
    Percent,
    GraduationCap,
    Edit2,
    HelpCircle,
    Clock,
    Users,
    Shield,
    ShieldCheck,
    Minus,
    PlusCircle,
    Copy,
    XCircle,
    Info,
    AlertTriangle,
    BrainCircuit,
    ShoppingCart
} from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCurrency, formatBRL, formatPercent } from "@/lib/utils" 
import { FullIcon, MercadoLivreIcon, AttentionIcon as WarningIcon, OkBlueIcon as CheckIcon } from "@/components/icons"
import { PriceHistoryChart } from "@/components/price-history-chart"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { MlSearchResult } from '@/lib/types';


// --- Tipos Locais (agora importando MlSearchResult) ---

export type ProductResult = MlSearchResult; // Alias for compatibility or easy refactor

export interface ProductResultWithViability extends ProductResult {
    viability?: {
        cost: number | null;
        costSource: 'manual' | 'catalog' | 'estimate' | 'feed' | null;
        matchConfidence: 'high' | 'medium' | 'low' | 'none';
        matchedProductSku?: string;
        matchedProductName?: string;
        classic: {
            margin: number;
            profit: number;
        };
        premium: {
            margin: number;
            profit: number;
        };
    };
}


// ========== SISTEMA DE MATCH V2 (com atributos do catálogo ML) ==========

// Helper para extrair valor de atributo do array (com fallbacks para diferentes categorias)
function getAttributeValue(
    attributes: { id: string; value_name: string | null }[] | undefined,
    ...attributeIds: string[]
): string | null {
    if (!attributes) return null;
    for (const id of attributeIds) {
        const found = attributes.find(a => a.id === id)?.value_name;
        if (found) return found;
    }
    return null;
}

// Extrai especificações do texto do produto original (ex: "128GB", "8GB RAM")
function extractSpecsFromText(text: string): {
    storage: string | null;
    ram: string | null;
    color: string | null;
    ean: string | null;
} {
    const normalized = text.toLowerCase();

    // Storage: 64gb, 128gb, 256gb, 512gb, 1tb (mas não "8gb ram")
    const storageMatch = normalized.match(/(\d+)\s*(gb|tb)(?!\s*ram)/i);
    const storage = storageMatch ? `${storageMatch[1]} ${storageMatch[2].toUpperCase()}` : null;

    // RAM: 4gb ram, 8gb ram, 12gb ram
    const ramMatch = normalized.match(/(\d+)\s*gb\s*ram/i);
    const ram = ramMatch ? `${ramMatch[1]} GB` : null;

    // Cores comuns em português
    const colors = ['preto', 'branco', 'azul', 'verde', 'roxo', 'dourado', 'prata', 'cinza', 'rosa', 'vermelho', 'amarelo', 'laranja', 'grafite', 'titanio', 'titanium'];
    const color = colors.find(c => normalized.includes(c)) || null;

    // EAN (13 dígitos)
    const eanMatch = text.match(/\b\d{13}\b/);
    const ean = eanMatch ? eanMatch[0] : null;

    return { storage, ram, color, ean };
}

// Nova função de match otimizada com sistema de camadas e early exit
function calculateMatchScoreV2(
    originalName: string,
    originalDescription: string,
    originalModel: string,
    mlProduct: {
        name: string;
        model: string;
        brand: string;
        attributes: { id: string; value_name: string | null }[];
    }
): {
    score: number;
    type: 'high' | 'medium' | 'low' | 'none';
    matches: string[];
} {
    if (!originalName) return { score: 0, type: 'none', matches: [] };

    const normalize = (str: string) =>
        str.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const originalFull = normalize(`${originalName} ${originalDescription || ''} ${originalModel || ''}`);
    const matches: string[] = [];
    let score = 0;

    // ========== CAMADA 1: Match Exato (GTIN/MPN) - Early Exit ==========
    const originalSpecs = extractSpecsFromText(originalFull);

    // Verifica EAN/GTIN
    const mlGtin = getAttributeValue(mlProduct.attributes, 'GTIN');
    if (originalSpecs.ean && mlGtin && originalSpecs.ean === mlGtin) {
        return { score: 100, type: 'high', matches: ['EAN/GTIN exato'] };
    }

    // Verifica MPN (Part Number)
    const mlMpn = getAttributeValue(mlProduct.attributes, 'MPN');
    if (mlMpn && originalFull.includes(normalize(mlMpn))) {
        return { score: 100, type: 'high', matches: ['Part Number (MPN)'] };
    }

    // ========== CAMADA 2: Match por Palavras ==========
    const mlModelNorm = normalize(mlProduct.model || '');
    const mlNameNorm = normalize(mlProduct.name);

    const stopWords = ['de', 'da', 'do', 'para', 'com', 'sem', 'e', 'ou', 'em', 'a', 'o', 'as', 'os', 'um', 'uma'];

    // Extrai palavras significativas do original (>2 chars, sem stopwords)
    const originalWords = originalFull.split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w));

    // Combina nome + modelo do ML para busca
    const mlFullText = `${mlNameNorm} ${mlModelNorm}`;

    // Conta matches de palavras
    let wordMatches = 0;
    originalWords.forEach(word => {
        if (mlFullText.includes(word)) wordMatches++;
    });

    // Calcula percentual de match
    const matchPercentage = originalWords.length > 0 ? wordMatches / originalWords.length : 0;

    // Pontuação baseada no percentual
    if (matchPercentage >= 0.8) {
        score += 70;  // 80%+ das palavras → Alta correspondência
        matches.push(`${wordMatches}/${originalWords.length} palavras (${Math.round(matchPercentage * 100)}%)`);
    } else if (matchPercentage >= 0.5) {
        score += 45;  // 50-79% das palavras → Média correspondência
        matches.push(`${wordMatches}/${originalWords.length} palavras (${Math.round(matchPercentage * 100)}%)`);
    } else if (wordMatches >= 2) {
        score += 25;  // Pelo menos 2 palavras → Baixa correspondência
        matches.push(`${wordMatches}/${originalWords.length} palavras`);
    }

    // Se já tem score alto, retorna (early exit)
    if (score >= 70) {
        return { score, type: 'high', matches };
    }

    // ========== CAMADA 3: Match de Especificações (com fallbacks por categoria) ==========
    const attrs = mlProduct.attributes;

    // Storage - cobre: celulares, notebooks, tablets, SSDs, pendrives
    const mlStorage = getAttributeValue(attrs, 'INTERNAL_MEMORY', 'HARD_DRIVE_CAPACITY', 'CAPACITY', 'SSD_CAPACITY');
    if (originalSpecs.storage && mlStorage) {
        const mlStorageNorm = normalize(mlStorage);
        const origStorageNorm = normalize(originalSpecs.storage);
        if (mlStorageNorm.includes(origStorageNorm) || origStorageNorm.includes(mlStorageNorm)) {
            score += 20;
            matches.push(`Storage: ${mlStorage}`);
        }
    }

    // RAM - cobre: celulares, notebooks, tablets
    const mlRam = getAttributeValue(attrs, 'RAM', 'RAM_MEMORY');
    if (originalSpecs.ram && mlRam) {
        const mlRamNorm = normalize(mlRam);
        const origRamNorm = normalize(originalSpecs.ram);
        if (mlRamNorm.includes(origRamNorm) || origRamNorm.includes(mlRamNorm)) {
            score += 15;
            matches.push(`RAM: ${mlRam}`);
        }
    }

    // Marca
    const mlBrandNorm = normalize(mlProduct.brand || '');
    if (mlBrandNorm && originalFull.includes(mlBrandNorm)) {
        score += 10;
        matches.push('Marca');
    }

    // Cor - cobre: todas as categorias
    const mlColor = getAttributeValue(attrs, 'COLOR', 'MAIN_COLOR', 'DETAILED_COLOR');
    if (originalSpecs.color && mlColor && normalize(mlColor).includes(originalSpecs.color)) {
        score += 5;
        matches.push(`Cor: ${mlColor}`);
    }

    // Determina tipo
    let type: 'high' | 'medium' | 'low' | 'none';
    if (score >= 70) type = 'high';
    else if (score >= 40) type = 'medium';
    else if (score > 0) type = 'low';
    else type = 'none';

    return { score, type, matches };
}

// Função para calcular correspondência baseada no termo de busca (para página de busca manual)
function calculateSearchTermMatchScore(
    searchTerm: string,
    mlName: string,
    mlModel: string
): {
    score: number;
    type: 'high' | 'medium' | 'low' | 'none';
    matches: string[];
} {
    if (!searchTerm) return { score: 0, type: 'none', matches: [] };

    const normalize = (str: string) => str.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const searchNorm = normalize(searchTerm);
    const mlNameNorm = normalize(mlName);
    const mlModelNorm = normalize(mlModel || '');

    const matches: string[] = [];
    let score = 0;

    // Extrai palavras do termo de busca (remove palavras comuns)
    const stopWords = ['de', 'da', 'do', 'para', 'com', 'sem', 'e', 'ou', 'em', 'a', 'o', 'as', 'os', 'um', 'uma', 'gb', 'ram'];
    const searchWords = searchNorm.split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w));

    // 1. Verifica se alguma palavra do termo de busca aparece no modelo
    let modelMatches = 0;
    if (mlModelNorm) {
        searchWords.forEach(word => {
            if (mlModelNorm.includes(word)) {
                modelMatches++;
            }
        });

        if (modelMatches > 0) {
            score += 50;
            matches.push(`Modelo (${modelMatches} palavra(s))`);
        }
    }

    // 2. Verifica se alguma palavra do termo de busca aparece no nome
    let nameMatches = 0;
    searchWords.forEach(word => {
        if (mlNameNorm.includes(word)) {
            nameMatches++;
        }
    });

    if (nameMatches > 0) {
        const nameScore = Math.min(50, (nameMatches / searchWords.length) * 50);
        score += nameScore;
        matches.push(`Nome (${nameMatches}/${searchWords.length} palavra(s))`);
    }

    // Determina o tipo de match
    let type: 'high' | 'medium' | 'low' | 'none';
    if (score >= 70) {
        type = 'high';
    } else if (score >= 40) {
        type = 'medium';
    } else if (score > 0) {
        type = 'low';
    } else {
        type = 'none';
    }

    return { score, type, matches };
}

// Função para calcular a Margem de Contribuição
// MC = (Preço - Comissão - Taxa Fixa - Custo - Frete) / (Preço - Comissão - Taxa Fixa - Frete) × 100%
function calculateContributionMargin(
    price: number | null,
    fees: { sale_fee_amount: number; fixed_fee: number; shipping_cost: number } | null,
    cost: number
): number | null {
    if (!price || !fees || !cost || cost <= 0) return null;

    const commission = fees.sale_fee_amount || 0;
    const fixedFee = fees.fixed_fee || 0;
    const shipping = fees.shipping_cost || 0;

    const denominator = price - commission - fixedFee - shipping;
    if (denominator <= 0) return null;

    const numerator = price - commission - fixedFee - cost - shipping;
    return (numerator / denominator) * 100;
}

// Componente para exibir badge da Margem de Contribuição com cores
function ContributionMarginBadge({ margin }: { margin: number | null }) {
    if (margin === null) return null;

    let colorClass = 'text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400';
    if (margin > 15) {
        colorClass = 'text-green-600 bg-green-50 dark:bg-green-900/30 dark:text-green-400';
    } else if (margin >= 10) {
        colorClass = 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/30 dark:text-yellow-400';
    }

    return (
        <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded', colorClass)}>
            MC: {margin.toFixed(1)}%
        </span>
    );
}

const listingTypeMap: Record<string, string> = {
    "gold_special": "Clássico",
    "gold_pro": "Premium"
};

const freightMap: Record<string, string> = {
    "drop_off": "Correios",
    "xd_drop_off": "Correios",
    "xd_pick_up": "Correios",
    "fulfillment": "Full ML",
    "cross_docking": "Agência ML",
    "pick_up": "Retirada",
    "prepaid": "Frete pré-pago",
    "self_service": "Sem Mercado Envios",
    "custom": "A combinar"
};

const getShippingLabel = (logisticType: string): string => {
    return freightMap[logisticType] || logisticType || 'N/A';
};

const reputationLevelMap: Record<string, { label: string; color: string; icon: React.ElementType }> = {
    "5_green": { label: "MercadoLíder Platinum", color: "bg-green-500", icon: ShieldCheck },
    "4_green": { label: "MercadoLíder Gold", color: "bg-yellow-400", icon: ShieldCheck },
    "3_green": { label: "MercadoLíder", color: "bg-yellow-500", icon: ShieldCheck },
    "2_orange": { label: "Reputação Laranja", color: "bg-orange-500", icon: Shield },
    "1_red": { label: "Reputação Vermelha", color: "bg-red-500", icon: Shield },
};

// Dados extraídos do produto ML para treinamento
export interface MlProductInfo {
    productId: string;
    productName: string;
    brand: string | null;
    model: string | null;
    storage: string | null;
    ram: string | null;
    attributes?: { id: string; name: string; value_name: string | null }[]; // Atributos do produto para extração consistente
}

interface MlResultsTableProps {
    results: ProductResult[] | ProductResultWithViability[];
    onCreateListing?: (products: ProductResult[]) => void;
    canCreateListing?: boolean;
    selectedRowIds?: Record<string, boolean>;
    onToggleRowSelection?: (id: string) => void;
    onToggleSelectAll?: () => void;
    isAllVisibleSelected?: boolean;
    searchTerm?: string; // Termo de busca original (usado na página de busca manual)
    showViability?: boolean; // Mostrar análise de viabilidade
    onManualCostChange?: (productId: string, cost: number | null) => void; // Handler para custo manual
    onTrainMatch?: (productInfo: MlProductInfo) => void; // Handler para treinar match
}

// Helper para formatar moeda removido para usar o importado


// Componente para exibir viabilidade
const ViabilityBadge = ({
    margin,
    profit,
    type
}: {
    margin: number | null;
    profit: number | null;
    type: 'classic' | 'premium';
}) => {
    if (margin === null || profit === null) {
        return (
            <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Minus className="h-3 w-3" />
                <span>N/A</span>
            </div>
        );
    }

    const isViable = margin > 5;
    const isWarning = margin > 0 && margin <= 5;
    const isNotViable = margin <= 0;

    const bgColor = isViable ? 'bg-green-100 dark:bg-green-900/30' : isWarning ? 'bg-yellow-100 dark:bg-yellow-900/30' : 'bg-red-100 dark:bg-red-900/30';
    const textColor = isViable ? 'text-green-700 dark:text-green-300' : isWarning ? 'text-yellow-700 dark:text-yellow-300' : 'text-red-700 dark:text-red-300';
    const Icon = isViable ? TrendingUp : isNotViable ? TrendingDown : Minus;

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className={cn("flex items-center gap-1 px-2 py-1 rounded text-xs font-medium", bgColor, textColor)}>
                        <Icon className="h-3 w-3" />
                        <span>{margin.toFixed(1)}%</span>
                    </div>
                </TooltipTrigger>
                <TooltipContent>
                    <div className="text-xs space-y-1">
                        <div>Lucro {type === 'classic' ? 'Clássico' : 'Premium'}: {formatCurrency(profit)}</div>
                        <div>Margem: {margin.toFixed(2)}%</div>
                    </div>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

export function MlResultsTable({
    results,
    onCreateListing,
    canCreateListing = false,
    selectedRowIds = {},
    onToggleRowSelection,
    onToggleSelectAll,
    isAllVisibleSelected = false,
    searchTerm,
    showViability = false,
    onManualCostChange,
    onTrainMatch
}: MlResultsTableProps) {
    const [broken, setBroken] = useState<Set<string>>(new Set());
    const [editingCostId, setEditingCostId] = useState<string | null>(null);
    const [tempCost, setTempCost] = useState<string>('');


    // State para seleção com Shift
    const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

    // Calcular se todos visíveis estão selecionados
    const allVisibleSelected = useMemo(() => {
        if (results.length === 0) return false;
        return results.every(product => selectedRowIds[product.id]);
    }, [results, selectedRowIds]);

    // Calcular estatísticas dos selecionados
    const selectedStats = useMemo(() => {
        const selectedCount = Object.values(selectedRowIds).filter(Boolean).length;
        const total = results.length;
        return { count: selectedCount, total };
    }, [selectedRowIds, results]);

    const handleRowClick = (e: React.MouseEvent, productId: string) => {
        // Se clicou em um botão ou input, ignora
        if (
            (e.target as HTMLElement).closest('button') ||
            (e.target as HTMLElement).closest('input') ||
            (e.target as HTMLElement).closest('a') ||
            (e.target as HTMLElement).closest('[role="checkbox"]')
        ) {
            return;
        }

        // Toggle seleção
        if (onToggleRowSelection) {
            // Lógica para seleção com Shift
            if (e.shiftKey && lastSelectedId) {
                const lastIndex = results.findIndex(p => p.id === lastSelectedId);
                const currentIndex = results.findIndex(p => p.id === productId);

                if (lastIndex !== -1 && currentIndex !== -1) {
                    const start = Math.min(lastIndex, currentIndex);
                    const end = Math.max(lastIndex, currentIndex);

                    const idsToSelect = results.slice(start, end + 1).map(p => p.id);
                    // Aqui precisaríamos de uma função para selecionar múltiplos de uma vez
                    // Como não temos, vamos selecionar um por um (não ideal, mas funcional)
                    idsToSelect.forEach(id => {
                        if (selectedRowIds[id] !== selectedRowIds[lastSelectedId]) {
                            onToggleRowSelection(id);
                        }
                    });
                }
            } else {
                onToggleRowSelection(productId);
                setLastSelectedId(productId);
            }
        }
    };

    const handleSaveCost = () => {
        if (editingCostId && onManualCostChange) {
            const cost = parseFloat(tempCost.replace(',', '.'));
            if (!isNaN(cost)) {
                onManualCostChange(editingCostId, cost);
            } else if (tempCost === '') {
                onManualCostChange(editingCostId, null);
            }
            setEditingCostId(null);
            setTempCost('');
        }
    };

    if (results.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg bg-muted/10">
                <Package className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium text-foreground">Nenhum produto encontrado</h3>
                <p className="text-muted-foreground mt-1 max-w-sm">
                    Tente buscar com outros termos ou ajustar os filtros.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header de ações em massa */}
            <div className="flex items-center justify-between bg-muted/30 p-2 rounded-lg border">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="select-all"
                            checked={allVisibleSelected}
                            onCheckedChange={() => onToggleSelectAll && onToggleSelectAll()}
                        />
                        <label htmlFor="select-all" className="text-sm font-medium cursor-pointer select-none">
                            Selecionar todos ({results.length})
                        </label>
                    </div>
                    {selectedStats.count > 0 && (
                        <Badge variant="secondary" className="text-xs">
                            {selectedStats.count} selecionado{selectedStats.count !== 1 ? 's' : ''}
                        </Badge>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {canCreateListing && selectedStats.count > 0 && onCreateListing && (
                        <Button
                            size="sm"
                            onClick={() => {
                                const selectedProducts = results.filter(p => selectedRowIds[p.id]);
                                onCreateListing(selectedProducts);
                            }}
                            className="bg-green-600 hover:bg-green-700 text-white"
                        >
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Criar {selectedStats.count} Anúncio{selectedStats.count !== 1 ? 's' : ''}
                        </Button>
                    )}
                </div>
            </div>

            {/* Lista de cards */}
            {results.map((product) => {
                const isSelected = !!selectedRowIds[product.id];
                const permalink = product.permalink;
                const price = product.price;

                // Encontra a imagem principal (preferencialmente sem fundo ou resolução maior)
                const mainImage = product.pictures && product.pictures.length > 0
                    ? product.pictures[0].url
                    : product.thumbnail;

                const logisticType = product.shipping?.logistic_type;
                const isFull = logisticType === 'fulfillment';
                const isFreeShipping = product.shipping?.free_shipping;

                const reputation = product.seller?.seller_reputation?.level_id;
                const repData = reputation ? reputationLevelMap[reputation] : null;

                // Dados de enriquecimento
                const metrics = (product as any).metrics;
                const visits = metrics?.visits?.total || 0;
                const sold = product.sold_quantity || 0;
                // Taxa de conversão estimada (Vendas / Visitas) * 100
                const conversionRate = visits > 0 ? (sold / visits) * 100 : 0;

                // Review
                const reviews = (product as any).reviews;
                const reviewAverage = reviews?.rating_average || 0;
                const reviewCount = reviews?.total || 0;

                // Match score
                const matchResult = (product as any).originalProductName
                    ? calculateMatchScoreV2(
                        (product as any).originalProductName,
                        (product as any).originalProductDescription || '',
                        (product as any).originalProductModel || '',
                        {
                            name: product.name,
                            model: getAttributeValue(product.attributes, 'MODEL') || '',
                            brand: getAttributeValue(product.attributes, 'BRAND') || '',
                            attributes: product.attributes || []
                        }
                    )
                    : searchTerm
                        ? calculateSearchTermMatchScore(
                            searchTerm,
                            product.name,
                            getAttributeValue(product.attributes, 'MODEL') || ''
                        )
                        : { score: 0, type: 'none', matches: [] };

                const matchScore = matchResult.score;
                const matchType = matchResult.type;

                // Viabilidade
                const viability = showViability ? (product as ProductResultWithViability).viability : null;

                // Verifica se já está anunciado (simulação)
                const isPosted = (product as any).postedOn?.length > 0;

                return (
                    <Card
                        key={product.id}
                        className={cn(
                            "group relative overflow-hidden transition-all duration-200 border hover:shadow-md",
                            isSelected ? "border-primary/50 bg-primary/5 shadow-sm" : "border-border bg-card",
                            isPosted && !isSelected && "border-green-200 bg-green-50/30 dark:border-green-900/30 dark:bg-green-900/10"
                        )}
                        onClick={(e) => handleRowClick(e, product.id)}
                    >
                        {/* Indicador de Seleção Lateral */}
                        <div className={cn(
                            "absolute left-0 top-0 bottom-0 w-1 transition-colors z-10",
                            isSelected ? "bg-primary" : "bg-transparent group-hover:bg-primary/30"
                        )} />

                        <div className="flex flex-col sm:flex-row p-3 gap-3">
                            {/* Checkbox e Imagem */}
                            <div className="flex sm:flex-col items-start gap-3 sm:w-28 shrink-0">
                                <div className="absolute top-3 left-3 z-20 bg-background/80 backdrop-blur-sm rounded-sm">
                                    <Checkbox
                                        checked={isSelected}
                                        onCheckedChange={() => onToggleRowSelection && onToggleRowSelection(product.id)}
                                        className="translate-y-0.5"
                                    />
                                </div>

                                <div className="relative w-20 h-20 sm:w-28 sm:h-28 rounded-md overflow-hidden bg-white border self-center sm:self-auto mt-6 sm:mt-0">
                                    <Image
                                        src={mainImage}
                                        alt={product.name}
                                        fill
                                        className={cn(
                                            "object-contain p-1 transition-opacity",
                                            broken.has(product.id) ? "opacity-0" : "opacity-100"
                                        )}
                                        onError={() => setBroken(prev => new Set(prev).add(product.id))}
                                        unoptimized
                                    />
                                    {broken.has(product.id) && (
                                        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-muted">
                                            <Package className="h-8 w-8 opacity-20" />
                                        </div>
                                    )}

                                    {/* Badges sobre a imagem */}
                                    <div className="absolute bottom-1 right-1 flex flex-col gap-1 items-end">
                                        {isFull && <div className="shadow-sm"><FullIcon className="h-4 w-auto drop-shadow-sm" /></div>}
                                        {isFreeShipping && !isFull && (
                                            <div className="bg-green-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm flex items-center gap-0.5">
                                                <Truck className="h-2.5 w-2.5" />
                                                Gratis
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {matchScore > 0 && (matchType === 'high' || matchType === 'medium') && (
                                    <div className="w-full mt-1">
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <div className={cn(
                                                        "flex items-center justify-center gap-1 text-[10px] font-medium py-0.5 px-1.5 rounded-full w-full border text-center cursor-help",
                                                        matchType === 'high'
                                                            ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:border-green-800"
                                                            : "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800"
                                                    )}>
                                                        {matchType === 'high' ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                                                        Match {matchScore}%
                                                    </div>
                                                </TooltipTrigger>
                                                <TooltipContent side="right" className="max-w-xs">
                                                    <p className="font-semibold mb-1">Detalhes da Correspondência:</p>
                                                    <ul className="list-disc pl-4 space-y-0.5 text-xs">
                                                        {matchResult.matches.map((m, i) => (
                                                            <li key={i}>{m}</li>
                                                        ))}
                                                    </ul>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </div>
                                )}
                            </div>

                            {/* Conteúdo Principal */}
                            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                                {/* Título e Badges */}
                                <div>
                                    <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                                        <Link
                                            href={permalink}
                                            target="_blank"
                                            className="text-sm font-medium text-foreground hover:text-primary leading-tight line-clamp-2 hover:underline decoration-primary/50 underline-offset-2 flex-1"
                                        >
                                            {product.name}
                                            <ExternalLink className="inline-block h-3 w-3 ml-1 text-muted-foreground/50 align-top" />
                                        </Link>
                                        <div className="flex items-center gap-1 shrink-0">
                                            {isPosted && (
                                                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:border-green-800 text-[10px] h-5 px-1.5 gap-1">
                                                    <CheckCircle className="h-3 w-3" />
                                                    Anunciado
                                                </Badge>
                                            )}
                                            {product.condition === 'new' && (
                                                <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-normal">Novo</Badge>
                                            )}
                                            {product.condition === 'used' && (
                                                <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-normal">Usado</Badge>
                                            )}
                                        </div>
                                    </div>

                                    {/* Seller Info - Compacto */}
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mb-2">
                                        <div className="flex items-center gap-1">
                                            <Users className="h-3 w-3" />
                                            <span className="font-medium text-foreground/80 truncate max-w-[150px]">
                                                {product.seller?.nickname || 'Vendedor Desconhecido'}
                                            </span>
                                        </div>
                                        {repData && (
                                            <div className="flex items-center gap-1" title={repData.label}>
                                                <div className={`w-2 h-2 rounded-full ${repData.color}`} />
                                                <span className="text-[10px]">{repData.label.replace('MercadoLíder ', '')}</span>
                                            </div>
                                        )}
                                        {product.seller?.seller_reputation?.transactions?.total && (
                                            <span className="text-[10px]">
                                                • {product.seller.seller_reputation.transactions.total.toLocaleString()} vendas
                                            </span>
                                        )}
                                        <span className="text-[10px] flex items-center gap-1">
                                            • <span className="text-foreground/70">{product.address?.city_name || 'Localização não inf.'} - {product.address?.state_name}</span>
                                        </span>
                                    </div>
                                </div>

                                {/* Preço e Métricas */}
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs py-2 border-t border-b bg-muted/10 -mx-3 px-3 sm:mx-0 sm:px-2 sm:rounded-md">
                                    {/* Coluna 1: Preço */}
                                    <div className="flex flex-col justify-center">
                                        <span className="text-xs text-muted-foreground mb-0.5">Preço Atual</span>
                                        <div className="flex items-baseline gap-1.5">
                                            <span className="text-lg font-bold text-foreground">
                                                {formatCurrency(price)}
                                            </span>
                                            {product.original_price && product.original_price > price && (
                                                <span className="text-xs text-muted-foreground line-through decoration-red-400">
                                                    {formatCurrency(product.original_price)}
                                                </span>
                                            )}
                                        </div>
                                        {product.installments && (
                                            <span className={cn(
                                                "text-[10px]",
                                                product.installments.rate === 0 ? "text-green-600 font-medium" : "text-muted-foreground"
                                            )}>
                                                {product.installments.quantity}x {formatCurrency(product.installments.amount)}
                                                {product.installments.rate === 0 && ' s/ juros'}
                                            </span>
                                        )}
                                    </div>

                                    {/* Coluna 2: Desempenho */}
                                    <div className="flex flex-col justify-center gap-1">
                                        <span className="text-xs text-muted-foreground">Desempenho</span>
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-1 text-slate-700 dark:text-slate-300" title="Vendas Totais">
                                                <Package className="h-3.5 w-3.5" />
                                                <span className="font-semibold">{sold > 999 ? '+1000' : sold}</span>
                                            </div>
                                            {visits > 0 && (
                                                <div className="flex items-center gap-1 text-blue-700 dark:text-blue-300" title="Visitas Totais">
                                                    <Eye className="h-3.5 w-3.5" />
                                                    <span className="font-semibold">{visits > 999 ? (visits / 1000).toFixed(1) + 'k' : visits}</span>
                                                </div>
                                            )}
                                        </div>
                                        {conversionRate > 0 && (
                                            <div className="text-[10px] text-muted-foreground">
                                                Conv: <span className={cn(
                                                    "font-medium",
                                                    conversionRate > 1.5 ? "text-green-600" : conversionRate > 0.5 ? "text-yellow-600" : "text-red-600"
                                                )}>{conversionRate.toFixed(2)}%</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Coluna 3: Opiniões (se houver) */}
                                    <div className="flex flex-col justify-center gap-1">
                                        <span className="text-xs text-muted-foreground">Opiniões</span>
                                        {reviewCount > 0 ? (
                                            <div>
                                                <div className="flex items-center gap-1">
                                                    <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                                                    <span className="font-bold text-amber-700 dark:text-amber-400">{reviewAverage.toFixed(1)}</span>
                                                    <span className="text-[10px] text-muted-foreground">({reviewCount})</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <span className="text-[10px] text-muted-foreground italic">Sem avaliações</span>
                                        )}
                                    </div>

                                    {/* Coluna 4: Logística */}
                                    <div className="flex flex-col justify-center gap-1">
                                        <span className="text-xs text-muted-foreground">Logística</span>
                                        <div className={cn(
                                            "flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-sm w-fit",
                                            isFull ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                        )}>
                                            {isFull ? <FullIcon className="h-3 w-auto" /> : <Truck className="h-3 w-3" />}
                                            {getShippingLabel(logisticType || '')}
                                        </div>
                                        {product.shipping?.tags?.includes('self_service_in') && (
                                            <span className="text-[10px] text-orange-600 dark:text-orange-400 flex items-center gap-1">
                                                <AlertCircle className="h-2.5 w-2.5" />
                                                Flex
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Gráfico de Preços */}
                                {(product as any).priceHistory && (product as any).priceHistory.length >= 2 && (
                                    <div className="mt-2">
                                        <PriceHistoryChart
                                            data={(product as any).priceHistory}
                                            currentPrice={product.price}
                                            className="h-[100px]"
                                        />
                                    </div>
                                )}

                                {/* Análise de Viabilidade (se ativado) */}
                                {viability && (
                                    <div className="mt-2 p-2 bg-slate-50 dark:bg-slate-900/20 rounded-md border border-slate-100 dark:border-slate-800 flex flex-col gap-2">
                                        {(() => {
                                            // Handle manual cost change
                                            const handleSaveCost = () => {
                                                if (!editingCostId || !onManualCostChange) return;
                                                const numericCost = parseFloat(tempCost.replace(',', '.'));
                                                if (!isNaN(numericCost)) {
                                                    onManualCostChange(editingCostId, numericCost);
                                                } else if (tempCost === '') {
                                                    onManualCostChange(editingCostId, null);

                                                }
                                                setEditingCostId(null);
                                                setTempCost('');
                                            };

                                            return (
                                                <div className="space-y-3">
                                                    {/* Custo */}
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs text-muted-foreground w-16">Custo:</span>
                                                        {editingCostId === product.id ? (
                                                            <div className="flex items-center gap-1">
                                                                <Input
                                                                    type="text"
                                                                    value={tempCost}
                                                                    onChange={(e) => setTempCost(e.target.value)}
                                                                    placeholder="0,00"
                                                                    className="h-7 w-24 text-xs"
                                                                    autoFocus
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter') handleSaveCost();
                                                                        if (e.key === 'Escape') {
                                                                            setEditingCostId(null);
                                                                            setTempCost('');
                                                                        }
                                                                    }}
                                                                />
                                                                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={handleSaveCost}>
                                                                    OK
                                                                </Button>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-1">
                                                                {viability.cost !== null ? (
                                                                    <>
                                                                        <span className="text-sm font-semibold">{formatCurrency(viability.cost)}</span>
                                                                        <TooltipProvider>
                                                                            <Tooltip>
                                                                                <TooltipTrigger asChild>
                                                                                    <Badge variant="outline" className="text-[10px] h-4 px-1">
                                                                                        {viability.costSource === 'feed' ? 'Feed' : 'Manual'}
                                                                                    </Badge>
                                                                                </TooltipTrigger>
                                                                                <TooltipContent>
                                                                                    {viability.matchedProductName && (
                                                                                        <p className="text-xs">Match: {viability.matchedProductName}</p>
                                                                                    )}
                                                                                    <p className="text-xs">Confiança: {viability.matchConfidence}</p>
                                                                                </TooltipContent>
                                                                            </Tooltip>
                                                                        </TooltipProvider>
                                                                        {onManualCostChange && (
                                                                            <Button
                                                                                size="sm"
                                                                                variant="ghost"
                                                                                className="h-5 w-5 p-0"
                                                                                onClick={() => {
                                                                                    setEditingCostId(product.id);
                                                                                    setTempCost(viability.cost?.toFixed(2).replace('.', ',') || '');
                                                                                }}
                                                                            >
                                                                                <Edit2 className="h-3 w-3" />
                                                                            </Button>
                                                                        )}
                                                                    </>
                                                                ) : (
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-xs text-muted-foreground">Não encontrado</span>
                                                                        <div className="flex items-center gap-1">
                                                                            {onManualCostChange && (
                                                                                <Button
                                                                                    size="sm"
                                                                                    variant="outline"
                                                                                    className="h-6 text-xs"
                                                                                    onClick={() => {
                                                                                        setEditingCostId(product.id);
                                                                                        setTempCost('');
                                                                                    }}
                                                                                >
                                                                                    Informar
                                                                                </Button>
                                                                            )}
                                                                            {onTrainMatch && (
                                                                                <TooltipProvider>
                                                                                    <Tooltip>
                                                                                        <TooltipTrigger asChild>
                                                                                            <Button
                                                                                                size="sm"
                                                                                                variant="outline"
                                                                                                className="h-6 text-xs gap-1 text-purple-600 border-purple-300 hover:bg-purple-50"
                                                                                                onClick={() => {
                                                                                                    // Extrair brand do atributo
                                                                                                    const brandAttr = product.attributes?.find(a => a.id === 'BRAND');
                                                                                                    const modelAttr = product.attributes?.find(a => a.id === 'MODEL');
                                                                                                    onTrainMatch({
                                                                                                        productId: product.id,
                                                                                                        productName: product.name,
                                                                                                        brand: brandAttr?.value_name || null,
                                                                                                        model: modelAttr?.value_name || null,
                                                                                                        storage: null, // Será extraído na página
                                                                                                        ram: null, // Será extraído na página
                                                                                                        attributes: product.attributes // Passar atributos para extração consistente
                                                                                                    });
                                                                                                }}
                                                                                            >
                                                                                                <GraduationCap className="h-3 w-3" />
                                                                                                Treinar
                                                                                            </Button>
                                                                                        </TooltipTrigger>
                                                                                        <TooltipContent>
                                                                                            <p className="text-xs">Vincular este produto a um produto do Feed para melhorar o reconhecimento futuro</p>
                                                                                        </TooltipContent>
                                                                                    </Tooltip>
                                                                                </TooltipProvider>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Produto Encontrado no Feed */}
                                                    {viability.costSource === 'feed' && (viability.matchedProductSku || viability.matchedProductName) && (
                                                        <div className="flex items-start gap-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
                                                            <span className="text-xs text-blue-600 dark:text-blue-400 font-medium whitespace-nowrap">📦 Feed:</span>
                                                            <div className="flex-1 min-w-0">
                                                                {viability.matchedProductSku && (
                                                                    <span className="text-xs font-mono bg-blue-100 dark:bg-blue-800 px-1.5 py-0.5 rounded mr-2">
                                                                        {viability.matchedProductSku}
                                                                    </span>
                                                                )}
                                                                {viability.matchedProductName && (
                                                                    <span className="text-xs text-blue-700 dark:text-blue-300">
                                                                        {viability.matchedProductName}
                                                                    </span>
                                                                )}
                                                                <Badge variant="outline" className="ml-2 text-[10px] h-4 px-1">
                                                                    {viability.matchConfidence === 'high' ? '✓ Alta' : viability.matchConfidence === 'medium' ? '~ Média' : '? Baixa'}
                                                                </Badge>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Margens */}
                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div className="space-y-1">
                                                            <span className="text-xs text-muted-foreground">Margem Clássico:</span>
                                                            <ViabilityBadge
                                                                margin={viability.classic.margin}
                                                                profit={viability.classic.profit}
                                                                type="classic"
                                                            />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <span className="text-xs text-muted-foreground">Margem Premium:</span>
                                                            <ViabilityBadge
                                                                margin={viability.premium.margin}
                                                                profit={viability.premium.profit}
                                                                type="premium"
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Detalhes do cálculo */}
                                                    {viability.cost !== null && (
                                                        <div className="text-[10px] text-muted-foreground border-t pt-2 mt-2">
                                                            <div className="grid grid-cols-2 gap-2">
                                                                {viability.classic.profit !== null && (
                                                                    <div>
                                                                        <span className="font-medium">Clássico:</span> {formatCurrency(product.classicPrice ?? null)} - {formatCurrency(product.classicFees?.sale_fee_amount || 0)} - {formatCurrency(product.classicFees?.shipping_cost || 0)} - {formatCurrency(viability.cost)} = <span className={cn("font-bold", viability.classic.profit >= 0 ? "text-green-600" : "text-red-600")}>{formatCurrency(viability.classic.profit)}</span>
                                                                    </div>
                                                                )}
                                                                {viability.premium.profit !== null && (
                                                                    <div>
                                                                        <span className="font-medium">Premium:</span> {formatCurrency(product.premiumPrice ?? null)} - {formatCurrency(product.premiumFees?.sale_fee_amount || 0)} - {formatCurrency(product.premiumFees?.shipping_cost || 0)} - {formatCurrency(viability.cost)} = <span className={cn("font-bold", viability.premium.profit >= 0 ? "text-green-600" : "text-red-600")}>{formatCurrency(viability.premium.profit)}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                )}

                                {/* Seção de Perguntas - Layout melhorado */}
                                {(product as any).questions?.length > 0 && (
                                    <Accordion type="single" collapsible className="w-full mt-2">
                                        <AccordionItem value="questions" className="border rounded-lg overflow-hidden">
                                            <AccordionTrigger className="text-xs hover:no-underline px-3 py-2 bg-purple-50 dark:bg-purple-900/20">
                                                <span className="flex items-center gap-1.5 text-purple-700 dark:text-purple-300">
                                                    <HelpCircle className="h-3.5 w-3.5" />
                                                    <span className="font-medium">Perguntas Frequentes</span>
                                                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                                                        {(product as any).questions.length}
                                                    </Badge>
                                                </span>
                                            </AccordionTrigger>
                                            <AccordionContent className="px-3 pb-3 pt-2">
                                                <div className="space-y-3">
                                                    {(product as any).questions.slice(0, 5).map((q: any, index: number) => (
                                                        <div key={q.id} className="bg-muted/30 rounded-lg p-3 space-y-2">
                                                            <div className="flex items-start gap-2">
                                                                <div className="flex items-center justify-center w-5 h-5 bg-purple-100 dark:bg-purple-800 rounded-full flex-shrink-0 mt-0.5">
                                                                    <span className="text-[10px] font-bold text-purple-600 dark:text-purple-300">{index + 1}</span>
                                                                </div>
                                                                <p className="text-xs text-foreground leading-relaxed">{q.text}</p>
                                                            </div>
                                                            {q.answer && (
                                                                <div className="flex items-start gap-2 ml-7 pl-3 border-l-2 border-green-300 dark:border-green-700">
                                                                    <CheckCircle className="h-3.5 w-3.5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                                                                    <p className="text-xs text-green-700 dark:text-green-400 leading-relaxed">{q.answer.text}</p>
                                                                </div>
                                                            )}
                                                            {!q.answer && (
                                                                <div className="flex items-center gap-1 ml-7">
                                                                    <AlertCircle className="h-3 w-3 text-amber-500" />
                                                                    <span className="text-[10px] text-amber-600 dark:text-amber-400">Sem resposta</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                    {(product as any).questions.length > 5 && (
                                                        <p className="text-[10px] text-muted-foreground text-center pt-1">
                                                            +{(product as any).questions.length - 5} perguntas adicionais
                                                        </p>
                                                    )}
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                    </Accordion>
                                )}

                                {/* Simulação de Frete - Layout melhorado */}
                                {(product as any).shippingOptions?.length > 0 && (
                                    <Accordion type="single" collapsible className="w-full mt-2">
                                        <AccordionItem value="shipping" className="border rounded-lg overflow-hidden">
                                            <AccordionTrigger className="text-xs hover:no-underline px-3 py-2 bg-orange-50 dark:bg-orange-900/20">
                                                <span className="flex items-center gap-1.5 text-orange-700 dark:text-orange-300">
                                                    <Truck className="h-3.5 w-3.5" />
                                                    <span className="font-medium">Opções de Frete</span>
                                                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                                                        {(product as any).shippingOptions.length}
                                                    </Badge>
                                                </span>
                                            </AccordionTrigger>
                                            <AccordionContent className="px-3 pb-3 pt-2">
                                                <div className="space-y-2">
                                                    {(product as any).shippingOptions.map((opt: any) => (
                                                        <div
                                                            key={opt.id}
                                                            className={cn(
                                                                "flex items-center justify-between p-2 rounded-md border",
                                                                opt.cost === 0
                                                                    ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                                                                    : "bg-muted/30"
                                                            )}
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <div className={cn(
                                                                    "flex items-center justify-center w-6 h-6 rounded-full",
                                                                    opt.cost === 0
                                                                        ? "bg-green-100 dark:bg-green-800"
                                                                        : "bg-muted"
                                                                )}>
                                                                    <Truck className={cn(
                                                                        "h-3 w-3",
                                                                        opt.cost === 0
                                                                            ? "text-green-600 dark:text-green-400"
                                                                            : "text-muted-foreground"
                                                                    )} />
                                                                </div>
                                                                <span className="text-xs font-medium">{opt.name}</span>
                                                            </div>
                                                            <div className="flex items-center gap-3">
                                                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                                    <Clock className="h-3 w-3" />
                                                                    <span>{opt.estimated_delivery_time?.offset?.shipping || '?'}d</span>
                                                                </div>
                                                                <span className={cn(
                                                                    "text-xs font-bold px-2 py-0.5 rounded",
                                                                    opt.cost === 0
                                                                        ? "text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-800"
                                                                        : "text-foreground"
                                                                )}>
                                                                    {opt.cost === 0 ? 'GRÁTIS' : formatBRL(opt.cost)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                    </Accordion>
                                )}

                                {/* Ficha Técnica - Atributos do Catálogo */}
                                {product.attributes && product.attributes.length > 0 && (
                                    <Accordion type="single" collapsible className="w-full mt-2">
                                        <AccordionItem value="specs" className="border rounded-lg overflow-hidden">
                                            <AccordionTrigger className="text-xs hover:no-underline px-3 py-2 bg-slate-50 dark:bg-slate-900/20">
                                                <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                                                    <Package className="h-3.5 w-3.5" />
                                                    <span className="font-medium">Ficha Técnica</span>
                                                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                                                        {product.attributes.length} atributos
                                                    </Badge>
                                                </span>
                                            </AccordionTrigger>
                                            <AccordionContent className="px-3 pb-3 pt-2">
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                    {product.attributes
                                                        .filter(attr => attr.value_name !== null && attr.value_name !== '')
                                                        .map((attr, index) => (
                                                            <div
                                                                key={`${attr.id}-${index}`}
                                                                className="flex items-start gap-2 p-2 bg-muted/30 rounded-md"
                                                            >
                                                                <div className="min-w-0 flex-1">
                                                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">
                                                                        {attr.name}
                                                                    </p>
                                                                    <p className="text-xs font-medium text-foreground truncate">
                                                                        {attr.value_name}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        ))
                                                    }
                                                </div>
                                                {/* Atributos principais em destaque */}
                                                {(() => {
                                                    const mainAttrs = ['BRAND', 'MODEL', 'INTERNAL_MEMORY', 'RAM', 'COLOR', 'PROCESSOR_MODEL', 'SCREEN_SIZE', 'BATTERY_CAPACITY'];
                                                    const highlighted = product.attributes.filter(a => mainAttrs.includes(a.id) && a.value_name);
                                                    if (highlighted.length === 0) return null;
                                                    return (
                                                        <div className="mt-3 pt-3 border-t">
                                                            <p className="text-[10px] text-muted-foreground mb-2 font-medium">Características Principais:</p>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {highlighted.map((attr, idx) => (
                                                                    <Badge
                                                                        key={`main-${attr.id}-${idx}`}
                                                                        variant="outline"
                                                                        className="text-[10px] px-2 py-0.5"
                                                                    >
                                                                        <span className="text-muted-foreground mr-1">{attr.name}:</span>
                                                                        <span className="font-semibold">{attr.value_name}</span>
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </AccordionContent>
                                        </AccordionItem>
                                    </Accordion>
                                )}

                            </div>
                        </div>

                    </Card>
                )
            })}
        </div>
    );
}


