"use client";

import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ConciliationImportCategory } from "@/types/conciliation-planilhas";

type PlanilhasCategoryStepProps = {
  categories: ConciliationImportCategory[];
  categoryId: string | null;
  newCategoryName: string;
  onCategoryChange: (id: string) => void;
  onNewCategoryNameChange: (value: string) => void;
  onCreateCategory: () => void;
};

export function PlanilhasCategoryStep({
  categories,
  categoryId,
  newCategoryName,
  onCategoryChange,
  onNewCategoryNameChange,
  onCreateCategory,
}: PlanilhasCategoryStepProps) {
  return (
    <div className="space-y-3 py-2">
      <p className="text-sm text-slate-600">Escolha uma categoria para organizar esta planilha.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => onCategoryChange(category.id)}
            className={`flex items-center justify-between rounded-lg border p-3 text-left text-sm transition-colors ${
              categoryId === category.id ? "border-purple-500 bg-purple-50" : "border-slate-200 hover:bg-slate-50"
            }`}
          >
            <span className="font-medium">{category.name}</span>
            <Badge variant="outline">{category.usageCount} uso(s)</Badge>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="Nova categoria..."
          value={newCategoryName}
          onChange={(event) => onNewCategoryNameChange(event.target.value)}
        />
        <Button type="button" variant="outline" onClick={onCreateCategory}>
          <Plus className="mr-1 h-4 w-4" /> Criar
        </Button>
      </div>
    </div>
  );
}
