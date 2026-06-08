"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

type PlanilhasWizardFooterProps = {
  step: number;
  stepsLength: number;
  isSavingImport: boolean;
  isValidating: boolean;
  canAdvance: boolean;
  hasUnresolvedCrossMonth: boolean;
  onBack: () => void;
  onNext: () => void;
  onSave: () => void;
};

export function PlanilhasWizardFooter({
  step,
  stepsLength,
  isSavingImport,
  isValidating,
  canAdvance,
  hasUnresolvedCrossMonth,
  onBack,
  onNext,
  onSave,
}: PlanilhasWizardFooterProps) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button
        type="button"
        variant="outline"
        onClick={onBack}
        disabled={step === 0 || isSavingImport || isValidating}
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
      </Button>
      {step < stepsLength - 1 ? (
        <Button type="button" onClick={onNext} disabled={!canAdvance || isValidating || hasUnresolvedCrossMonth}>
          {isValidating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          Próximo <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      ) : (
        <Button type="button" onClick={onSave} disabled={isSavingImport}>
          {isSavingImport ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-1 h-4 w-4" />
          )}
          Confirmar importação
        </Button>
      )}
    </div>
  );
}
