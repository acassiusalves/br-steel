"use client";

import { ArrowRight, RefreshCcw, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";

type PlanilhasPageHeaderProps = {
  isLoading: boolean;
  isOrdersLoading: boolean;
  onGoConciliacao: () => void;
  onRefresh: () => void;
  onOpenWizard: () => void;
};

export function PlanilhasPageHeader({
  isLoading,
  isOrdersLoading,
  onGoConciliacao,
  onRefresh,
  onOpenWizard,
}: PlanilhasPageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Gestão de Planilhas</h1>
        <p className="text-sm text-slate-500">Faça upload e gerencie planilhas que alimentam a Conciliação.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onGoConciliacao}>
          Ir para Conciliação
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
        <Button variant="outline" onClick={onRefresh} disabled={isLoading}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Atualizar
        </Button>
        <Button onClick={onOpenWizard} disabled={isOrdersLoading}>
          <Upload className="mr-2 h-4 w-4" />
          Nova planilha de conciliação
        </Button>
      </div>
    </div>
  );
}
