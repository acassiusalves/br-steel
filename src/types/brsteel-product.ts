export type ProductQualityStatus = "complete" | "review" | "critical";

export interface BrSteelProduct {
  id: string;
  sourceSheets: string[];
  gtin: string;
  brand: string;
  sku: string;
  productType: string;
  color: string;
  condition: string;
  material: string;
  grillThicknessMm: number | null;
  bodyThicknessMm: number | null;
  finish: string;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  netWeightKg: number | null;
  grossWeightKg: number | null;
  itemsPerBox: number | null;
  format: string;
  installationType: string;
  targetAudience: string;
  problemSolved: string;
  antiCorrosion: string;
  ncm: string;
  cest: string;
  originCst: string;
  commercialUnit: string;
  productionType: string;
  itemType: string;
  manufacturer: string;
  countryOfOrigin: string;
  warrantyMonths: number | null;
  warrantyType: string;
  seoKeywords: string;
  missingFields: string[];
  completenessScore: number;
  qualityStatus: ProductQualityStatus;
  searchText: string;
}

export interface BrSteelProductsSheetResult {
  products: BrSteelProduct[];
  sourceUrl: string;
  sheetName: string;
  sourceSheets: Array<{
    name: string;
    gid: string;
    rows: number;
    products: number;
  }>;
  fetchedAt: string;
  totalRows: number;
}
