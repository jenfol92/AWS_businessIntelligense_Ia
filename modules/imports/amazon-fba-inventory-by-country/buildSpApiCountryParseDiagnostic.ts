/**
 * Modulo      : imports / amazon-fba-inventory-by-country
 * Archivo     : buildSpApiCountryParseDiagnostic.ts
 * Responsabilidad: resumen en memoria del informe FBA Country descargado via SP-API.
 * No debe     : escribir en Supabase, inventario ni snapshots.
 */

import { extractTwinlySkuFromSellerSku } from "@/modules/imports/shared/twinlySku";
import { parseAmazonFbaCountryInventoryFromText } from "./parser";
import { loadProductIdsBySku } from "./repository";
import type { FbaCountryParseResult, ParsedFbaCountryRow } from "./types";

const ROWS_PREVIEW_LIMIT = 10;
const SAMPLE_LIMIT = 10;
const IMPORT_PREVIEW_LIMIT = 10;

const REQUIRED_HEADERS = [
  "seller-sku",
  "fulfillment-channel-sku",
  "asin",
  "condition-type",
  "country",
  "quantity-for-local-fulfillment",
] as const;

type StructuredFbaCountryRow = {
  sellerSku: string;
  fulfillmentChannelSku: string;
  asin: string;
  conditionType: string;
  country: string;
  quantityForLocalFulfillment: number;
};

type NonTwinlySample = StructuredFbaCountryRow & {
  reason: "seller-sku no contiene patron Twinly 843661661dddd";
};

type ExtractedTwinlySkuSample = {
  sellerSku: string;
  extractedTwinlySku: string;
  country: string;
  quantityForLocalFulfillment: number;
};

type GroupedImportPreviewRow = {
  cleanTwinlySku: string;
  country: string;
  quantity: number;
  sourceRowCount: number;
  sellerSku: string;
  asin: string;
  fulfillmentChannelSku: string;
  productMatched: boolean;
  productoId: string | null;
};

export type SpApiFbaCountryImportPreview = {
  twinlyRowCount: number;
  nonTwinlyRowCount: number;
  groupedRowCount: number;
  matchedGroupedRows: number;
  unmatchedGroupedRows: number;
  totalQuantity: number;
  countries: Array<{
    country: string;
    groupedRowCount: number;
    totalQuantity: number;
    matchedGroupedRows: number;
    unmatchedGroupedRows: number;
  }>;
  rowsPreview: GroupedImportPreviewRow[];
  unmatchedPreview: GroupedImportPreviewRow[];
  supabaseReadOnly: {
    description: string;
    table: "productos";
    operation: "SELECT id, sku FROM productos WHERE sku IN (...skusLimpios)";
    matchRule: "productos.sku = skuLimpio extraido con /843661661\\d{4}/";
    writes: false;
  };
};

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function splitLine(line: string, delimiter: string): string[] {
  return line.split(delimiter).map((value) => value.trim());
}

function detectDelimiter(headerLine: string): string {
  return headerLine.includes("\t") ? "\t" : ",";
}

function toRowObject(headers: string[], values: string[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    row[headers[i]] = values[i] ?? "";
  }
  return row;
}

function parseQuantity(value: string): number | null {
  const n = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return n;
}

