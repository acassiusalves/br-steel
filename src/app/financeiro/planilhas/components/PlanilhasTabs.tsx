"use client";

import { FileSpreadsheet, FileText } from "lucide-react";

export type PlanilhasTab = "visao-geral" | "minhas-planilhas";

type PlanilhasTabsProps = {
  activeTab: PlanilhasTab;
  totalFiles: number;
  onChange: (tab: PlanilhasTab) => void;
};

export function PlanilhasTabs({ activeTab, totalFiles, onChange }: PlanilhasTabsProps) {
  const tabClassName = (tab: PlanilhasTab) =>
    `flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors ${
      activeTab === tab ? "bg-slate-100 text-slate-950" : "text-slate-500 hover:text-slate-700"
    }`;

  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
      <button type="button" onClick={() => onChange("visao-geral")} className={tabClassName("visao-geral")}>
        <FileText className="h-4 w-4" />
        Visão Geral
      </button>
      <button type="button" onClick={() => onChange("minhas-planilhas")} className={tabClassName("minhas-planilhas")}>
        <FileSpreadsheet className="h-4 w-4" />
        Minhas Planilhas
        {totalFiles > 0 ? (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{totalFiles}</span>
        ) : null}
      </button>
    </div>
  );
}
