
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";


type DynamicFilterOption = {
  id: string;
  name: string;
  options: { name: string, count: number }[];
};

type CountOption = {
    name: string;
    count: number;
}

type StoreTypeOptions = {
    official: number;
    nonOfficial: number;
};

type FiltersSidebarProps = {
  dynamicFilterOptions: DynamicFilterOption[];
  brandOptions: CountOption[];
  shippingOptions: CountOption[];
  storeTypeOptions: StoreTypeOptions;
  activeFilters: Record<string, string[]>;
  selectedBrands: string[];
  selectedShipping: string[];
  selectedStoreTypes: string[];
  brandSearch: string;
  modelSearch: string;
  onFilterChange: (filterId: string, values: string[]) => void;
  onBrandChange: (brands: string[]) => void;
  onShippingChange: (shipping: string[]) => void;
  onStoreTypeChange: (storeTypes: string[]) => void;
  onBrandSearchChange: (search: string) => void;
  onModelSearchChange: (search: string) => void;
  className?: string;
};

export function FiltersSidebar({
  dynamicFilterOptions,
  brandOptions,
  shippingOptions,
  storeTypeOptions,
  activeFilters,
  selectedBrands,
  selectedShipping,
  selectedStoreTypes,
  brandSearch,
  modelSearch,
  onFilterChange,
  onBrandChange,
  onShippingChange,
  onStoreTypeChange,
  onBrandSearchChange,
  onModelSearchChange,
  className,
}: FiltersSidebarProps) {

  const handleCheckboxToggle = (
    currentSelection: string[],
    setter: (newSelection: string[]) => void,
    value: string
  ) => {
    const newSelection = currentSelection.includes(value)
      ? currentSelection.filter(v => v !== value)
      : [...currentSelection, value];
    setter(newSelection);
  };

  const handleDynamicFilterToggle = (filterId: string, value: string) => {
    const currentValues = activeFilters[filterId] || [];
    const newSelection = currentValues.includes(value)
      ? currentValues.filter(v => v !== value)
      : [...currentValues, value];
    onFilterChange(filterId, newSelection);
  };


  const clearAll = () => {
    const clearedFilters: Record<string, string[]> = {};
    for (const key in activeFilters) {
      clearedFilters[key] = [];
    }
    Object.keys(clearedFilters).forEach(key => onFilterChange(key, []));
    onBrandChange([]);
    onShippingChange([]);
    onStoreTypeChange([]);
    onBrandSearchChange("");
    onModelSearchChange("");
  };

  const filteredBrands = React.useMemo(() => {
    if (!brandSearch) return brandOptions;
    return brandOptions.filter(b => b.name.toLowerCase().includes(brandSearch.toLowerCase()));
  }, [brandOptions, brandSearch]);

  return (
    <aside className={`w-full md:w-64 shrink-0 ${className}`}>
      <div className="rounded-lg border bg-card p-4 sticky top-20">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Filtros</h3>
          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={clearAll}>
            Limpar
          </Button>
        </div>
        
        <ScrollArea className="h-[calc(100vh-12rem)] pr-4 -mr-4">
        <Accordion type="multiple" defaultValue={['store-type', 'shipping', 'brands', ...dynamicFilterOptions.map(f => f.id)]} className="w-full space-y-4">
            
            {/* Tipo de Loja */}
            {(storeTypeOptions.official > 0 || storeTypeOptions.nonOfficial > 0) && (
                 <AccordionItem value="store-type">
                    <AccordionTrigger className="text-sm font-semibold">Tipo de loja</AccordionTrigger>
                    <AccordionContent>
                         <div className="space-y-2 pt-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="store-type-official" className="flex items-center gap-2 font-normal cursor-pointer">
                                    <Checkbox id="store-type-official" checked={selectedStoreTypes.includes('official')} onCheckedChange={() => handleCheckboxToggle(selectedStoreTypes, onStoreTypeChange, 'official')} />
                                    Lojas Oficiais
                                </Label>
                                <span className="text-xs text-muted-foreground">{storeTypeOptions.official}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                 <Label htmlFor="store-type-non-official" className="flex items-center gap-2 font-normal cursor-pointer">
                                    <Checkbox id="store-type-non-official" checked={selectedStoreTypes.includes('non-official')} onCheckedChange={() => handleCheckboxToggle(selectedStoreTypes, onStoreTypeChange, 'non-official')} />
                                    Lojas Não Oficiais
                                </Label>
                                 <span className="text-xs text-muted-foreground">{storeTypeOptions.nonOfficial}</span>
                            </div>
                        </div>
                    </AccordionContent>
                </AccordionItem>
            )}


            {/* Tipos de Entrega */}
            {shippingOptions.length > 0 && (
                 <AccordionItem value="shipping">
                    <AccordionTrigger className="text-sm font-semibold">Tipos de entrega</AccordionTrigger>
                    <AccordionContent>
                        <div className="space-y-2 pt-2">
                            {shippingOptions.map(opt => (
                                <div key={opt.name} className="flex items-center justify-between">
                                    <Label htmlFor={`ship-${opt.name}`} className="flex items-center gap-2 font-normal cursor-pointer">
                                        <Checkbox id={`ship-${opt.name}`} checked={selectedShipping.includes(opt.name)} onCheckedChange={() => handleCheckboxToggle(selectedShipping, onShippingChange, opt.name)} />
                                        {opt.name}
                                    </Label>
                                    <span className="text-xs text-muted-foreground">{opt.count}</span>
                                </div>
                            ))}
                        </div>
                    </AccordionContent>
                 </AccordionItem>
            )}
            
            {/* Marcas */}
            {brandOptions.length > 0 && (
                 <AccordionItem value="brands">
                    <AccordionTrigger className="text-sm font-semibold">Marcas</AccordionTrigger>
                     <AccordionContent>
                        <div className="space-y-2 pt-2">
                            <Input placeholder="Filtrar marcas..." value={brandSearch} onChange={e => onBrandSearchChange(e.target.value)} />
                            <div className="space-y-2 max-h-48 overflow-y-auto">
                                {filteredBrands.map(opt => (
                                    <div key={opt.name} className="flex items-center justify-between">
                                        <Label htmlFor={`brand-${opt.name}`} className="flex items-center gap-2 font-normal cursor-pointer">
                                            <Checkbox id={`brand-${opt.name}`} checked={selectedBrands.includes(opt.name)} onCheckedChange={() => handleCheckboxToggle(selectedBrands, onBrandChange, opt.name)} />
                                            {opt.name}
                                        </Label>
                                        <span className="text-xs text-muted-foreground">{opt.count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                     </AccordionContent>
                </AccordionItem>
            )}
            
            {/* Filtros Dinâmicos */}
            {dynamicFilterOptions.length > 0 && (
                <>
                {dynamicFilterOptions.map(filter => {
                    const isModelFilter = filter.id === 'MODEL';
                    const filteredOptions = isModelFilter 
                        ? filter.options.filter(opt => opt.name.toLowerCase().includes(modelSearch.toLowerCase()))
                        : filter.options;

                    return (
                     <AccordionItem key={filter.id} value={filter.id}>
                        <AccordionTrigger className="text-sm font-semibold">{filter.name}</AccordionTrigger>
                        <AccordionContent>
                            <div className="space-y-2 pt-2">
                                {isModelFilter && (
                                    <Input 
                                        placeholder="Filtrar modelos..." 
                                        value={modelSearch} 
                                        onChange={e => onModelSearchChange(e.target.value)} 
                                    />
                                )}
                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                    {filteredOptions.map(opt => (
                                        <div key={opt.name} className="flex items-center justify-between">
                                            <Label htmlFor={`dyn-${filter.id}-${opt.name}`} className="flex items-center gap-2 font-normal cursor-pointer">
                                                <Checkbox 
                                                    id={`dyn-${filter.id}-${opt.name}`} 
                                                    checked={(activeFilters[filter.id] || []).includes(opt.name)} 
                                                    onCheckedChange={() => handleDynamicFilterToggle(filter.id, opt.name)} 
                                                />
                                                {opt.name}
                                            </Label>
                                            <span className="text-xs text-muted-foreground">{opt.count}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                    )
                })}
                </>
            )}
        </Accordion>
        </ScrollArea>
      </div>
    </aside>
  );
}