function buildStructuredPreview(content: string) {
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/);
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const delimiter = detectDelimiter(nonEmptyLines[0] ?? "");
  const headers = splitLine(nonEmptyLines[0] ?? "", delimiter).map(normalizeHeader);
  const headerSet = new Set(headers);

  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headerSet.has(header));
  if (missingHeaders.length > 0) {
    warnings.push(`Cabeceras faltantes: ${missingHeaders.join(", ")}`);
  }

  const rows: StructuredFbaCountryRow[] = [];
  const countries = new Map<string, { rowCount: number; totalQuantity: number }>();

  for (let i = 1; i < nonEmptyLines.length; i++) {
    const rowNumber = i + 1;
    const values = splitLine(nonEmptyLines[i], delimiter);
    if (values.length < headers.length) {
      warnings.push(`Fila ${rowNumber}: columnas incompletas.`);
    }

    const row = toRowObject(headers, values);
    const sellerSku = row["seller-sku"] ?? "";
    const fulfillmentChannelSku = row["fulfillment-channel-sku"] ?? "";
    const asin = row.asin ?? "";
    const conditionType = row["condition-type"] ?? "";
    const country = row.country ?? "";
    const quantityRaw = row["quantity-for-local-fulfillment"] ?? "";
    const quantity = parseQuantity(quantityRaw);

    if (!sellerSku) {
      warnings.push(`Fila ${rowNumber}: seller-sku vacio.`);
      continue;
    }

    if (!country) {
      warnings.push(`Fila ${rowNumber}: country vacio.`);
      continue;
    }

    if (quantity == null) {
      warnings.push(`Fila ${rowNumber}: quantity-for-local-fulfillment no numerica.`);
      continue;
    }

    if (quantity < 0) {
      warnings.push(`Fila ${rowNumber}: cantidad negativa.`);
      continue;
    }

    const structuredRow = {
      sellerSku,
      fulfillmentChannelSku,
      asin,
      conditionType,
      country,
      quantityForLocalFulfillment: quantity,
    };

    rows.push(structuredRow);

    const countryTotals = countries.get(country) ?? { rowCount: 0, totalQuantity: 0 };
    countryTotals.rowCount++;
    countryTotals.totalQuantity += quantity;
    countries.set(country, countryTotals);
  }

  return {
    headers,
    rows,
    rowsPreview: rows.slice(0, ROWS_PREVIEW_LIMIT),
    totals: {
      rowCount: rows.length,
      totalQuantity: rows.reduce((sum, row) => sum + row.quantityForLocalFulfillment, 0),
      countries: Array.from(countries.entries())
        .map(([country, totals]) => ({
          country,
          rowCount: totals.rowCount,
          totalQuantity: totals.totalQuantity,
        }))
        .sort((a, b) => b.totalQuantity - a.totalQuantity || a.country.localeCompare(b.country)),
    },
    warnings: warnings.slice(0, 200),
  };
}

function normalizeRawHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}

function getRawValue(raw: Record<string, unknown>, possibleNames: string[]): string {
  const normalizedMap = new Map<string, string>();
  for (const key of Object.keys(raw)) {
    normalizedMap.set(normalizeRawHeader(key), key);
  }
  for (const name of possibleNames) {
    const realKey = normalizedMap.get(normalizeRawHeader(name));
    if (realKey) return String(raw[realKey] ?? "").trim();
  }
  return "";
}

function extractReportFieldsFromRaw(raw: Record<string, unknown>) {
  return {
    sellerSku: getRawValue(raw, [
      "seller-sku",
      "seller sku",
      "sku",
      "msku",
      "merchant sku",
    ]),
    asin: getRawValue(raw, ["asin"]),
    fulfillmentChannelSku: getRawValue(raw, [
      "fulfillment-channel-sku",
      "fulfillment channel sku",
      "fnsku",
    ]),
  };
}

function groupValidRowsByTwinlySkuAndCountry(rows: ParsedFbaCountryRow[]) {
  const map = new Map<
    string,
    Omit<GroupedImportPreviewRow, "productMatched" | "productoId">
  >();

  for (const row of rows) {
    const key = `${row.skuLimpio}|${row.pais}`;
    const reportFields = extractReportFieldsFromRaw(row.raw);
    const sellerSku = row.skuOriginal || reportFields.sellerSku;
    const existing = map.get(key);

    if (existing) {
      existing.quantity += row.stockFba;
      existing.sourceRowCount++;
      continue;
    }

    map.set(key, {
      cleanTwinlySku: row.skuLimpio,
      country: row.pais,
      quantity: row.stockFba,
      sourceRowCount: 1,
      sellerSku,
      asin: reportFields.asin,
      fulfillmentChannelSku: reportFields.fulfillmentChannelSku,
    });
  }

  return Array.from(map.values());
}

