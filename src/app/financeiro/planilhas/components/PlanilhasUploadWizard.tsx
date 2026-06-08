"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import * as XLSX from "xlsx";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { PlanilhasCategoryStep } from "@/app/financeiro/planilhas/components/PlanilhasCategoryStep";
import { PlanilhasMarketplaceStep } from "@/app/financeiro/planilhas/components/PlanilhasMarketplaceStep";
import { PlanilhasUploadFileStep } from "@/app/financeiro/planilhas/components/PlanilhasUploadFileStep";
import { PlanilhasWizardFooter } from "@/app/financeiro/planilhas/components/PlanilhasWizardFooter";
import { PlanilhasWizardProgress } from "@/app/financeiro/planilhas/components/PlanilhasWizardProgress";
import {
  applyTemplateToHeaders,
  buildUniquePlanilhaHeaders,
  formatPlanilhaMonthLabel,
  getPlanilhaDestinationKey,
  getPlanilhaDestinationLabel,
  runPlanilhaMatcher,
  validatePlanilhaFile,
} from "@/lib/conciliation/planilhas";
import {
  createImportFile,
  fetchExistingAssociationsForMonths,
  finalizeImport,
  saveImportAssociations,
  savePlanilhaCategory,
  savePlanilhaTemplate,
} from "@/services/planilhas-service";
import type { ConciliationOrder } from "@/types/conciliation";
import type {
  ConciliationImportCategory,
  ConciliationImportTemplate,
  ConciliationSheetAssociation,
  PlanilhaAssociationSettings,
  PlanilhaColumnMapping,
  PlanilhaConflictGroup,
  PlanilhaConflictResolution,
  PlanilhaMatchResult,
  PlanilhaMatchStrategy,
  PlanilhaTargetField,
} from "@/types/conciliation-planilhas";
import { PLANILHA_MAX_ROWS } from "@/types/conciliation-planilhas";

const wizardSteps = [
  "Marketplace",
  "Categoria",
  "Upload",
  "Mapeamento",
  "Validação",
  "Confirmação",
] as const;

const marketplacePresets = ["Mercado Livre", "Shopee", "Magalu", "Amazon", "Custos", "Devoluções"];

const targetFieldOptions: Array<{ id: PlanilhaTargetField; label: string }> = [
  { id: "orderNumber", label: "Número do pedido" },
  { id: "storeNumber", label: "Número na loja" },
  { id: "customerName", label: "Nome do cliente" },
  { id: "sku", label: "SKU do produto" },
];

const matchStrategyOptions: Array<{ id: PlanilhaMatchStrategy; label: string }> = [
  { id: "normalize", label: "Normalizada (padrão)" },
  { id: "alphanumeric", label: "Alfanumérica (tolerante)" },
  { id: "exact", label: "Exata" },
];

