"use client";

import * as React from "react";
import {
  AlertCircle,
  ArrowUpDown,
  Boxes,
  CheckCircle2,
  Eye,
  FileText,
  FilterX,
  Link2,
  ListChecks,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  WandSparkles,
} from "lucide-react";

import {
  approveBrSteelSafeProductSkuAssociations,
  getBrSteelProductAssociationsOverview,
  getBrSteelProductsFromSheet,
  replaceBrSteelProductSkuAssociations,
  saveBrSteelProductKitComposition,
} from "@/app/actions";
import DashboardLayout from "@/components/dashboard-layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { BrSteelProduct, BrSteelProductsSheetResult, ProductQualityStatus } from "@/types/brsteel-product";

type AssociationOverview = Awaited<ReturnType<typeof getBrSteelProductAssociationsOverview>>;
type UnmatchedListingGroup = AssociationOverview["unmatchedListingGroups"][number];
type UnmatchedReviewStatus = UnmatchedListingGroup["reviewStatus"];
type UnmatchedReviewFilter = "all" | UnmatchedReviewStatus;
type KitComponentDraft = {
  id: string;
  parentSku: string;
  quantity: string;
};

const ALL = "all";
const PAGE_SIZE = 12;

const qualityMeta: Record<ProductQualityStatus, { label: string; className: string; icon: React.ElementType }> = {
  complete: {
    label: "Completo",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: CheckCircle2,
  },
  review: {
    label: "Revisar",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    icon: TriangleAlert,
  },
  critical: {
    label: "Crítico",
    className: "border-red-200 bg-red-50 text-red-700",
    icon: AlertCircle,
  },
};

type SortMode = "sku" | "quality" | "type" | "weight";

const unmatchedReviewFilterLabels: Record<UnmatchedReviewFilter, string> = {
  all: "Todos",
  kit_configured: "Kit configurado",
  safe_match: "Match seguro",
  kit_combo: "Kit/Combo",
  needs_review: "Revisar",
  no_suggestion: "Sem sugestão",
  without_sku: "Sem SKU",
};

