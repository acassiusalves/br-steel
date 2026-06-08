"use client";

import {
  AlertTriangle,
  ArrowRight,
  BarChart2,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
  Upload,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { PlanilhasStats } from "@/lib/conciliation/planilhas";

type PlanilhasOverviewProps = {
  stats: PlanilhasStats;
  isLoading: boolean;
  isOrdersLoading: boolean;
  onOpenWizard: () => void;
  onGoConciliacao: () => void;
};

type MetricCard = {
  label: string;
  value: string;
  icon: LucideIcon;
  boxClass: string;
  iconClass: string;
};

export function PlanilhasOverview({
  stats,
  isLoading,
  isOrdersLoading,
  onOpenWizard,
  onGoConciliacao,
}: PlanilhasOverviewProps) {
  const metricCards: MetricCard[] = [
    {
      label: "Total de planilhas",
      value: String(stats.total),
      icon: FileSpreadsheet,
      boxClass: "bg-blue-50",
      iconClass: "text-blue-600",
    },
    {
      label: "Linhas importadas",
      value: stats.totalRows.toLocaleString("pt-BR"),
      icon: BarChart2,
      boxClass: "bg-slate-100",
      iconClass: "text-slate-600",
    },
    {
      label: "Taxa média de match",
      value: `${stats.avgMatch}%`,
      icon: stats.avgMatch > 80 ? CheckCircle2 : AlertTriangle,
      boxClass: stats.avgMatch > 80 ? "bg-emerald-50" : "bg-amber-50",
      iconClass: stats.avgMatch > 80 ? "text-emerald-600" : "text-amber-600",
    },
    {
      label: "Proc. / erro",
      value: `${stats.processing}/${stats.errors}`,
      icon: stats.errors > 0 ? XCircle : Clock,
      boxClass: stats.errors > 0 ? "bg-red-50" : "bg-sky-50",
      iconClass: stats.errors > 0 ? "text-red-600" : "text-sky-600",
    },
    {
      label: "Categorias ativas",
      value: String(stats.categories),
      icon: FileText,
      boxClass: "bg-purple-50",
      iconClass: "text-purple-600",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {metricCards.map((card) => (
          <Card key={card.label} className="rounded-xl border-slate-200">
            <CardContent className="p-4">
              <div className={`mb-3 flex h-8 w-8 items-center justify-center rounded-lg ${card.boxClass}`}>
                <card.icon className={`h-4 w-4 ${card.iconClass}`} />
              </div>
              <p className="text-2xl font-bold text-slate-950">
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : card.value}
              </p>
              <p className="mt-1 text-xs text-slate-500">{card.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-xl border-slate-200">
          <CardContent className="flex items-start gap-3 p-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
              <FileSpreadsheet className="h-4 w-4 text-blue-600" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-slate-950">Planilhas de conciliação</h3>
              <p className="mt-1 text-xs text-slate-500">
                Vendas, repasses, custos e arquivos que precisam casar com pedidos existentes.
              </p>
              <Button onClick={onOpenWizard} variant="outline" size="sm" className="mt-4 gap-2" disabled={isOrdersLoading}>
                <Plus className="h-4 w-4" />
                Nova planilha de conciliação
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-slate-200">
          <CardContent className="flex items-start gap-3 p-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-slate-950">Dados na Conciliação</h3>
              <p className="mt-1 text-xs text-slate-500">
                As associações salvas aqui aparecem como colunas e dados enriquecidos na página de Conciliação.
              </p>
              <Button onClick={onGoConciliacao} variant="outline" size="sm" className="mt-4 gap-2">
                Ir para Conciliação
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {stats.total === 0 && !isLoading ? (
        <Card className="rounded-xl border-dashed border-slate-300">
          <CardContent className="flex flex-col items-center p-10 text-center">
            <Upload className="mb-4 h-10 w-10 text-slate-300" />
            <h3 className="mb-2 text-lg font-medium text-slate-950">Comece fazendo o upload de uma planilha</h3>
            <p className="mb-6 max-w-md text-sm text-slate-500">
              Importe planilhas de vendas ou repasses por pedido para enriquecer a página de Conciliação.
            </p>
            <Button onClick={onOpenWizard} disabled={isOrdersLoading}>
              <Plus className="mr-2 h-4 w-4" />
              Nova planilha de conciliação
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
