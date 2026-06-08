"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PlanilhasMarketplaceStepProps = {
  marketplace: string;
  presets: readonly string[];
  onMarketplaceChange: (value: string) => void;
};

export function PlanilhasMarketplaceStep({
  marketplace,
  presets,
  onMarketplaceChange,
}: PlanilhasMarketplaceStepProps) {
  return (
    <div className="space-y-3 py-2">
      <p className="text-sm text-slate-600">De qual marketplace/origem é esta planilha?</p>
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <Button
            key={preset}
            type="button"
            variant={marketplace === preset ? "default" : "outline"}
            size="sm"
            onClick={() => onMarketplaceChange(preset)}
          >
            {preset}
          </Button>
        ))}
      </div>
      <Input
        placeholder="Ou digite outra origem..."
        value={marketplace}
        onChange={(event) => onMarketplaceChange(event.target.value)}
      />
    </div>
  );
}
