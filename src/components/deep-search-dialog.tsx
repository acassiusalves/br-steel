'use client';

import * as React from 'react';
import { Search, Zap, Settings2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { ProductResult } from '@/services/mercadolivre';
import type { DeepSearchConfig } from '@/lib/deep-search-types';
import { DEFAULT_DEEP_SEARCH_CONFIG } from '@/lib/deep-search-types';

interface DeepSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedProducts: ProductResult[];
  onStart: (config: DeepSearchConfig) => void;
}

export function DeepSearchDialog({
  open,
  onOpenChange,
  selectedProducts,
  onStart,
}: DeepSearchDialogProps) {
  const [maxResults, setMaxResults] = React.useState(DEFAULT_DEEP_SEARCH_CONFIG.maxTotalResults);
  const [confidenceThreshold, setConfidenceThreshold] = React.useState(
    DEFAULT_DEEP_SEARCH_CONFIG.confidenceThreshold * 100
  );
  const [includeEnrichment, setIncludeEnrichment] = React.useState(
    DEFAULT_DEEP_SEARCH_CONFIG.includeEnrichment
  );

  const handleStart = () => {
    const config: DeepSearchConfig = {
      baseProducts: selectedProducts,
      maxResultsPerQuery: DEFAULT_DEEP_SEARCH_CONFIG.maxResultsPerQuery,
      maxTotalResults: maxResults,
      confidenceThreshold: confidenceThreshold / 100,
      includeEnrichment,
    };
    onStart(config);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            Deep Search
          </DialogTitle>
          <DialogDescription>
            Encontre o máximo de anúncios para produtos idênticos aos selecionados.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Produtos Selecionados */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              Produtos Base ({selectedProducts.length})
            </Label>
            <ScrollArea className="h-[120px] rounded-md border p-2">
              <div className="space-y-2">
                {selectedProducts.map((product) => (
                  <div
                    key={product.id}
                    className="flex items-center gap-3 rounded-lg bg-muted/50 p-2"
                  >
                    {product.thumbnail && (
                      <img
                        src={product.thumbnail}
                        alt={product.name}
                        className="h-10 w-10 rounded object-cover"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{product.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[10px] px-1 py-0">
                          {product.brand}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {product.model}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Configurações */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Settings2 className="h-4 w-4" />
              Configurações
            </div>

            {/* Máximo de Resultados */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="maxResults" className="text-sm">
                  Máximo de resultados
                </Label>
                <span className="text-sm font-medium text-primary">{maxResults}</span>
              </div>
              <Slider
                id="maxResults"
                min={100}
                max={1000}
                step={50}
                value={[maxResults]}
                onValueChange={([value]) => setMaxResults(value)}
                className="w-full"
              />
              <p className="text-[10px] text-muted-foreground">
                Quanto mais resultados, mais tempo a busca levará.
              </p>
            </div>

            {/* Threshold de Confiança */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="confidence" className="text-sm">
                  Threshold de confiança
                </Label>
                <span className="text-sm font-medium text-primary">{confidenceThreshold}%</span>
              </div>
              <Slider
                id="confidence"
                min={50}
                max={100}
                step={5}
                value={[confidenceThreshold]}
                onValueChange={([value]) => setConfidenceThreshold(value)}
                className="w-full"
              />
              <p className="text-[10px] text-muted-foreground">
                Menor threshold = mais resultados, porém menos precisos.
              </p>
            </div>

            {/* Enriquecimento */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="enrichment" className="text-sm font-medium">
                  Incluir enriquecimento
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  Buscar visitas, reviews e dados adicionais
                </p>
              </div>
              <Switch
                id="enrichment"
                checked={includeEnrichment}
                onCheckedChange={setIncludeEnrichment}
              />
            </div>
          </div>

          {/* Aviso */}
          <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <p className="text-xs">
              O Deep Search usa IA para encontrar produtos idênticos. O processo pode levar
              alguns minutos dependendo quantidade de produtos e configurações.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleStart} className="gap-2">
            <Zap className="h-4 w-4" />
            Iniciar Deep Search
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
