"use client";

import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ConciliationImportFileRecord } from "@/types/conciliation-planilhas";

type PlanilhasDeleteImportDialogProps = {
  target: ConciliationImportFileRecord | null;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function PlanilhasDeleteImportDialog({
  target,
  isDeleting,
  onCancel,
  onConfirm,
}: PlanilhasDeleteImportDialogProps) {
  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir importação?</DialogTitle>
          <DialogDescription>
            Remove o arquivo {target?.customName || target?.fileName} e todas as associações criadas por ele. As
            colunas correspondentes somem da conciliação.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isDeleting}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            Excluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