function sortGroupedPreviewRows(rows: GroupedImportPreviewRow[]) {
  return [...rows].sort(
    (a, b) =>
      b.quantity - a.quantity ||
      a.cleanTwinlySku.localeCompare(b.cleanTwinlySku) ||
      a.country.localeCompare(b.country),
  );
}

/**
 * Preview de importacion Twinly agrupado por skuLimpio + pais.
 * Fuente: parsed.validRows del parser Twinly (no structuredRows).
 * Match producto: SELECT de solo lectura en productos.sku.
 */
async function buildImportPreview(
  parsed: FbaCountryParseResult,
): Promise<SpApiFbaCountryImportPreview> {
  const groupedBase = groupValidRowsByTwinlySkuAndCountry(parsed.validRows);
  const skusLimpios = Array.from(new Set(parsed.validRows.map((row) => row.skuLimpio)));

  // Supabase admin: SELECT id, sku FROM productos WHERE sku IN (...). Sin writes.
  const productoBySku = await loadProductIdsBySku(skusLimpios);

  const groupedRows: GroupedImportPreviewRow[] = groupedBase.map((row) => {
    const productoId = productoBySku.get(row.cleanTwinlySku) ?? null;
    return {
      ...row,
      productMatched: productoId != null,
      productoId,
    };
  });

  const matchedGroupedRows = groupedRows.filter((row) => row.productMatched).length;
  const unmatchedGroupedRows = groupedRows.length - matchedGroupedRows;
  const totalQuantity = groupedRows.reduce((sum, row) => sum + row.quantity, 0);

  const countriesMap = new Map<
    string,
    {
      groupedRowCount: number;
      totalQuantity: number;
      matchedGroupedRows: number;
      unmatchedGroupedRows: number;
    }
  >();

  for (const row of groupedRows) {
    const entry = countriesMap.get(row.country) ?? {
      groupedRowCount: 0,
      totalQuantity: 0,
      matchedGroupedRows: 0,
      unmatchedGroupedRows: 0,
    };
    entry.groupedRowCount++;
    entry.totalQuantity += row.quantity;
    if (row.productMatched) entry.matchedGroupedRows++;
    else entry.unmatchedGroupedRows++;
    countriesMap.set(row.country, entry);
  }

  const sortedGroupedRows = sortGroupedPreviewRows(groupedRows);
  const unmatchedRows = sortGroupedPreviewRows(
    groupedRows.filter((row) => !row.productMatched),
  );

  return {
    twinlyRowCount: parsed.twinlyRows,
    nonTwinlyRowCount: parsed.skippedNonTwinlyRows,
    groupedRowCount: groupedRows.length,
    matchedGroupedRows,
    unmatchedGroupedRows,
    totalQuantity,
    countries: Array.from(countriesMap.entries())
      .map(([country, totals]) => ({ country, ...totals }))
      .sort(
        (a, b) =>
          b.totalQuantity - a.totalQuantity || a.country.localeCompare(b.country),
      ),
    rowsPreview: sortedGroupedRows.slice(0, IMPORT_PREVIEW_LIMIT),
    unmatchedPreview: unmatchedRows.slice(0, IMPORT_PREVIEW_LIMIT),
    supabaseReadOnly: {
      description:
        "Consulta Supabase de solo lectura para enlazar skuLimpio con productos.sku.",
      table: "productos",
      operation: "SELECT id, sku FROM productos WHERE sku IN (...skusLimpios)",
      matchRule: "productos.sku = skuLimpio extraido con /843661661\\d{4}/",
      writes: false,
    },
  };
}

