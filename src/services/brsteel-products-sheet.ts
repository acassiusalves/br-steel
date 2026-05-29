import * as XLSX from "xlsx";

import type { BrSteelProduct, BrSteelProductsSheetResult, ProductQualityStatus } from "@/types/brsteel-product";

const DEFAULT_SHEET_ID = "1TYFa-h_NyZ4J_2orpyrQNMkQ7Z9Qg02Nuwpt1y6soyo";
type BrSteelProductBaseKey = keyof Omit<BrSteelProduct, "missingFields" | "completenessScore" | "qualityStatus" | "searchText">;

const PRODUCT_SHEETS = [
  { name: "Produtos BR Stell", gid: "661263002" },
  { name: "Industrial", gid: "2113454828" },
  { name: "Residencial", gid: "1032443821" },
  { name: "Construção e Reforma", gid: "1970363905" },
] as const;

const SHEET_ID = process.env.BRSTEEL_PRODUCTS_SHEET_ID || DEFAULT_SHEET_ID;

const getSheetCsvUrl = (gid: string) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`;

const getSpreadsheetUrl = () => `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;

const toStringValue = (value: unknown) => String(value ?? "").trim();

const parsePtNumber = (value: unknown): number | null => {
  const text = toStringValue(value);
  if (!text) return null;

  const normalized = text
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const getCell = (row: Record<string, unknown>, key: string) => toStringValue(row[key]);

const getFirstCell = (row: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = getCell(row, key);
    if (value) return value;
  }

  return "";
};

const ESSENTIAL_FIELDS: Array<{ key: BrSteelProductBaseKey; label: string }> = [
  { key: "gtin", label: "GTIN" },
  { key: "sku", label: "SKU" },
  { key: "productType", label: "Tipo do produto" },
  { key: "material", label: "Material" },
  { key: "widthCm", label: "Largura" },
  { key: "heightCm", label: "Altura" },
  { key: "depthCm", label: "Profundidade" },
  { key: "netWeightKg", label: "Peso líquido" },
  { key: "grossWeightKg", label: "Peso bruto" },
  { key: "ncm", label: "NCM" },
  { key: "cest", label: "CEST" },
  { key: "manufacturer", label: "Fabricante" },
  { key: "warrantyMonths", label: "Garantia" },
  { key: "seoKeywords", label: "SEO" },
];

const isPresent = (value: unknown) => {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  return String(value).trim().length > 0;
};

const resolveQualityStatus = (score: number): ProductQualityStatus => {
  if (score >= 90) return "complete";
  if (score >= 70) return "review";
  return "critical";
};