const unmatchedReviewStatusClassNames: Record<UnmatchedReviewStatus, string> = {
  kit_configured: "border-teal-200 bg-teal-50 text-teal-700",
  safe_match: "border-emerald-200 bg-emerald-50 text-emerald-700",
  kit_combo: "border-amber-200 bg-amber-50 text-amber-700",
  needs_review: "border-blue-200 bg-blue-50 text-blue-700",
  no_suggestion: "border-zinc-200 bg-zinc-50 text-zinc-700",
  without_sku: "border-red-200 bg-red-50 text-red-700",
};

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const formatNumber = (value: number | null, suffix = "") => {
  if (value === null) return "-";
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)}${suffix}`;
};

const formatCurrency = (value: number | null) => {
  if (value === null) return "-";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(value);
};

const formatPriceRange = (min: number | null, max: number | null) => {
  if (min === null && max === null) return "-";
  if (min === max || max === null) return formatCurrency(min);
  if (min === null) return formatCurrency(max);
  return `${formatCurrency(min)} - ${formatCurrency(max)}`;
};

const formatDimensions = (product: BrSteelProduct) => {
  const dimensions = [product.widthCm, product.heightCm, product.depthCm].map((value) => formatNumber(value));
  return dimensions.every((value) => value === "-") ? "-" : `${dimensions[0]} x ${dimensions[1]} x ${dimensions[2]} cm`;
};

const uniqueOptions = (values: string[]) =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR"));

const parseSkuList = (value: string) =>
  Array.from(new Set(value.split(/[,\n;\t ]+/).map((sku) => sku.trim()).filter(Boolean)));

const createKitComponentDraftId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const parseKitQuantity = (value: string) => {
  const parsed = Number(value.replace(",", "."));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

function QualityBadge({ status, score }: { status: ProductQualityStatus; score: number }) {
  const meta = qualityMeta[status];
  const Icon = meta.icon;

  return (
    <Badge variant="outline" className={`gap-1 whitespace-nowrap ${meta.className}`}>
      <Icon className="h-3.5 w-3.5" />
      {meta.label} · {score}%
    </Badge>
  );
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  isLoading,
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ElementType;
  isLoading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold">{value}</div>}
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function DetailItem({ label, value }: { label: string; value?: React.ReactNode }) {
  const displayValue = value === null || value === undefined || value === "" ? "-" : value;

  return (
    <div className="min-w-0 rounded-md border border-zinc-200 bg-white px-3 py-2">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <div className="mt-1 break-words text-sm font-medium text-zinc-900">{displayValue}</div>
    </div>
  );
}

export default function ProdutosClient() {
  const [sheetResult, setSheetResult] = React.useState<BrSteelProductsSheetResult | null>(null);
  const [associationOverview, setAssociationOverview] = React.useState<AssociationOverview | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [isAssociationsLoading, setIsAssociationsLoading] = React.useState(true);
  const [isSavingAssociations, setIsSavingAssociations] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [associationError, setAssociationError] = React.useState<string | null>(null);
  const [associationNotice, setAssociationNotice] = React.useState<string | null>(null);
  const [searchTerm, setSearchTerm] = React.useState("");
  const [productTypeFilter, setProductTypeFilter] = React.useState(ALL);
  const [sourceSheetFilter, setSourceSheetFilter] = React.useState(ALL);
  const [installationFilter, setInstallationFilter] = React.useState(ALL);
  const [materialFilter, setMaterialFilter] = React.useState(ALL);
  const [qualityFilter, setQualityFilter] = React.useState(ALL);
  const [sortMode, setSortMode] = React.useState<SortMode>("sku");
  const [currentPage, setCurrentPage] = React.useState(1);
  const [unmatchedSearchTerm, setUnmatchedSearchTerm] = React.useState("");
  const [unmatchedFilter, setUnmatchedFilter] = React.useState<UnmatchedReviewFilter>("all");
  const [unmatchedVisibleCount, setUnmatchedVisibleCount] = React.useState(8);
  const [selectedProduct, setSelectedProduct] = React.useState<BrSteelProduct | null>(null);
  const [associationProduct, setAssociationProduct] = React.useState<BrSteelProduct | null>(null);
  const [associationText, setAssociationText] = React.useState("");
  const [parentPickerGroup, setParentPickerGroup] = React.useState<UnmatchedListingGroup | null>(null);
  const [parentPickerSku, setParentPickerSku] = React.useState("");
  const [kitGroup, setKitGroup] = React.useState<UnmatchedListingGroup | null>(null);
  const [kitComponents, setKitComponents] = React.useState<KitComponentDraft[]>([]);
  const [isSavingKitComposition, setIsSavingKitComposition] = React.useState(false);
  const [isApprovingSafeAssociations, setIsApprovingSafeAssociations] = React.useState(false);

  const products = sheetResult?.products ?? [];

  const loadProducts = React.useCallback(async (refreshing = false) => {
    if (refreshing) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const result = await getBrSteelProductsFromSheet();
      setSheetResult(result);
    } catch (loadError: any) {
      setError(loadError?.message || "Não foi possível carregar a planilha de produtos.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const loadAssociationOverview = React.useCallback(async () => {
    setIsAssociationsLoading(true);
    setAssociationError(null);

    try {
      const result = await getBrSteelProductAssociationsOverview();
      setAssociationOverview(result);
    } catch (loadError: any) {
      setAssociationError(loadError?.message || "Não foi possível carregar vínculos com anúncios ML.");
    } finally {
      setIsAssociationsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  React.useEffect(() => {
    loadAssociationOverview();
  }, [loadAssociationOverview]);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, productTypeFilter, sourceSheetFilter, installationFilter, materialFilter, qualityFilter, sortMode]);

  React.useEffect(() => {
    setUnmatchedVisibleCount(8);
  }, [unmatchedFilter, unmatchedSearchTerm]);

  const filterOptions = React.useMemo(
    () => ({
      sourceSheets: sheetResult?.sourceSheets ?? [],
      productTypes: uniqueOptions(products.map((product) => product.productType)),
      installations: uniqueOptions(products.map((product) => product.installationType)),
      materials: uniqueOptions(products.map((product) => product.material)),
    }),
    [products, sheetResult?.sourceSheets]
  );

  const stats = React.useMemo(() => {
    const total = products.length;
    const typeCount = new Set(products.map((product) => product.productType).filter(Boolean)).size;
    const withGtin = products.filter((product) => product.gtin).length;
    const averageScore = total
      ? Math.round(products.reduce((sum, product) => sum + product.completenessScore, 0) / total)
      : 0;
    const toReview = products.filter((product) => product.qualityStatus !== "complete").length;

    return { total, typeCount, withGtin, averageScore, toReview };
  }, [products]);

  const associationStatsBySku = React.useMemo(() => {
    return new Map((associationOverview?.productStats ?? []).map((stat) => [stat.parentSku, stat]));
  }, [associationOverview]);

  const productsBySku = React.useMemo(() => {
    return new Map(products.map((product) => [product.sku, product]));
  }, [products]);

  const unmatchedListingGroups = associationOverview?.unmatchedListingGroups ?? [];
  const unmatchedReviewCounts = React.useMemo(() => {
    const counts: Record<UnmatchedReviewFilter, number> = {
      all: unmatchedListingGroups.length,
      kit_configured: 0,
      safe_match: 0,
      kit_combo: 0,
      needs_review: 0,
      no_suggestion: 0,
      without_sku: 0,
    };

    for (const group of unmatchedListingGroups) {
      counts[group.reviewStatus] += 1;
    }

    return counts;
  }, [unmatchedListingGroups]);
  const filteredUnmatchedListingGroups = React.useMemo(() => {
    const normalizedSearch = normalize(unmatchedSearchTerm.trim());

    return unmatchedListingGroups.filter((group) => {
      const matchesFilter = unmatchedFilter === "all" || group.reviewStatus === unmatchedFilter;
      if (!matchesFilter) return false;
      if (!normalizedSearch) return true;

      const searchable = [
        group.sellerSku,
        group.sampleTitle,
        ...group.itemIds,
        ...group.suggestions.flatMap((suggestion) => [suggestion.parentSku, suggestion.productType, suggestion.productName]),
        ...(group.kitComposition?.components.flatMap((component) => [
          component.parentSku,
          component.productType,
          component.productName,
        ]) ?? []),
      ]
        .filter(Boolean)
        .join(" ");

      return normalize(searchable).includes(normalizedSearch);
    });
  }, [unmatchedFilter, unmatchedListingGroups, unmatchedSearchTerm]);
  const visibleUnmatchedListingGroups = filteredUnmatchedListingGroups.slice(0, unmatchedVisibleCount);

  const filteredProducts = React.useMemo(() => {
    const normalizedSearch = normalize(searchTerm.trim());

    const filtered = products.filter((product) => {
      const matchesSearch = !normalizedSearch || normalize(product.searchText).includes(normalizedSearch);
      const matchesSourceSheet = sourceSheetFilter === ALL || product.sourceSheets.includes(sourceSheetFilter);
      const matchesType = productTypeFilter === ALL || product.productType === productTypeFilter;
      const matchesInstallation = installationFilter === ALL || product.installationType === installationFilter;
      const matchesMaterial = materialFilter === ALL || product.material === materialFilter;
      const matchesQuality = qualityFilter === ALL || product.qualityStatus === qualityFilter;

      return matchesSearch && matchesSourceSheet && matchesType && matchesInstallation && matchesMaterial && matchesQuality;
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === "quality") return a.completenessScore - b.completenessScore;
      if (sortMode === "type") return a.productType.localeCompare(b.productType, "pt-BR");
      if (sortMode === "weight") return (b.grossWeightKg ?? 0) - (a.grossWeightKg ?? 0);
      return a.sku.localeCompare(b.sku, "pt-BR");
    });
  }, [installationFilter, materialFilter, productTypeFilter, products, qualityFilter, searchTerm, sortMode, sourceSheetFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const paginatedProducts = filteredProducts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hasActiveFilters =
    searchTerm ||
    productTypeFilter !== ALL ||
    sourceSheetFilter !== ALL ||
    installationFilter !== ALL ||
    materialFilter !== ALL ||
    qualityFilter !== ALL;

  const clearFilters = () => {
    setSearchTerm("");
    setProductTypeFilter(ALL);
    setSourceSheetFilter(ALL);
    setInstallationFilter(ALL);
    setMaterialFilter(ALL);
    setQualityFilter(ALL);
  };

  const refreshAll = () => {
    void loadProducts(true);
    void loadAssociationOverview();
  };

  const openAssociationDialog = (product: BrSteelProduct, childSkuToAdd?: string | null) => {
    const stat = associationStatsBySku.get(product.sku);
    const associatedSkus = new Set(stat?.associatedSkus ?? []);
    if (childSkuToAdd) {
      associatedSkus.add(childSkuToAdd);
    }

    setAssociationProduct(product);
    setAssociationText(Array.from(associatedSkus).join("\n"));
    setAssociationError(null);
    setAssociationNotice(null);
  };

  const openAssociationFromSuggestion = (group: UnmatchedListingGroup, parentSku: string) => {
    const product = productsBySku.get(parentSku);
    if (!product || !group.sellerSku) return;

    openAssociationDialog(product, group.sellerSku);
  };

  const openParentPicker = (group: UnmatchedListingGroup) => {
    setParentPickerGroup(group);
    setParentPickerSku(group.suggestions[0]?.parentSku ?? "");
    setAssociationError(null);
  };

  const preparePickedAssociation = () => {
    if (!parentPickerGroup || !parentPickerSku) return;
    const product = productsBySku.get(parentPickerSku);
    if (!product || !parentPickerGroup.sellerSku) return;

    setParentPickerGroup(null);
    openAssociationDialog(product, parentPickerGroup.sellerSku);
  };

  const openKitDialog = (group: UnmatchedListingGroup) => {
    const savedComponents = group.kitComposition?.components ?? [];
    const drafts = savedComponents.length
      ? savedComponents.map((component) => ({
          id: createKitComponentDraftId(),
          parentSku: component.parentSku,
          quantity: String(component.quantity),
        }))
      : group.suggestions
          .filter((suggestion) => productsBySku.has(suggestion.parentSku))
          .map((suggestion) => ({
            id: createKitComponentDraftId(),
            parentSku: suggestion.parentSku,
            quantity: String(suggestion.suggestedQuantity || 1),
          }));

    setKitGroup(group);
    setKitComponents(drafts.length > 0 ? drafts : [{ id: createKitComponentDraftId(), parentSku: "", quantity: "1" }]);
    setAssociationError(null);
    setAssociationNotice(null);
  };

  const addKitComponent = () => {
    setKitComponents((components) => [
      ...components,
      { id: createKitComponentDraftId(), parentSku: "", quantity: "1" },
    ]);
  };

  const updateKitComponent = (id: string, patch: Partial<Omit<KitComponentDraft, "id">>) => {
    setKitComponents((components) =>
      components.map((component) => (component.id === id ? { ...component, ...patch } : component))
    );
  };

  const removeKitComponent = (id: string) => {
    setKitComponents((components) => {
      if (components.length <= 1) return components;
      return components.filter((component) => component.id !== id);
    });
  };

  const approveSafeAssociations = async () => {
    setIsApprovingSafeAssociations(true);
    setAssociationError(null);
    setAssociationNotice(null);

    try {
      const result = await approveBrSteelSafeProductSkuAssociations();
      await loadAssociationOverview();

      const conflictText = result.conflicts.length
        ? ` ${result.conflicts.length} conflito(s) foram ignorados.`
        : "";
      const skippedText = result.skipped ? ` ${result.skipped} item(ns) inválido(s) ignorado(s).` : "";

      setAssociationNotice(
        `${result.saved} match(es) seguro(s) aprovado(s) de ${result.attempted} candidato(s).${conflictText}${skippedText}`
      );
    } catch (approveError: any) {
      setAssociationError(approveError?.message || "Não foi possível aprovar os matches seguros.");
    } finally {
      setIsApprovingSafeAssociations(false);
    }
  };

  const saveAssociations = async () => {
    if (!associationProduct) return;

    setIsSavingAssociations(true);
    setAssociationError(null);
    setAssociationNotice(null);

    try {
      const result = await replaceBrSteelProductSkuAssociations({
        parentSku: associationProduct.sku,
        childSkus: parseSkuList(associationText),
      });

      await loadAssociationOverview();

      const conflictText = result.conflicts.length
        ? ` ${result.conflicts.length} conflito(s) foram ignorados.`
        : "";
      const skippedText = result.skipped ? ` ${result.skipped} item(ns) inválido(s) ignorado(s).` : "";

      setAssociationNotice(`${result.saved} SKU(s) salvo(s), ${result.removed} removido(s).${conflictText}${skippedText}`);
      if (result.conflicts.length === 0) {
        setAssociationProduct(null);
      }
    } catch (saveError: any) {
      setAssociationError(saveError?.message || "Não foi possível salvar as associações.");
    } finally {
      setIsSavingAssociations(false);
    }
  };

  const kitComponentPayload = kitComponents
    .map((component) => {
      const quantity = parseKitQuantity(component.quantity);
      return component.parentSku && quantity ? { parentSku: component.parentSku, quantity } : null;
    })
    .filter((component): component is { parentSku: string; quantity: number } => component !== null);
  const canSaveKitComposition =
    Boolean(kitGroup?.sellerSku) &&
    kitComponents.length > 0 &&
    kitComponentPayload.length === kitComponents.length;

  const saveKitComposition = async () => {
    if (!kitGroup?.sellerSku || !canSaveKitComposition) return;

    setIsSavingKitComposition(true);
    setAssociationError(null);
    setAssociationNotice(null);

    try {
      const result = await saveBrSteelProductKitComposition({
        kitSku: kitGroup.sellerSku,
        components: kitComponentPayload,
      });

      await loadAssociationOverview();
      setAssociationNotice(
        `Kit ${kitGroup.sellerSku} configurado com ${result.components.length} componente(s).`
      );
      setKitGroup(null);
    } catch (saveError: any) {
      setAssociationError(saveError?.message || "Não foi possível salvar a composição do kit.");
    } finally {
      setIsSavingKitComposition(false);
    }
  };

  const fetchedAt = sheetResult?.fetchedAt
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(sheetResult.fetchedAt))
    : "-";
  const unmatchedDescription =
    unmatchedFilter === "all"
      ? `${unmatchedReviewCounts.all} SKU(s) únicos em ${associationOverview?.unlinkedListings ?? 0} anúncio(s) sem vínculo.`
      : `${filteredUnmatchedListingGroups.length} de ${unmatchedReviewCounts.all} SKU(s) únicos em ${unmatchedReviewFilterLabels[unmatchedFilter].toLowerCase()}.`;
  const reviewDescription =
    stats.toReview === 1 ? "1 item precisa revisão" : `${stats.toReview} itens precisam revisão`;
  const associationDialogStat = associationProduct ? associationStatsBySku.get(associationProduct.sku) : null;
  const associationDialogSkus = parseSkuList(associationText);

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-6 p-4 pt-6 md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Produtos</h2>
            <p className="text-muted-foreground">
              Catálogo técnico e fiscal da BR Steel a partir da planilha produtos brsteel.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="h-10 gap-2 rounded-md px-3 font-medium">
              <FileText className="h-4 w-4" />
              Atualizado {fetchedAt}
            </Badge>
            <Button variant="outline" onClick={refreshAll} disabled={isLoading || isRefreshing || isAssociationsLoading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {associationError && !associationProduct && !kitGroup && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{associationError}</AlertDescription>
          </Alert>
        )}

        {associationNotice && !associationProduct && !kitGroup && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>{associationNotice}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard
            title="Produtos"
            value={String(stats.total)}
            description={`${sheetResult?.sourceSheets.length || 0} abas, ${sheetResult?.totalRows || 0} linhas lidas`}
            icon={Package}
            isLoading={isLoading}
          />
          <StatCard
            title="Tipos"
            value={String(stats.typeCount)}
            description="Categorias distintas na planilha"
            icon={ArrowUpDown}
            isLoading={isLoading}
          />
          <StatCard
            title="Anúncios ML"
            value={`${associationOverview?.linkedListings ?? 0}/${associationOverview?.totalListings ?? 0}`}
            description={`${associationOverview?.unlinkedListings ?? 0} sem produto mãe${
              associationOverview?.kitConfiguredListings ? ` · ${associationOverview.kitConfiguredListings} em kits` : ""
            }`}
            icon={Link2}
            isLoading={isAssociationsLoading}
          />
          <StatCard
            title="Com GTIN"
            value={`${stats.withGtin}/${stats.total || 0}`}
            description="Produtos com código de embalagem"
            icon={ShieldCheck}
            isLoading={isLoading}
          />
          <StatCard
            title="Qualidade média"
            value={`${stats.averageScore}%`}
            description={reviewDescription}
            icon={CheckCircle2}
            isLoading={isLoading}
          />
        </div>

        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ListChecks className="h-5 w-5" />
                  Anúncios sem produto mãe
                </CardTitle>
                <CardDescription>
                  {unmatchedDescription}
                </CardDescription>
              </div>
              <div className="relative w-full lg:w-[360px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={unmatchedSearchTerm}
                  onChange={(event) => setUnmatchedSearchTerm(event.target.value)}
                  placeholder="Buscar SKU, anúncio ou sugestão..."
                  className="pl-8"
                />
              </div>
            </div>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(unmatchedReviewFilterLabels) as UnmatchedReviewFilter[]).map((filter) => (
                  <Button
                    key={filter}
                    type="button"
                    variant={unmatchedFilter === filter ? "default" : "outline"}
                    size="sm"
                    onClick={() => setUnmatchedFilter(filter)}
                  >
                    {unmatchedReviewFilterLabels[filter]}
                    <Badge
                      variant={unmatchedFilter === filter ? "secondary" : "outline"}
                      className="ml-2 rounded-sm px-1.5 py-0 text-[10px]"
                    >
                      {unmatchedReviewCounts[filter]}
                    </Badge>
                  </Button>
                ))}
              </div>
              <Button
                type="button"
                onClick={approveSafeAssociations}
                disabled={isAssociationsLoading || isApprovingSafeAssociations || unmatchedReviewCounts.safe_match === 0}
              >
                {isApprovingSafeAssociations ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <WandSparkles className="mr-2 h-4 w-4" />
                )}
                Aprovar matches seguros ({unmatchedReviewCounts.safe_match})
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU do anúncio</TableHead>
                  <TableHead className="whitespace-nowrap">Anúncios</TableHead>
                  <TableHead>Movimento</TableHead>
                  <TableHead>Sugestão</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isAssociationsLoading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell><Skeleton className="h-12 w-64" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-36" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-52" /></TableCell>
                      <TableCell><Skeleton className="ml-auto h-8 w-32" /></TableCell>
                    </TableRow>
                  ))
                ) : visibleUnmatchedListingGroups.length > 0 ? (
                  visibleUnmatchedListingGroups.map((group) => {
                    const topSuggestion = group.suggestions[0] ?? null;
                    const canAssociate = Boolean(group.sellerSku) && !isLoading;
                    const isKitGroup =
                      group.reviewStatus === "kit_combo" || group.reviewStatus === "kit_configured";

                    return (
                      <TableRow key={group.key}>
                        <TableCell className="min-w-[280px]">
                          <div className="flex gap-3">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-zinc-50 text-zinc-500">
                              {group.thumbnail ? (
                                <img src={group.thumbnail} alt={group.sampleTitle || group.sellerSku || "Anúncio"} className="h-full w-full object-contain" />
                              ) : (
                                <Package className="h-5 w-5" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="font-mono text-sm font-semibold text-zinc-900">{group.sellerSku || "Sem SKU"}</div>
                              <div className="mt-1 max-w-[420px] break-words text-xs text-muted-foreground">
                                {group.sampleTitle || "Sem título"}
                              </div>
                              {group.itemIds.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {group.itemIds.slice(0, 2).map((itemId) => (
                                    <Badge key={itemId} variant="outline" className="font-mono text-[10px]">
                                      {itemId}
                                    </Badge>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium">{formatNumber(group.totalListings)}</div>
                          <div className="text-xs text-muted-foreground">{formatNumber(group.activeListings)} ativo(s)</div>
                        </TableCell>
                        <TableCell className="min-w-[160px]">
                          <div className="text-sm font-medium">{formatNumber(group.totalSold)} vendido(s)</div>
                          <div className="text-xs text-muted-foreground">{formatPriceRange(group.priceMin, group.priceMax)}</div>
                        </TableCell>
                        <TableCell className="min-w-[260px]">
                          <Badge variant="outline" className={`mb-2 ${unmatchedReviewStatusClassNames[group.reviewStatus]}`}>
                            {unmatchedReviewFilterLabels[group.reviewStatus]}
                          </Badge>
                          {group.suggestions.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {group.suggestions.map((suggestion) => (
                                <Badge key={suggestion.parentSku} variant="secondary" className="gap-1">
                                  <WandSparkles className="h-3 w-3" />
                                  {suggestion.suggestedQuantity > 1 ? `${suggestion.suggestedQuantity}x ` : ""}
                                  {suggestion.parentSku} · {suggestion.score}%
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">Sem sugestão por SKU</span>
                          )}
                          {group.kitComposition ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {group.kitComposition.components.slice(0, 3).map((component) => (
                                <Badge key={component.parentSku} variant="outline" className="gap-1 border-teal-200 bg-teal-50 text-teal-700">
                                  <Boxes className="h-3 w-3" />
                                  {component.quantity}x {component.parentSku}
                                </Badge>
                              ))}
                              {group.kitComposition.components.length > 3 ? (
                                <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">
                                  +{group.kitComposition.components.length - 3}
                                </Badge>
                              ) : null}
                            </div>
                          ) : null}
                          {topSuggestion ? (
                            <p className="mt-1 text-xs text-muted-foreground">{topSuggestion.reason}</p>
                          ) : null}
                          <p className="mt-1 text-xs text-muted-foreground">{group.reviewReason}</p>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end gap-2">
                            {isKitGroup ? (
                              <Button
                                variant={group.kitComposition ? "outline" : "default"}
                                size="sm"
                                disabled={!canAssociate}
                                onClick={() => openKitDialog(group)}
                              >
                                <Boxes className="mr-2 h-4 w-4" />
                                {group.kitComposition ? "Editar kit" : "Configurar kit"}
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!canAssociate || !topSuggestion}
                                onClick={() => topSuggestion && openAssociationFromSuggestion(group, topSuggestion.parentSku)}
                              >
                                <WandSparkles className="mr-2 h-4 w-4" />
                                {topSuggestion ? `Usar ${topSuggestion.parentSku}` : "Sem sugestão"}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!canAssociate}
                              onClick={() => openParentPicker(group)}
                            >
                              Escolher produto
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      Nenhum anúncio sem produto mãe encontrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {!isAssociationsLoading && filteredUnmatchedListingGroups.length > visibleUnmatchedListingGroups.length ? (
              <div className="mt-4 flex justify-center border-t pt-4">
                <Button
                  variant="outline"
                  onClick={() => setUnmatchedVisibleCount((count) => count + 8)}
                >
                  Ver mais
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle>Lista de Produtos</CardTitle>
                <CardDescription>
                  {filteredProducts.length} de {products.length} produtos encontrados.
                </CardDescription>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" onClick={clearFilters} disabled={!hasActiveFilters}>
                  <FilterX className="mr-2 h-4 w-4" />
                  Limpar
                </Button>
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-7">
              <div className="relative md:col-span-2">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Buscar por SKU, GTIN, material, NCM ou SEO..."
                  className="pl-8"
                />
              </div>
              <Select value={sourceSheetFilter} onValueChange={setSourceSheetFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Aba" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todas as abas</SelectItem>
                  {filterOptions.sourceSheets.map((sheet) => (
                    <SelectItem key={sheet.gid} value={sheet.name}>
                      {sheet.name} ({sheet.products})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={productTypeFilter} onValueChange={setProductTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos os tipos</SelectItem>
                  {filterOptions.productTypes.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={installationFilter} onValueChange={setInstallationFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Instalação" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todas instalações</SelectItem>
                  {filterOptions.installations.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={qualityFilter} onValueChange={setQualityFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Qualidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos status</SelectItem>
                  <SelectItem value="complete">Completo</SelectItem>
                  <SelectItem value="review">Revisar</SelectItem>
                  <SelectItem value="critical">Crítico</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
                <SelectTrigger>
                  <SelectValue placeholder="Ordenar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sku">SKU A-Z</SelectItem>
                  <SelectItem value="quality">Qualidade menor</SelectItem>
                  <SelectItem value="type">Tipo A-Z</SelectItem>
                  <SelectItem value="weight">Peso maior</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Select value={materialFilter} onValueChange={setMaterialFilter}>
                <SelectTrigger className="w-full md:w-[340px]">
                  <SelectValue placeholder="Material" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos os materiais</SelectItem>
                  {filterOptions.materials.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>

          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[92px]">Produto</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Dimensões</TableHead>
                  <TableHead className="text-right">Peso bruto</TableHead>
                  <TableHead>Fiscal</TableHead>
                  <TableHead>Anúncios ML</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell><Skeleton className="h-12 w-12" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-36" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-44" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="ml-auto h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                      <TableCell><Skeleton className="ml-auto h-8 w-8" /></TableCell>
                    </TableRow>
                  ))
                ) : paginatedProducts.length > 0 ? (
                  paginatedProducts.map((product) => {
                    const associationStat = associationStatsBySku.get(product.sku);
                    const associatedCount = associationStat?.associatedSkus.length ?? 0;
                    const linkedCount = associationStat?.totalListings ?? 0;
                    const kitCount = associationStat?.kitListings ?? 0;

                    return (
                      <TableRow key={product.id}>
                        <TableCell>
                          <div className="flex h-12 w-12 items-center justify-center rounded-md border bg-zinc-50 text-zinc-500">
                            <Package className="h-5 w-5" />
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-semibold text-zinc-900">{product.sku || "-"}</div>
                          <div className="text-xs text-muted-foreground">{product.gtin || "Sem GTIN"}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{product.sourceSheets.join(", ")}</div>
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <div className="font-medium">{product.productType || "-"}</div>
                          <div className="text-xs text-muted-foreground">{product.installationType || "-"}</div>
                        </TableCell>
                        <TableCell className="max-w-[260px] text-sm">{product.material || "-"}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{formatDimensions(product)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium">
                          {formatNumber(product.grossWeightKg, " kg")}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium">{product.ncm || "-"}</div>
                          <div className="text-xs text-muted-foreground">CEST {product.cest || "-"}</div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium">{linkedCount}</div>
                          <div className="text-xs text-muted-foreground">
                            {associationStat?.exactListings ?? 0} exato · {associatedCount} assoc.
                            {kitCount ? ` · ${kitCount} kit` : ""}
                          </div>
                        </TableCell>
                        <TableCell>
                          <QualityBadge status={product.qualityStatus} score={product.completenessScore} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openAssociationDialog(product)}
                              title="Associar SKUs de anúncios"
                              aria-label={`Associar SKUs de anúncios a ${product.sku}`}
                            >
                              <Link2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setSelectedProduct(product)}
                              title="Ver detalhes"
                              aria-label={`Ver detalhes de ${product.sku}`}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={10} className="h-24 text-center">
                      Nenhum produto encontrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {!isLoading && filteredProducts.length > 0 && (
              <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Página {currentPage} de {totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={currentPage === 1}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Próxima
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={!!parentPickerGroup} onOpenChange={(open) => !open && setParentPickerGroup(null)}>
          <DialogContent className="sm:max-w-xl">
            {parentPickerGroup && (
              <>
                <DialogHeader>
                  <DialogTitle>Escolher produto mãe</DialogTitle>
                  <DialogDescription>
                    SKU do anúncio {parentPickerGroup.sellerSku || "Sem SKU"}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="rounded-md border bg-zinc-50 p-3">
                    <p className="text-sm font-medium">{parentPickerGroup.sampleTitle || "Sem título"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatNumber(parentPickerGroup.totalListings)} anúncio(s) · {formatNumber(parentPickerGroup.totalSold)} vendido(s)
                    </p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium">Produto mãe</p>
                    <Select value={parentPickerSku} onValueChange={setParentPickerSku}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um produto" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((product) => (
                          <SelectItem key={product.sku} value={product.sku}>
                            {product.sku} · {product.productType || "Produto BR Steel"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setParentPickerGroup(null)}>
                    Cancelar
                  </Button>
                  <Button onClick={preparePickedAssociation} disabled={!parentPickerSku || !parentPickerGroup.sellerSku}>
                    <Link2 className="mr-2 h-4 w-4" />
                    Preparar vínculo
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={!!kitGroup} onOpenChange={(open) => !open && setKitGroup(null)}>
          <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
            {kitGroup && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex flex-wrap items-center gap-2">
                    <Boxes className="h-5 w-5" />
                    Configurar kit
                  </DialogTitle>
                  <DialogDescription>
                    SKU do anúncio {kitGroup.sellerSku || "Sem SKU"} · {formatNumber(kitGroup.totalListings)} anúncio(s)
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="rounded-md border bg-zinc-50 p-3">
                    <p className="text-sm font-medium">{kitGroup.sampleTitle || "Sem título"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatNumber(kitGroup.totalSold)} vendido(s) · {formatPriceRange(kitGroup.priceMin, kitGroup.priceMax)}
                    </p>
                  </div>

                  {associationError && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{associationError}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">Componentes</p>
                      <Button type="button" variant="outline" size="sm" onClick={addKitComponent}>
                        <Plus className="mr-2 h-4 w-4" />
                        Adicionar
                      </Button>
                    </div>

                    {kitComponents.map((component) => {
                      const selectedComponentProduct = productsBySku.get(component.parentSku);

                      return (
                        <div key={component.id} className="grid gap-2 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_120px_40px] md:items-end">
                          <div className="space-y-2">
                            <p className="text-xs font-medium uppercase text-muted-foreground">Produto mãe</p>
                            <Select
                              value={component.parentSku}
                              onValueChange={(value) => updateKitComponent(component.id, { parentSku: value })}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione um produto" />
                              </SelectTrigger>
                              <SelectContent>
                                {products.map((product) => (
                                  <SelectItem key={product.sku} value={product.sku}>
                                    {product.sku} · {product.productType || "Produto BR Steel"}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {selectedComponentProduct ? (
                              <p className="truncate text-xs text-muted-foreground">
                                {selectedComponentProduct.material || "Material não informado"}
                              </p>
                            ) : null}
                          </div>

                          <div className="space-y-2">
                            <p className="text-xs font-medium uppercase text-muted-foreground">Qtd.</p>
                            <Input
                              type="number"
                              min={1}
                              step={1}
                              value={component.quantity}
                              onChange={(event) => updateKitComponent(component.id, { quantity: event.target.value })}
                            />
                          </div>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeKitComponent(component.id)}
                            disabled={kitComponents.length <= 1}
                            title="Remover componente"
                            aria-label="Remover componente"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-md border bg-zinc-50 p-3">
                    <p className="text-xs font-medium uppercase text-muted-foreground">Prévia</p>
                    {kitComponentPayload.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {kitComponentPayload.map((component, index) => (
                          <Badge key={`${component.parentSku}-${index}`} variant="secondary" className="font-mono">
                            {component.quantity}x {component.parentSku}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">Nenhum componente válido informado.</p>
                    )}
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setKitGroup(null)} disabled={isSavingKitComposition}>
                    Cancelar
                  </Button>
                  <Button onClick={saveKitComposition} disabled={isSavingKitComposition || !canSaveKitComposition}>
                    {isSavingKitComposition ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Boxes className="mr-2 h-4 w-4" />}
                    Salvar kit
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={!!associationProduct} onOpenChange={(open) => !open && setAssociationProduct(null)}>
          <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
            {associationProduct && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex flex-wrap items-center gap-2">
                    <Link2 className="h-5 w-5" />
                    Associar SKUs de anúncios
                  </DialogTitle>
                  <DialogDescription>
                    Produto mãe {associationProduct.sku} · {associationProduct.productType || "Produto BR Steel"}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <DetailItem label="Anúncios vinculados" value={associationDialogStat?.totalListings ?? 0} />
                    <DetailItem label="Match exato" value={associationDialogStat?.exactListings ?? 0} />
                    <DetailItem label="SKUs associados" value={associationDialogStat?.associatedSkus.length ?? 0} />
                  </div>

                  {associationError && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{associationError}</AlertDescription>
                    </Alert>
                  )}

                  {associationNotice && (
                    <Alert>
                      <CheckCircle2 className="h-4 w-4" />
                      <AlertDescription>{associationNotice}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-2">
                    <p className="text-sm font-medium">SKUs filhos associados</p>
                    <Textarea
                      value={associationText}
                      onChange={(event) => setAssociationText(event.target.value)}
                      rows={8}
                      placeholder="Cole SKUs de anúncios, separados por linha, vírgula ou ponto e vírgula."
                    />
                    <p className="text-xs text-muted-foreground">
                      O SKU do próprio produto mãe já é reconhecido automaticamente por match exato; informe aqui apenas SKUs alternativos dos anúncios.
                    </p>
                  </div>

                  <div className="rounded-md border bg-zinc-50 p-3">
                    <p className="text-xs font-medium uppercase text-muted-foreground">Prévia</p>
                    {associationDialogSkus.length > 0 ? (
                      <div className="mt-2 flex max-h-32 flex-wrap gap-2 overflow-y-auto">
                        {associationDialogSkus.map((sku) => (
                          <Badge key={sku} variant="secondary" className="font-mono">
                            {sku}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">Nenhum SKU filho informado.</p>
                    )}
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setAssociationProduct(null)} disabled={isSavingAssociations}>
                    Cancelar
                  </Button>
                  <Button onClick={saveAssociations} disabled={isSavingAssociations}>
                    {isSavingAssociations ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                    Salvar associações
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={!!selectedProduct} onOpenChange={(open) => !open && setSelectedProduct(null)}>
          <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
            {selectedProduct && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex flex-wrap items-center gap-2">
                    {selectedProduct.sku}
                    <QualityBadge status={selectedProduct.qualityStatus} score={selectedProduct.completenessScore} />
                  </DialogTitle>
                  <DialogDescription>{selectedProduct.productType || "Produto BR Steel"}</DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="geral" className="w-full">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="geral">Geral</TabsTrigger>
                    <TabsTrigger value="tecnico">Técnico</TabsTrigger>
                    <TabsTrigger value="fiscal">Fiscal</TabsTrigger>
                    <TabsTrigger value="seo">SEO</TabsTrigger>
                  </TabsList>

                  <TabsContent value="geral" className="mt-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <DetailItem label="GTIN" value={selectedProduct.gtin} />
                      <DetailItem label="Abas" value={selectedProduct.sourceSheets.join(", ")} />
                      <DetailItem label="Marca" value={selectedProduct.brand} />
                      <DetailItem label="Tipo do Produto" value={selectedProduct.productType} />
                      <DetailItem label="Condição" value={selectedProduct.condition} />
                      <DetailItem label="Cor" value={selectedProduct.color} />
                      <DetailItem label="Instalação" value={selectedProduct.installationType} />
                      <DetailItem label="Público-alvo" value={selectedProduct.targetAudience} />
                      <DetailItem label="Dor resolvida" value={selectedProduct.problemSolved} />
                    </div>
                  </TabsContent>

                  <TabsContent value="tecnico" className="mt-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <DetailItem label="Material" value={selectedProduct.material} />
                      <DetailItem label="Acabamento" value={selectedProduct.finish} />
                      <DetailItem label="Anti-corrosão" value={selectedProduct.antiCorrosion} />
                      <DetailItem label="Dimensões" value={formatDimensions(selectedProduct)} />
                      <DetailItem label="Peso líquido" value={formatNumber(selectedProduct.netWeightKg, " kg")} />
                      <DetailItem label="Peso bruto" value={formatNumber(selectedProduct.grossWeightKg, " kg")} />
                      <DetailItem label="Espessura grelha" value={formatNumber(selectedProduct.grillThicknessMm, " mm")} />
                      <DetailItem label="Espessura corpo" value={formatNumber(selectedProduct.bodyThicknessMm, " mm")} />
                      <DetailItem label="Itens por caixa" value={formatNumber(selectedProduct.itemsPerBox)} />
                    </div>
                  </TabsContent>

                  <TabsContent value="fiscal" className="mt-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <DetailItem label="NCM" value={selectedProduct.ncm} />
                      <DetailItem label="CEST" value={selectedProduct.cest} />
                      <DetailItem label="Origem (CST)" value={selectedProduct.originCst} />
                      <DetailItem label="Unidade comercial" value={selectedProduct.commercialUnit} />
                      <DetailItem label="Tipo produção" value={selectedProduct.productionType} />
                      <DetailItem label="Tipo do item" value={selectedProduct.itemType} />
                      <DetailItem label="Fabricante" value={selectedProduct.manufacturer} />
                      <DetailItem label="País de origem" value={selectedProduct.countryOfOrigin} />
                      <DetailItem label="Garantia" value={`${formatNumber(selectedProduct.warrantyMonths)} meses`} />
                      <DetailItem label="Tipo de garantia" value={selectedProduct.warrantyType} />
                    </div>
                  </TabsContent>

                  <TabsContent value="seo" className="mt-4 space-y-4">
                    <DetailItem label="Palavras-chave SEO" value={selectedProduct.seoKeywords} />
                    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2">
                      <p className="text-xs font-medium uppercase text-muted-foreground">Campos faltantes</p>
                      {selectedProduct.missingFields.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {selectedProduct.missingFields.map((field) => (
                            <Badge key={field} variant="secondary">
                              {field}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-1 text-sm font-medium text-emerald-700">Cadastro completo nos campos essenciais.</p>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
