/* ============================================
   MULTI-SELECT V2 - INSPIRADO NO GOOGLE ADS
   Seletor múltiplo com busca e badges
   ============================================ */

"use client";
import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui-v2/command";
import { Badge } from "@/components/ui-v2/badge";

export type Option = { label: string; value: string };

export function MultiSelect({
  value,
  selected,
  onChange,
  options,
  placeholder = "Selecione...",
  emptyText = "Nenhuma opção",
  className,
  disabled,
}: {
  value?: string[];
  selected?: string[];
  onChange: (v: string[]) => void;
  options: Option[];
  placeholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState("");

  // Use 'selected' if provided, otherwise fall back to 'value'
  const currentValue = selected ?? value ?? [];

  const toggle = (val: string) => {
    if (currentValue.includes(val)) {
      const newValue = currentValue.filter((v) => v !== val);
      onChange(newValue);
    } else {
      const newValue = [...currentValue, val];
      onChange(newValue);
    }
  };

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const safeValue = currentValue;

  const summary =
    safeValue.length === 0
      ? placeholder
      : safeValue.length === 1
      ? options.find((o) => o.value === safeValue[0])?.label || placeholder
      : `${safeValue.length} selecionados`;

  const filteredOptions = options.filter(option =>
    option.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className={cn("w-full md:w-[260px]", className)}>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between"
          >
            <span className="truncate">{summary}</span>
            <div className="flex items-center gap-2">
              {safeValue.length > 0 && (
                <X className="h-4 w-4 opacity-70 hover:opacity-100" onClick={clearAll} />
              )}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] p-0">
          <div className="p-2">
            <Command>
              <CommandInput
                placeholder="Filtrar..."
                value={searchTerm}
                onValueChange={setSearchTerm}
              />
            </Command>
          </div>
          <DropdownMenuGroup className="max-h-60 overflow-auto">
            {filteredOptions.length === 0 ? (
                <div className="py-2 text-center text-sm text-muted-foreground">{emptyText}</div>
            ) : (
                filteredOptions.map((opt) => (
                    <DropdownMenuCheckboxItem
                        key={opt.value}
                        checked={safeValue.includes(opt.value)}
                        onCheckedChange={() => toggle(opt.value)}
                        onSelect={(e) => e.preventDefault()}
                    >
                        {opt.label}
                    </DropdownMenuCheckboxItem>
                ))
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {safeValue.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {safeValue.map((v) => {
            const label = options.find((o) => o.value === v)?.label ?? v;
            return (
              <Badge key={v} variant="secondary" className="px-2 py-1">
                <span className="mr-1">{label}</span>
                <button
                  className="opacity-70 hover:opacity-100"
                  onClick={() => onChange(safeValue.filter((x) => x !== v))}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
