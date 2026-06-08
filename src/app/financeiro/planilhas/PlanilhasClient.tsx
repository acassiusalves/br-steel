"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import DashboardLayout from "@/components/dashboard-layout";
import { useToast } from "@/hooks/use-toast";
import { computePlanilhasStats } from "@/lib/conciliation/planilhas";
import { subscribeConciliationOrders } from "@/services/conciliation-service";
import { PlanilhasDeleteImportDialog } from "@/app/financeiro/planilhas/components/PlanilhasDeleteImportDialog";
import { PlanilhasImportHistory } from "@/app/financeiro/planilhas/components/PlanilhasImportHistory";
import { PlanilhasOverview } from "@/app/financeiro/planilhas/components/PlanilhasOverview";
import { PlanilhasPageHeader } from "@/app/financeiro/planilhas/components/PlanilhasPageHeader";
import { PlanilhasTabs, type PlanilhasTab } from "@/app/financeiro/planilhas/components/PlanilhasTabs";
import { PlanilhasUploadWizard } from "@/app/financeiro/planilhas/components/PlanilhasUploadWizard";
import { deleteImport, fetchPlanilhasState } from "@/services/planilhas-service";
import type { ConciliationOrder } from "@/types/conciliation";
import type {
  ConciliationImportCategory,
  ConciliationImportFileRecord,
  ConciliationImportTemplate,
} from "@/types/conciliation-planilhas";

export default function PlanilhasClient() {
  const { toast } = useToast();
  const router = useRouter();

  // Estado da página
  const [files, setFiles] = React.useState<ConciliationImportFileRecord[]>([]);
  const [categories, setCategories] = React.useState<ConciliationImportCategory[]>([]);
  const [templates, setTemplates] = React.useState<ConciliationImportTemplate[]>([]);
  const [orders, setOrders] = React.useState<ConciliationOrder[]>([]);
  const [activeTab, setActiveTab] = React.useState<PlanilhasTab>("visao-geral");
  const [isLoading, setIsLoading] = React.useState(true);
  const [isOrdersLoading, setIsOrdersLoading] = React.useState(true);
  const [deleteTarget, setDeleteTarget] = React.useState<ConciliationImportFileRecord | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const [isWizardOpen, setIsWizardOpen] = React.useState(false);

  const loadState = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const state = await fetchPlanilhasState();

      setFiles(state.files);
      setCategories(state.categories);
      setTemplates(state.templates);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro ao carregar planilhas",
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void loadState();
  }, [loadState]);

  const stats = React.useMemo(() => computePlanilhasStats(files, categories), [files, categories]);

  React.useEffect(() => {
    setIsOrdersLoading(true);

    return subscribeConciliationOrders(
      (loadedOrders) => {
        setOrders(loadedOrders);
        setIsOrdersLoading(false);
      },
      () => {
        setIsOrdersLoading(false);
        toast({
          variant: "destructive",
          title: "Erro ao carregar pedidos",
          description: "O matching precisa dos pedidos de venda.",
        });
      }
    );
  }, [toast]);

  const openWizard = () => {
    setIsWizardOpen(true);
  };

  const handleCategoryCreated = React.useCallback((category: ConciliationImportCategory) => {
    setCategories((previous) => [...previous, category]);
  }, []);

  const handleImportFinished = React.useCallback(() => {
    setActiveTab("minhas-planilhas");
    void loadState();
  }, [loadState]);

  const handleDeleteImport = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    try {
      const result = await deleteImport(deleteTarget.id);

      toast({
        title: "Importação removida",
        description: `${result.deletedAssociations} associação(ões) excluída(s).`,
      });
      setDeleteTarget(null);
      void loadState();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro ao excluir",
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-5 bg-slate-50 p-4 pt-6 text-slate-950 md:p-8" style={{ fontFamily: "Manrope, sans-serif" }}>
        <PlanilhasPageHeader
          isLoading={isLoading}
          isOrdersLoading={isOrdersLoading}
          onGoConciliacao={() => router.push("/financeiro/conciliacao")}
          onRefresh={() => void loadState()}
          onOpenWizard={openWizard}
        />

        <PlanilhasTabs activeTab={activeTab} totalFiles={stats.total} onChange={setActiveTab} />

        {activeTab === "visao-geral" ? (
          <PlanilhasOverview
            stats={stats}
            isLoading={isLoading}
            isOrdersLoading={isOrdersLoading}
            onOpenWizard={openWizard}
            onGoConciliacao={() => router.push("/financeiro/conciliacao")}
          />
        ) : null}

        {activeTab === "minhas-planilhas" ? (
          <PlanilhasImportHistory
            files={files}
            isLoading={isLoading}
            isOrdersLoading={isOrdersLoading}
            onDelete={setDeleteTarget}
          />
        ) : null}
      </div>

      <PlanilhasDeleteImportDialog
        target={deleteTarget}
        isDeleting={isDeleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteImport()}
      />

      <PlanilhasUploadWizard
        open={isWizardOpen}
        categories={categories}
        templates={templates}
        orders={orders}
        onOpenChange={setIsWizardOpen}
        onCategoryCreated={handleCategoryCreated}
        onImported={handleImportFinished}
      />
    </DashboardLayout>
  );
}