const buildSearchText = (product: Omit<BrSteelProduct, "missingFields" | "completenessScore" | "qualityStatus" | "searchText">) =>
  [
    ...product.sourceSheets,
    product.gtin,
    product.brand,
    product.sku,
    product.productType,
    product.color,
    product.condition,
    product.material,
    product.finish,
    product.installationType,
    product.targetAudience,
    product.problemSolved,
    product.ncm,
    product.cest,
    product.manufacturer,
    product.seoKeywords,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const applyQualityFields = (
  product: Omit<BrSteelProduct, "missingFields" | "completenessScore" | "qualityStatus" | "searchText">
): BrSteelProduct => {
  const missingFields = ESSENTIAL_FIELDS.filter(({ key }) => !isPresent(product[key])).map(({ label }) => label);
  const completenessScore = Math.round(((ESSENTIAL_FIELDS.length - missingFields.length) / ESSENTIAL_FIELDS.length) * 100);
  const qualityStatus = resolveQualityStatus(completenessScore);

  return {
    ...product,
    missingFields,
    completenessScore,
    qualityStatus,
    searchText: buildSearchText(product),
  };
};

const normalizeProductRow = (row: Record<string, unknown>, index: number, sheetName: string): BrSteelProduct | null => {
  const sku = getFirstCell(row, ["IDENTIFICAÇÃO SKU", "SKU", "Modelo", "PRODUTO Modelo"]);
  const baseProduct = {
    id: `${sku || "produto"}-${index}`,
    sourceSheets: [sheetName],
    gtin: getFirstCell(row, ["GTIN Embalagem", "GTIN/EAN"]),
    brand: getFirstCell(row, ["PRODUTO Marca", "Marca"]),
    sku,
    productType: getFirstCell(row, ["Tipo do Produto", "PRODUTO Tipo do Produto"]),
    color: getFirstCell(row, ["Cor", "PRODUTO Cor"]),
    condition: getFirstCell(row, ["Condição", "PRODUTO Condição"]),
    material: getFirstCell(row, ["MATERIAL Material", "material "]),
    grillThicknessMm: parsePtNumber(row["Espessura Grelha (mm)"]),
    bodyThicknessMm: parsePtNumber(row["Espessura Corpo (mm)"]),
    finish: getCell(row, "Acabamento"),
    widthCm: parsePtNumber(row["DIMENSÕES Largura (cm)"]),
    heightCm: parsePtNumber(row["Altura (cm)"]),
    depthCm: parsePtNumber(row["Profundidade (cm)"]),
    netWeightKg: parsePtNumber(row["Peso Líquido (kg)"]),
    grossWeightKg: parsePtNumber(row["Peso Bruto (kg)"]),
    itemsPerBox: parsePtNumber(row["EMBALAGEM Itens p/ Caixa"]),
    format: getFirstCell(row, ["TÉCNICA Formato", "Formato"]),
    installationType: getFirstCell(row, ["Tipo de Instalação", "TÉCNICA Tipo de Instalação"]),
    targetAudience: getFirstCell(row, ["Público-Alvo", "TÉCNICA Público-Alvo", "EMBALAGEM Público-Alvo"]),
    problemSolved: getFirstCell(row, ["Dor / Problema Resolvido", "TÉCNICA Dor / Problema Resolvido", "EMBALAGEM Dor / Problema Resolvido"]),
    antiCorrosion: getFirstCell(row, ["Anti-Corrosão", "TÉCNICA Anti-Corrosão"]),
    ncm: getFirstCell(row, ["FISCAL NCM", "NCM"]),
    cest: getFirstCell(row, ["CEST", "FISCAL CEST"]),
    originCst: getCell(row, "Origem (CST)"),
    commercialUnit: getCell(row, "Unidade Comercial"),
    productionType: getCell(row, "Tipo Produção"),
    itemType: getCell(row, "Tipo do Item"),
    manufacturer: getCell(row, "COMERCIAL Fabricante"),
    countryOfOrigin: getCell(row, "País de Origem"),
    warrantyMonths: parsePtNumber(row["Garantia (meses)"]),
    warrantyType: getCell(row, "Tipo de Garantia"),
    seoKeywords: getCell(row, "ANÚNCIO Palavras-Chave SEO"),
  };

  if (!baseProduct.sku && !baseProduct.gtin && !baseProduct.productType) {
    return null;
  }

  return applyQualityFields(baseProduct);
};

const mergeProducts = (existing: BrSteelProduct, incoming: BrSteelProduct): BrSteelProduct => {
  const sourceSheets = Array.from(new Set([...existing.sourceSheets, ...incoming.sourceSheets]));
  const mergedBase = {
    ...existing,
    ...Object.fromEntries(
      Object.entries(incoming).filter(([key, value]) => {
        if (["id", "sourceSheets", "missingFields", "completenessScore", "qualityStatus", "searchText"].includes(key)) {
          return false;
        }

        return isPresent(value) && !isPresent(existing[key as keyof BrSteelProduct]);
      })
    ),
    sourceSheets,
  } as Omit<BrSteelProduct, "missingFields" | "completenessScore" | "qualityStatus" | "searchText">;

  return applyQualityFields(mergedBase);
};

export async function fetchBrSteelProductsSheet(): Promise<BrSteelProductsSheetResult> {
  const sheetResults = await Promise.all(
    PRODUCT_SHEETS.map(async (sheet) => {
      const response = await fetch(getSheetCsvUrl(sheet.gid), {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Não foi possível carregar a aba ${sheet.name} (${response.status}).`);
      }

      const csvText = await response.text();
      if (csvText.trim().startsWith("<")) {
        throw new Error(`A aba ${sheet.name} retornou HTML em vez de CSV. Verifique se a planilha está acessível.`);
      }

      const workbook = XLSX.read(csvText, { type: "string" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
        defval: "",
        raw: false,
      });
      const products = rows
        .map((row, index) => normalizeProductRow(row, index, sheet.name))
        .filter((product): product is BrSteelProduct => product !== null);

      return { ...sheet, rows: rows.length, products };
    })
  );

  const productMap = new Map<string, BrSteelProduct>();

  for (const sheet of sheetResults) {
    for (const product of sheet.products) {
      const key = product.sku || product.gtin || product.id;
      const existing = productMap.get(key);

      productMap.set(key, existing ? mergeProducts(existing, product) : product);
    }
  }

  const products = Array.from(productMap.values());

  return {
    products,
    sourceUrl: getSpreadsheetUrl(),
    sheetName: PRODUCT_SHEETS.map((sheet) => sheet.name).join(", "),
    sourceSheets: sheetResults.map((sheet) => ({
      name: sheet.name,
      gid: sheet.gid,
      rows: sheet.rows,
      products: sheet.products.length,
    })),
    fetchedAt: new Date().toISOString(),
    totalRows: sheetResults.reduce((sum, sheet) => sum + sheet.rows, 0),
  };
}
