"use client";

import { FileSpreadsheet } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type PlanilhasUploadFileStepProps = {
  file: File | null;
  rowsCount: number;
  headersCount: number;
  sheetNames: string[];
  selectedSheet: string;
  referenceMonth: string;
  customName: string;
  onFileSelected: (file: File | null) => void;
  onSheetChange: (sheetName: string) => void;
  onReferenceMonthChange: (value: string) => void;
  onCustomNameChange: (value: string) => void;
};

export function PlanilhasUploadFileStep({
  file,
  rowsCount,
  headersCount,
  sheetNames,
  selectedSheet,
  referenceMonth,
  customName,
  onFileSelected,
  onSheetChange,
  onReferenceMonthChange,
  onCustomNameChange,
}: PlanilhasUploadFileStepProps) {
  return (
    <div className="space-y-4 py-2">
      <Input
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={(event) => onFileSelected(event.target.files?.[0] ?? null)}
      />
      {file ? (
        <p className="text-sm text-slate-600">
          <FileSpreadsheet className="mr-1 inline h-4 w-4" />
          {file.name} - {rowsCount.toLocaleString("pt-BR")} linha(s), {headersCount} coluna(s)
        </p>
      ) : null}
      {sheetNames.length > 1 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-500">Aba da planilha</p>
          <Select value={selectedSheet} onValueChange={onSheetChange}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sheetNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-500">Mês de referência</p>
          <Input type="month" value={referenceMonth} onChange={(event) => onReferenceMonthChange(event.target.value)} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-500">Nome personalizado (opcional)</p>
          <Input
            placeholder="Ex.: Repasse ML Junho"
            value={customName}
            onChange={(event) => onCustomNameChange(event.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