function buildParserGap(structuredRows: StructuredFbaCountryRow[]) {
  const extractedTwinlySkuSamples: ExtractedTwinlySkuSample[] = [];
  const nonTwinlySamples: NonTwinlySample[] = [];
  let twinlyMatchedRowCount = 0;

  for (const row of structuredRows) {
    const extractedTwinlySku = extractTwinlySkuFromSellerSku(row.sellerSku);

    if (extractedTwinlySku) {
      twinlyMatchedRowCount++;
      if (extractedTwinlySkuSamples.length < SAMPLE_LIMIT) {
        extractedTwinlySkuSamples.push({
          sellerSku: row.sellerSku,
          extractedTwinlySku,
          country: row.country,
          quantityForLocalFulfillment: row.quantityForLocalFulfillment,
        });
      }
      continue;
    }

    if (nonTwinlySamples.length < SAMPLE_LIMIT) {
      nonTwinlySamples.push({
        ...row,
        reason: "seller-sku no contiene patron Twinly 843661661dddd",
      });
    }
  }

  return {
    structuredRowCount: structuredRows.length,
    twinlyMatchedRowCount,
    nonTwinlyRowCount: structuredRows.length - twinlyMatchedRowCount,
    extractedTwinlySkuSamples,
    nonTwinlySamples,
  };
}

export type SpApiFbaCountryParseDiagnostic = {
  ok: true;
  stage: "parsed_preview";
  marketplace: string;
  reportId: string;
  processingStatus: string;
  reportDocumentId?: string;
  bytesLength: number;
  lineCount: number;
  headers: string[];
  rowsPreview: StructuredFbaCountryRow[];
  totals: {
    rowCount: number;
    totalQuantity: number;
    countries: Array<{
      country: string;
      rowCount: number;
      totalQuantity: number;
    }>;
  };
  warnings: string[];
  legacyParserSummary: {
    parsedRows: number;
    countries: Array<{
      country: string;
      rows: number;
      units: number;
    }>;
  };
  parserGap: {
    structuredRowCount: number;
    twinlyMatchedRowCount: number;
    nonTwinlyRowCount: number;
    extractedTwinlySkuSamples: ExtractedTwinlySkuSample[];
    nonTwinlySamples: NonTwinlySample[];
  };
  importPreview: SpApiFbaCountryImportPreview;
};

/**
 * Parsea un informe FBA Country en memoria y devuelve un resumen seguro para diagnostico SP-API.
 */
export async function buildSpApiFbaCountryParseDiagnostic(params: {
  content: string;
  marketplace: string;
  reportId: string;
  processingStatus: string;
  reportDocumentId?: string;
}): Promise<SpApiFbaCountryParseDiagnostic> {
  const { content, marketplace, reportId, processingStatus, reportDocumentId } = params;
  const bytesLength = Buffer.byteLength(content, "utf8");
  const lineCount = content.split(/\r?\n/).length;
  const structuredPreview = buildStructuredPreview(content);

  const parsed = parseAmazonFbaCountryInventoryFromText(content, marketplace);
  const importPreview = await buildImportPreview(parsed);
  const legacyCountries = new Map<string, { rows: number; units: number }>();
  for (const row of parsed.validRows) {
    const entry = legacyCountries.get(row.pais) ?? { rows: 0, units: 0 };
    entry.rows++;
    entry.units += row.stockFba;
    legacyCountries.set(row.pais, entry);
  }

  return {
    ok: true,
    stage: "parsed_preview",
    marketplace,
    reportId,
    processingStatus,
    ...(reportDocumentId ? { reportDocumentId } : {}),
    bytesLength,
    lineCount,
    headers: structuredPreview.headers,
    rowsPreview: structuredPreview.rowsPreview,
    totals: structuredPreview.totals,
    warnings: [
      ...structuredPreview.warnings,
      ...parsed.warnings.slice(0, 20).map((w) => `Parser legado fila ${w.row}: ${w.message}`),
    ],
    legacyParserSummary: {
      parsedRows: parsed.validRows.length,
      countries: Array.from(legacyCountries.entries())
        .map(([country, entry]) => ({
          country,
          rows: entry.rows,
          units: entry.units,
        }))
        .sort((a, b) => b.units - a.units || a.country.localeCompare(b.country)),
    },
    parserGap: buildParserGap(structuredPreview.rows),
    importPreview,
  };
}
