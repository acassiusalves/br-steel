"use client";

import { FileSpreadsheet, Loader2, Trash2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPlanilhaMonthLabel } from "@/lib/conciliation/planilhas";
import type { ConciliationImportFileRecord } from "@/types/conciliation-planilhas";

type PlanilhasImportHistoryProps = {
  files: ConciliationImportFileRecord[];
  isLoading: boolean;
  isOrdersLoading: boolean;
  onDelete: (record: ConciliationImportFileRecord) => void;
};

const renderStatusBadge = (status: ConciliationImportFileRecord["status"]) => {
  switch (status) {
    case "success":
      return <Badge className="bg-green-600 hover:bg-green-600">Sucesso</Badge>;
    case "partial":
      return <Badge className="bg-amber-500 hover:bg-amber-500">Parcial</Badge>;
    case "no_match":
      return <Badge variant="destructive">Sem match</Badge>;
    case "error":
      return <Badge variant="destructive">Erro</Badge>;
    default:
      return (
        <Badge variant="outline" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Processando
        </Badge>
      );
  }
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "-";

  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return value;
  }
};

export function PlanilhasImportHistory({
  files,
  isLoading,
  isOrdersLoading,
  onDelete,
}: PlanilhasImportHistoryProps) {
  return (
    <>
      {isOrdersLoading ? (
        <Alert>
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertTitle>Carregando pedidos</AlertTitle>
          <AlertDescription>O matching usa os pedidos de venda do sistema.</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Histórico de importações</CardTitle>
          <CardDescription>Planilhas importadas, com status de matching e ações.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-slate-500">
              <FileSpreadsheet className="h-8 w-8 text-slate-300" />
              Nenhuma planilha importada ainda.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Mês</TableHead>
                  <TableHead>Marketplace</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Matches</TableHead>
                  <TableHead className="text-right">Linhas</TableHead>
                  <TableHead>Atualizado</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="max-w-64">
                      <span className="block truncate font-medium" title={record.customName || record.fileName}>
                        {record.customName || record.fileName}
                      </span>
                    </TableCell>
                    <TableCell>{formatPlanilhaMonthLabel(record.referenceMonth)}</TableCell>
                    <TableCell>{record.marketplace}</TableCell>
                    <TableCell>{record.categoryName || "-"}</TableCell>
                    <TableCell>{renderStatusBadge(record.status)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {record.matchedRows}/{record.totalRows}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{record.totalRows}</TableCell>
                    <TableCell>{formatDateTime(record.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => onDelete(record)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