const currentMonthYear = () => {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

type PlanilhasUploadWizardProps = {
  open: boolean;
  categories: ConciliationImportCategory[];
  templates: ConciliationImportTemplate[];
  orders: ConciliationOrder[];
  onOpenChange: (open: boolean) => void;
  onCategoryCreated: (category: ConciliationImportCategory) => void;
  onImported: () => void;
};

export function PlanilhasUploadWizard({
  open,
  categories,
  templates,
  orders,
  onOpenChange,
  onCategoryCreated,
  onImported,
}: PlanilhasUploadWizardProps) {
  const { toast } = useToast();

  const [step, setStep] = React.useState(0);
  const [marketplace, setMarketplace] = React.useState("");
  const [categoryId, setCategoryId] = React.useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [sheetNames, setSheetNames] = React.useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = React.useState("");
  const [workbook, setWorkbook] = React.useState<XLSX.WorkBook | null>(null);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<unknown[][]>([]);
  const [referenceMonth, setReferenceMonth] = React.useState(currentMonthYear());
  const [customName, setCustomName] = React.useState("");
  const [columnMappings, setColumnMappings] = React.useState<PlanilhaColumnMapping[]>([]);
  const [associationSettings, setAssociationSettings] = React.useState<PlanilhaAssociationSettings>({
    keyColumn: "",
    targetField: "orderNumber",
    matchStrategy: "normalize",
  });
  const [templateId, setTemplateId] = React.useState<string | null>(null);
  const [saveAsTemplateName, setSaveAsTemplateName] = React.useState("");
  const [matchResult, setMatchResult] = React.useState<PlanilhaMatchResult | null>(null);
  const [conflictGroups, setConflictGroups] = React.useState<PlanilhaConflictGroup[]>([]);
  const [conflictResolutions, setConflictResolutions] = React.useState<Record<string, PlanilhaConflictResolution>>({});
  const [crossMonthAccepted, setCrossMonthAccepted] = React.useState(false);
  const [isValidating, setIsValidating] = React.useState(false);
  const [isSavingImport, setIsSavingImport] = React.useState(false);
  const [saveProgress, setSaveProgress] = React.useState(0);

  const resetWizard = React.useCallback(() => {
    setStep(0);
    setMarketplace("");
    setCategoryId(null);
    setNewCategoryName("");
    setFile(null);
    setSheetNames([]);
    setSelectedSheet("");
    setWorkbook(null);
    setHeaders([]);
    setRows([]);
    setReferenceMonth(currentMonthYear());
    setCustomName("");
    setColumnMappings([]);
    setAssociationSettings({ keyColumn: "", targetField: "orderNumber", matchStrategy: "normalize" });
    setTemplateId(null);
    setSaveAsTemplateName("");
    setMatchResult(null);
    setConflictGroups([]);
    setConflictResolutions({});
    setCrossMonthAccepted(false);
    setSaveProgress(0);
  }, []);

  React.useEffect(() => {
    if (open) resetWizard();
  }, [open, resetWizard]);

  const readSheet = React.useCallback(
    (book: XLSX.WorkBook, sheetName: string) => {
      const worksheet = book.Sheets[sheetName];

      if (!worksheet) return;

      const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        raw: true,
        defval: null,
      });
      const headerRow = matrix.find((row) => row.some((cell) => cell !== null && cell !== ""));

      if (!headerRow) {
        toast({ variant: "destructive", title: "Planilha vazia", description: "Nenhum cabeçalho encontrado." });
        return;
      }

      const headerIndex = matrix.indexOf(headerRow);
      const dataRows = matrix
        .slice(headerIndex + 1)
        .filter((row) => row.some((cell) => cell !== null && cell !== ""));

      if (dataRows.length > PLANILHA_MAX_ROWS) {
        toast({
          variant: "destructive",
          title: "Planilha muito grande",
          description: `Limite de ${PLANILHA_MAX_ROWS.toLocaleString("pt-BR")} linhas por importação.`,
        });
        return;
      }

      const uniqueHeaders = buildUniquePlanilhaHeaders(headerRow);

      setHeaders(uniqueHeaders);
      setRows(dataRows);

      const candidates = templates
        .filter((template) => template.marketplace.toLowerCase() === marketplace.toLowerCase())
        .sort((first, second) => String(second.lastUsedAt ?? "").localeCompare(String(first.lastUsedAt ?? "")));
      const template = candidates[0] ?? null;
      const applied = applyTemplateToHeaders(uniqueHeaders, template, dataRows[0]);

      setTemplateId(template?.id ?? null);
      setColumnMappings(applied.columnMappings);
      setAssociationSettings(applied.associationSettings);
    },
    [marketplace, templates, toast]
  );

  const handleFileSelected = (selected: File | null) => {
    if (!selected) return;

    const validationError = validatePlanilhaFile(selected);

    if (validationError) {
      toast({ variant: "destructive", title: "Arquivo inválido", description: validationError });
      return;
    }

    setFile(selected);

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const book = XLSX.read(reader.result, { type: "array" });

        setWorkbook(book);
        setSheetNames(book.SheetNames);

        const firstSheet = book.SheetNames[0] ?? "";

        setSelectedSheet(firstSheet);
        if (firstSheet) readSheet(book, firstSheet);
      } catch {
        toast({ variant: "destructive", title: "Erro ao ler arquivo", description: "Formato não reconhecido." });
      }
    };
    reader.readAsArrayBuffer(selected);
  };

  const applyTemplateById = (selectedTemplateId: string) => {
    const template = templates.find((candidate) => candidate.id === selectedTemplateId) ?? null;
    const applied = applyTemplateToHeaders(headers, template, rows[0]);

    setTemplateId(template?.id ?? null);
    setColumnMappings(applied.columnMappings);
    setAssociationSettings(applied.associationSettings);
  };

  const updateMapping = (index: number, patch: Partial<PlanilhaColumnMapping>) => {
    setColumnMappings((previous) =>
      previous.map((mapping, mappingIndex) => (mappingIndex === index ? { ...mapping, ...patch } : mapping))
    );
  };

  const handleValidate = async () => {
    if (!associationSettings.keyColumn) {
      toast({
        variant: "destructive",
        title: "Defina a coluna chave",
        description: "Escolha qual coluna identifica o pedido/SKU.",
      });
      return;
    }

    if (!columnMappings.some((mapping) => mapping.displayInConciliacao)) {
      toast({
        variant: "destructive",
        title: "Nenhuma coluna selecionada",
        description: "Marque ao menos uma coluna para importar.",
      });
      return;
    }

    setIsValidating(true);
    try {
      const result = runPlanilhaMatcher({
        rows,
        headers,
        columnMappings,
        associationSettings,
        orders,
        referenceMonth,
      });

      setMatchResult(result);
      setCrossMonthAccepted(result.crossMonthMatches.length === 0);

      const monthsInvolved = Array.from(
        new Set([referenceMonth, ...result.associations.map((association) => association.saleMonth)])
      );
      const existing = await fetchExistingAssociationsForMonths(monthsInvolved);
      const existingByOrderKey = new Map<string, ConciliationSheetAssociation[]>();

      existing.forEach((association) => {
        const list = existingByOrderKey.get(association.orderKey) ?? [];

        list.push(association);
        existingByOrderKey.set(association.orderKey, list);
      });

      const labelByKey = new Map(
        columnMappings.map((mapping) => [getPlanilhaDestinationKey(mapping), getPlanilhaDestinationLabel(mapping)])
      );
      const groups = new Map<string, PlanilhaConflictGroup>();

      result.associations.forEach((draft) => {
        const existingForKey = existingByOrderKey.get(draft.orderKey) ?? [];

        existingForKey.forEach((association) => {
          Object.entries(draft.dataFields).forEach(([field, newValue]) => {
            const existingValue = association.dataFields?.[field];

            if (
              existingValue === undefined ||
              existingValue === null ||
              newValue === null ||
              String(existingValue) === String(newValue)
            ) {
              return;
            }

            const group = groups.get(field) ?? {
              field,
              fieldLabel: labelByKey.get(field) ?? field,
              conflicts: [],
            };

            group.conflicts.push({
              id: `${draft.orderKey}_${field}`,
              keyValue: draft.orderKey,
              saleId: draft.saleId ?? "",
              orderCode: draft.orderKey,
              field,
              fieldLabel: group.fieldLabel,
              existingValue,
              newValue,
              existingSource: association.fileName,
            });
            groups.set(field, group);
          });
        });
      });

      const groupList = Array.from(groups.values()).sort(
        (first, second) => second.conflicts.length - first.conflicts.length
      );

      setConflictGroups(groupList);
      setConflictResolutions(
        Object.fromEntries(groupList.map((group) => [group.field, "replace" as PlanilhaConflictResolution]))
      );
      setStep(4);
    } finally {
      setIsValidating(false);
    }
  };

  const handleSaveImport = async () => {
    if (!matchResult || !file) return;

    setIsSavingImport(true);
    setSaveProgress(0);
    try {
      const category = categories.find((candidate) => candidate.id === categoryId) ?? null;
      const { fileId } = await createImportFile({
        fileName: file.name,
        customName: customName.trim() || null,
        marketplace,
        categoryId: category?.id ?? null,
        categoryName: category?.name ?? null,
        referenceMonth,
        totalRows: rows.length,
        matchedRows: matchResult.matchedRows,
        unmatchedRows: matchResult.unmatchedRows,
        groupedSales: matchResult.groupedSales,
        status: "processing",
        columnMappings,
        associationSettings,
        unmatchedSamples: matchResult.unmatchedDetails,
      });

      const resolutionByField = conflictResolutions;
      const conflictByDraftField = new Map<string, { existingValue: unknown }>();

      conflictGroups.forEach((group) => {
        group.conflicts.forEach((conflict) => {
          conflictByDraftField.set(`${conflict.keyValue}_${conflict.field}`, {
            existingValue: conflict.existingValue,
          });
        });
      });

      const associations = matchResult.associations.map((draft) => {
        const dataFields: Record<string, string | number | null> = {};

        Object.entries(draft.dataFields).forEach(([field, value]) => {
          const conflict = conflictByDraftField.get(`${draft.orderKey}_${field}`);
          const resolution = conflict ? resolutionByField[field] ?? "replace" : null;

          if (resolution === "discard") return;

          if (resolution === "sum" && typeof value === "number") {
            const existingNumber = Number(conflict?.existingValue);

            dataFields[field] = Number.isFinite(existingNumber) ? value + existingNumber : value;
            return;
          }

          dataFields[field] = value;
        });

        return {
          fileId,
          fileName: customName.trim() || file.name,
          marketplace,
          categoryId: category?.id ?? null,
          saleId: draft.saleId,
          orderKey: draft.orderKey,
          targetField: associationSettings.targetField,
          saleMonth: draft.saleMonth,
          referenceMonth,
          dataFields,
        };
      });

      await saveImportAssociations(fileId, associations, (saved, total) => {
        setSaveProgress(Math.round((saved / total) * 100));
      });

      const status =
        matchResult.matchedRows === 0
          ? "no_match"
          : matchResult.unmatchedRows > 0
            ? "partial"
            : "success";

      await finalizeImport(fileId, { status }, templateId);

      if (saveAsTemplateName.trim()) {
        const defaultMappings = Object.fromEntries(
          columnMappings.map((mapping) => [
            mapping.originalName.toLowerCase(),
            {
              friendlyName: mapping.friendlyName,
              dataType: mapping.dataType,
              displayInConciliacao: mapping.displayInConciliacao,
              destinationKey: mapping.destinationKey,
              aggregateSum: mapping.aggregateSum,
            },
          ])
        );

        await savePlanilhaTemplate({
          name: saveAsTemplateName.trim(),
          marketplace,
          defaultMappings,
          associationSettings,
        });
      }

      toast({
        title: "Planilha importada",
        description: `${matchResult.matchedRows}/${rows.length} linha(s) associada(s) a ${matchResult.groupedSales} chave(s).`,
      });
      onOpenChange(false);
      resetWizard();
      onImported();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar importação",
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setIsSavingImport(false);
    }
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;

    try {
      const { category } = await savePlanilhaCategory({ name: newCategoryName.trim() });

      onCategoryCreated(category);
      setCategoryId(category.id);
      setNewCategoryName("");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro ao criar categoria",
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    }
  };

  const canAdvance = (() => {
    switch (step) {
      case 0:
        return marketplace.trim().length > 0;
      case 1:
        return Boolean(categoryId);
      case 2:
        return headers.length > 0 && rows.length > 0 && /^\d{4}-\d{2}$/.test(referenceMonth);
      case 3:
        return Boolean(associationSettings.keyColumn) && columnMappings.some((mapping) => mapping.displayInConciliacao);
      case 4:
        return Boolean(matchResult) && crossMonthAccepted;
      default:
        return true;
    }
  })();

  const goNext = () => {
    if (step === 3) {
      void handleValidate();
      return;
    }

    setStep((previous) => Math.min(previous + 1, wizardSteps.length - 1));
  };

  const hasUnresolvedCrossMonth = (matchResult?.crossMonthMatches.length ?? 0) > 0 && !crossMonthAccepted;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isSavingImport && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Importar planilha</DialogTitle>
          <DialogDescription>
            Etapa {step + 1} de {wizardSteps.length}: {wizardSteps[step]}
          </DialogDescription>
        </DialogHeader>

        <PlanilhasWizardProgress steps={wizardSteps} currentStep={step} />

        <ScrollArea className="max-h-[55vh] pr-3">
          {step === 0 ? (
            <PlanilhasMarketplaceStep
              marketplace={marketplace}
              presets={marketplacePresets}
              onMarketplaceChange={setMarketplace}
            />
          ) : null}

          {step === 1 ? (
            <PlanilhasCategoryStep
              categories={categories}
              categoryId={categoryId}
              newCategoryName={newCategoryName}
              onCategoryChange={setCategoryId}
              onNewCategoryNameChange={setNewCategoryName}
              onCreateCategory={() => void handleCreateCategory()}
            />
          ) : null}

          {step === 2 ? (
            <PlanilhasUploadFileStep
              file={file}
              rowsCount={rows.length}
              headersCount={headers.length}
              sheetNames={sheetNames}
              selectedSheet={selectedSheet}
              referenceMonth={referenceMonth}
              customName={customName}
              onFileSelected={handleFileSelected}
              onSheetChange={(value) => {
                setSelectedSheet(value);
                if (workbook) readSheet(workbook, value);
              }}
              onReferenceMonthChange={setReferenceMonth}
              onCustomNameChange={setCustomName}
            />
          ) : null}

          {step === 3 ? (
            <div className="space-y-4 py-2">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-500">Template</p>
                  <Select value={templateId ?? "none"} onValueChange={(value) => value !== "none" && applyTemplateById(value)}>
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder="Sem template" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem template</SelectItem>
                      {templates.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-500">Coluna chave</p>
                  <Select
                    value={associationSettings.keyColumn || undefined}
                    onValueChange={(value) => setAssociationSettings((previous) => ({ ...previous, keyColumn: value }))}
                  >
                    <SelectTrigger className="w-56">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {headers.map((header) => (
                        <SelectItem key={header} value={header}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-500">Associar por</p>
                  <Select
                    value={associationSettings.targetField}
                    onValueChange={(value) =>
                      setAssociationSettings((previous) => ({ ...previous, targetField: value as PlanilhaTargetField }))
                    }
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {targetFieldOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-500">Comparação</p>
                  <Select
                    value={associationSettings.matchStrategy}
                    onValueChange={(value) =>
                      setAssociationSettings((previous) => ({ ...previous, matchStrategy: value as PlanilhaMatchStrategy }))
                    }
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {matchStrategyOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">Usar</TableHead>
                    <TableHead>Coluna da planilha</TableHead>
                    <TableHead>Nome amigável</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Somar</TableHead>
                    <TableHead>Amostra</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {columnMappings.map((mapping, index) => (
                    <TableRow key={mapping.originalName}>
                      <TableCell>
                        <Checkbox
                          checked={mapping.displayInConciliacao}
                          onCheckedChange={(checked) => updateMapping(index, { displayInConciliacao: checked === true })}
                        />
                      </TableCell>
                      <TableCell className="max-w-48 truncate" title={mapping.originalName}>
                        {mapping.originalName}
                        {mapping.originalName === associationSettings.keyColumn ? (
                          <Badge variant="outline" className="ml-2">chave</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8"
                          value={mapping.friendlyName}
                          onChange={(event) => updateMapping(index, { friendlyName: event.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={mapping.dataType}
                          onValueChange={(value) => updateMapping(index, { dataType: value as PlanilhaColumnMapping["dataType"] })}
                        >
                          <SelectTrigger className="h-8 w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Texto</SelectItem>
                            <SelectItem value="number">Número</SelectItem>
                            <SelectItem value="currency">Moeda</SelectItem>
                            <SelectItem value="date">Data</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={Boolean(mapping.aggregateSum)}
                          disabled={mapping.dataType !== "number" && mapping.dataType !== "currency"}
                          onCheckedChange={(checked) => updateMapping(index, { aggregateSum: checked === true })}
                        />
                      </TableCell>
                      <TableCell className="max-w-32 truncate text-xs text-slate-500" title={mapping.sampleValue}>
                        {mapping.sampleValue ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500">Salvar este mapeamento como template (opcional)</p>
                <Input
                  placeholder="Nome do template..."
                  value={saveAsTemplateName}
                  onChange={(event) => setSaveAsTemplateName(event.target.value)}
                />
              </div>
            </div>
          ) : null}

          {step === 4 && matchResult ? (
            <div className="space-y-4 py-2">
              <div className="grid gap-3 sm:grid-cols-4">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-slate-500">Linhas casadas</p>
                    <p className="text-2xl font-bold text-green-600">{matchResult.matchedRows}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-slate-500">Sem match</p>
                    <p className="text-2xl font-bold text-amber-600">{matchResult.unmatchedRows}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-slate-500">Chaves únicas</p>
                    <p className="text-2xl font-bold">{matchResult.groupedSales}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-slate-500">Duplicadas (somadas)</p>
                    <p className="text-2xl font-bold">{matchResult.duplicateKeys}</p>
                  </CardContent>
                </Card>
              </div>

              {matchResult.crossMonthMatches.length > 0 ? (
                <Alert className="border-amber-300 bg-amber-50">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertTitle>Pedidos de outros meses</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <p>
                      {matchResult.crossMonthMatches
                        .map((summary) => `${formatPlanilhaMonthLabel(summary.month)}: ${summary.matches} match(es)`)
                        .join(" · ")}
                    </p>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={crossMonthAccepted}
                        onCheckedChange={(checked) => setCrossMonthAccepted(checked === true)}
                      />
                      Aceito associar pedidos fora do mês de referência
                    </label>
                  </AlertDescription>
                </Alert>
              ) : null}

              {conflictGroups.length > 0 ? (
                <div className="space-y-3">
                  <Alert className="border-red-200 bg-red-50">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <AlertTitle>Conflitos com dados existentes</AlertTitle>
                    <AlertDescription>
                      Alguns campos já possuem valores de importações anteriores. Escolha como resolver cada grupo.
                    </AlertDescription>
                  </Alert>
                  {conflictGroups.map((group) => (
                    <div key={group.field} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{group.fieldLabel}</p>
                          <p className="text-xs text-slate-500">{group.conflicts.length} conflito(s)</p>
                        </div>
                        <Select
                          value={conflictResolutions[group.field] ?? "replace"}
                          onValueChange={(value) =>
                            setConflictResolutions((previous) => ({
                              ...previous,
                              [group.field]: value as PlanilhaConflictResolution,
                            }))
                          }
                        >
                          <SelectTrigger className="w-44">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="replace">Substituir</SelectItem>
                            <SelectItem value="sum">Somar</SelectItem>
                            <SelectItem value="discard">Manter anterior</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        Ex.: {String(group.conflicts[0]?.existingValue)} → {String(group.conflicts[0]?.newValue)} (
                        {group.conflicts[0]?.existingSource || "importação anterior"})
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}

              {matchResult.unmatchedDetails.length > 0 ? (
                <details className="rounded-lg border border-slate-200 p-3 text-sm">
                  <summary className="cursor-pointer font-medium">
                    Linhas sem match ({matchResult.unmatchedRows}) — primeiras {matchResult.unmatchedDetails.length}
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {matchResult.unmatchedDetails.map((row) => (
                      <li key={row.rowNumber}>
                        Linha {row.rowNumber}: "{row.keyValue}" — {row.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}

          {step === 5 && matchResult ? (
            <div className="space-y-4 py-2">
              <Alert className="border-green-200 bg-green-50">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle>Pronto para importar</AlertTitle>
                <AlertDescription>
                  {matchResult.matchedRows} linha(s) serão associadas a {matchResult.groupedSales} chave(s) de{" "}
                  {marketplace} ({formatPlanilhaMonthLabel(referenceMonth)}).
                  {conflictGroups.length > 0 ? ` ${conflictGroups.length} grupo(s) de conflito resolvido(s).` : ""}
                </AlertDescription>
              </Alert>
              {isSavingImport ? (
                <div className="space-y-2">
                  <Progress value={saveProgress} />
                  <p className="text-center text-sm text-slate-500">Salvando associações... {saveProgress}%</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </ScrollArea>

        <DialogFooter>
          <PlanilhasWizardFooter
            step={step}
            stepsLength={wizardSteps.length}
            isSavingImport={isSavingImport}
            isValidating={isValidating}
            canAdvance={canAdvance}
            hasUnresolvedCrossMonth={hasUnresolvedCrossMonth}
            onBack={() => setStep((previous) => Math.max(previous - 1, 0))}
            onNext={goNext}
            onSave={() => void handleSaveImport()}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
