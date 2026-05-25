'use client';

import * as React from 'react';
import { BarChart3, Gauge, Search, Settings2, Sparkles, Zap, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { DEFAULT_DEEP_SEARCH_CONFIG, type DeepSearchConfig, type DeepSearchDepth, type DeepSearchFocus } from '@/lib/deep-search-types';
import type { MercadoLivreSearchItem, MercadoLivreVisitsWindow } from '@/types/mercado-livre-catalog-search';

interface DeepSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedProducts: MercadoLivreSearchItem[];
  onStart: (config: DeepSearchConfig) => void;
}

const FOCUS_OPTIONS: Array<{ value: DeepSearchFocus; label: string; icon: LucideIcon }> = [
  { value: 'opportunity', label: 'Oportunidades', icon: Sparkles },
  { value: 'performance', label: 'Performance', icon: BarChart3 },
  { value: 'similarity', label: 'Similaridade', icon: Search },
];

const DEPTH_OPTIONS: Array<{ value: DeepSearchDepth; label: string }> = [
  { value: 'balanced', label: 'Equilibrada' },
  { value: 'deep', label: 'Profunda' },
  { value: 'maximum', label: 'Máxima' },
];

const VISITS_WINDOW_OPTIONS: Array<{ value: MercadoLivreVisitsWindow; label: string }> = [
  { value: 1, label: 'Hoje' },
  { value: 3, label: '3 dias' },
  { value: 7, label: '7 dias' },
  { value: 15, label: '15 dias' },
  { value: 30, label: '30 dias' },
];

function formatPrice(value: number | null) {
  if (value === null) return 'N/A';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function parseOptionalNumber(value: string) {
  const normalized = value.replace(',', '.').trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTerms(value: string) {
  return value
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 6);
}

export function DeepSearchDialog({
  open,
  onOpenChange,
  selectedProducts,
  onStart,
}: DeepSearchDialogProps) {
  const [depth, setDepth] = React.useState<DeepSearchDepth>(DEFAULT_DEEP_SEARCH_CONFIG.depth);
  const [focus, setFocus] = React.useState<DeepSearchFocus>(DEFAULT_DEEP_SEARCH_CONFIG.focus);
  const [maxResults, setMaxResults] = React.useState(DEFAULT_DEEP_SEARCH_CONFIG.maxTotalResults);
  const [maxResultsPerQuery] = React.useState(50);
  const [similarityThreshold, setSimilarityThreshold] = React.useState(DEFAULT_DEEP_SEARCH_CONFIG.similarityThreshold);
  const [visitsWindow, setVisitsWindow] = React.useState<MercadoLivreVisitsWindow>(DEFAULT_DEEP_SEARCH_CONFIG.visitsWindow);
  const [includeCatalogSearch, setIncludeCatalogSearch] = React.useState(DEFAULT_DEEP_SEARCH_CONFIG.includeCatalogSearch);
  const [includeEnrichment, setIncludeEnrichment] = React.useState(DEFAULT_DEEP_SEARCH_CONFIG.includeEnrichment);
  const [includeUsed, setIncludeUsed] = React.useState(DEFAULT_DEEP_SEARCH_CONFIG.includeUsed);
  const [priceMin, setPriceMin] = React.useState('');
  const [priceMax, setPriceMax] = React.useState('');
  const [customTerms, setCustomTerms] = React.useState('');

  const estimatedBaseQueriesPerProduct = depth === 'balanced' ? 6 : depth === 'deep' ? 11 : 14;
  const estimatedExplorationQueries =
    depth === 'balanced' ? 30 : depth === 'deep' ? 90 : 200;
  const estimatedQueries = selectedProducts.length * estimatedBaseQueriesPerProduct + estimatedExplorationQueries;

  const handleStart = () => {
    const config: DeepSearchConfig = {
      baseProducts: selectedProducts,
      depth,
      focus,
      maxResultsPerQuery,
      maxTotalResults: maxResults,
      similarityThreshold,
      includeEnrichment,
      includeCatalogSearch,
      includeUsed,
      visitsWindow,
      priceMin: parseOptionalNumber(priceMin),
      priceMax: parseOptionalNumber(priceMax),
      customTerms: parseTerms(customTerms),
    };

    onStart(config);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            Deep Search de Mercado
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[68vh] pr-3">
          <div className="space-y-6 py-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-sm font-medium">Produtos base</Label>
                <Badge variant="secondary">{selectedProducts.length} selecionado(s)</Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {selectedProducts.slice(0, 6).map((product) => (
                  <div key={product.id} className="flex min-w-0 items-center gap-3 rounded-md border bg-muted/20 p-2">
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md border bg-white">
                      {product.thumbnail ? (
                        <img src={product.thumbnail} alt={product.title} className="h-full w-full object-contain" />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold">{product.title}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {product.brand || 'Marca N/A'} · {formatPrice(product.price)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Gauge className="h-4 w-4" />
                Prioridade
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {FOCUS_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const active = focus === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setFocus(option.value)}
                      className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
                        active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Profundidade</Label>
                <Select value={depth} onValueChange={(value) => setDepth(value as DeepSearchDepth)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPTH_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Janela de visitas</Label>
                <Select value={String(visitsWindow)} onValueChange={(value) => setVisitsWindow(Number(value) as MercadoLivreVisitsWindow)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VISITS_WINDOW_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={String(option.value)}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Similaridade mínima</Label>
                  <span className="text-sm font-semibold text-primary">{similarityThreshold}%</span>
                </div>
                <Slider
                  min={35}
                  max={90}
                  step={5}
                  value={[similarityThreshold]}
                  onValueChange={([value]) => setSimilarityThreshold(value)}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Resultados finais</Label>
                  <span className="text-sm font-semibold text-primary">{maxResults}</span>
                </div>
                <Slider
                  min={50}
                  max={600}
                  step={50}
                  value={[maxResults]}
                  onValueChange={([value]) => setMaxResults(value)}
                />
              </div>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <Label>Resultados por termo</Label>
                <span className="text-sm font-semibold text-primary">50 primeiros</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Cada termo de categoria é consultado individualmente e os 50 primeiros anúncios são agregados com contagem de recorrência.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <SwitchRow label="Buscar catálogos" checked={includeCatalogSearch} onCheckedChange={setIncludeCatalogSearch} />
              <SwitchRow label="Enriquecer dados" checked={includeEnrichment} onCheckedChange={setIncludeEnrichment} />
              <SwitchRow label="Incluir usados" checked={includeUsed} onCheckedChange={setIncludeUsed} />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Preço mínimo</Label>
                <Input value={priceMin} onChange={(event) => setPriceMin(event.target.value)} inputMode="decimal" placeholder="Opcional" />
              </div>
              <div className="space-y-2">
                <Label>Preço máximo</Label>
                <Input value={priceMax} onChange={(event) => setPriceMax(event.target.value)} inputMode="decimal" placeholder="Opcional" />
              </div>
              <div className="space-y-2">
                <Label>Termos extras</Label>
                <Input value={customTerms} onChange={(event) => setCustomTerms(event.target.value)} placeholder="Ex.: pro, 5g" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              <Settings2 className="h-3.5 w-3.5" />
              <span>{estimatedQueries} buscas estimadas</span>
              <span>·</span>
              <span>até {estimatedQueries * maxResultsPerQuery} candidatos brutos</span>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleStart} disabled={selectedProducts.length === 0} className="gap-2">
            <Zap className="h-4 w-4" />
            Iniciar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SwitchRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
      <Label className="text-sm">{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
