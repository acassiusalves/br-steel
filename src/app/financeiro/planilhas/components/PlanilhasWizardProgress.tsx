"use client";

type PlanilhasWizardProgressProps = {
  steps: readonly string[];
  currentStep: number;
};

export function PlanilhasWizardProgress({ steps, currentStep }: PlanilhasWizardProgressProps) {
  return (
    <div className="flex items-center gap-1">
      {steps.map((label, index) => (
        <div
          key={label}
          className={`h-1.5 flex-1 rounded-full ${index <= currentStep ? "bg-purple-500" : "bg-slate-200"}`}
        />
      ))}
    </div>
  );
}
