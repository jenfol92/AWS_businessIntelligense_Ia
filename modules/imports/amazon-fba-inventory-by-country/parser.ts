import Papa from "papaparse";
import { extractTwinlySkuFromSellerSku } from "@/modules/imports/shared/twinlySku";
import { validateAfnInventoryByCountryFile } from "./detectReportType";
import { resolveCountryFromValue } from "./mappers";
import type {
  FbaCountryParseResult,
  FbaCountryParseWarning,
  FbaCountryPreviewSampleRow,
  FbaCountryRowsByKey,
  FbaCountryUnlinkedSku,
  ParsedFbaCountryRow,
} from "./types";

type RawRow = Record<string, unknown>;

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}

function getValue(row: RawRow, possibleNames: string[]): string {
  const normalizedMap = new Map<string, string>();
  for (const key of Object.keys(row)) {
    normalizedMap.set(normalizeHeader(key), key);
  }
  for (const name of possibleNames) {
    const realKey = normalizedMap.get(normalizeHeader(name));
    if (realKey) return cleanText(row[realKey]);
  }
  return "";
}

function parseInteger(value: unknown): number {
  const raw = cleanText(value);
  if (!raw) return 0;
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function rowToRecord(row: RawRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value;
  }
  return out;
}

/** GET_AFN_INVENTORY_DATA_BY_COUNTRY — variantes SKU. */
const SKU_COLUMNS = [
  "sku",
  "seller sku",
  "seller-sku",
  "msku",
  "merchant sku",
  "merchant-sku",
  "fnsku",
];

/** Solo columnas de país del informe BY_COUNTRY (no Location de Ledger). */
const COUNTRY_COLUMNS = [
  "country",
  "country code",
  "country-code",
  "marketplace country",
  "marketplace-country",
];

/**
 * Stock vendible BY_COUNTRY únicamente.
 * No usar reserved, unsellable, inbound, working, ending warehouse balance, etc.
 */
const STOCK_COLUMNS = [
  "quantity available",
  "quantity-available",
  "quantity-for-local-fulfillment",
  "quantity for local fulfillment",
  "available",
  "fulfillable quantity",
  "fulfillable-quantity",
  "afn fulfillable quantity",
  "afn-fulfillable-quantity",
  "sellable",
];

function hasStockColumnPresent(row: RawRow): boolean {
  return STOCK_COLUMNS.some((col) => getValue(row, [col]) !== "");
}

export async function parseAmazonFbaCountryInventoryFile(
  file: File,
  defaultPais?: string | null,
): Promise<FbaCountryParseResult> {
  const text = await file.text();
  return parseAmazonFbaCountryInventoryFromText(text, defaultPais);
}

export function parseAmazonFbaCountryInventoryFromText(
  text: string,
  defaultPais?: string | null,
): FbaCountryParseResult {
  const { delimiter } = validateAfnInventoryByCountryFile(text, defaultPais);
  const snapshotDate = new Date().toISOString().slice(0, 10);

  const parsed = Papa.parse<RawRow>(text, {
    header: true,
    skipEmptyLines: "greedy",
    delimiter,
  });

  const warnings: FbaCountryParseWarning[] = [];
  const validRows: ParsedFbaCountryRow[] = [];

  let totalRows = 0;
  let twinlyRows = 0;
  let skippedNonTwinlyRows = 0;
  let skippedRows = 0;
  let skippedNoCountryRows = 0;
  let skippedNoStockRows = 0;

  for (let i = 0; i < (parsed.data ?? []).length; i++) {
    const row = parsed.data[i];
    const rowNumber = i + 2;

    if (!row || Object.keys(row).length === 0) continue;
    const hasContent = Object.values(row).some((v) => cleanText(v) !== "");
    if (!hasContent) continue;

    totalRows++;

    const skuOriginal = getValue(row, SKU_COLUMNS);
    if (!skuOriginal) {
      skippedRows++;
      continue;
    }

    const skuLimpio = extractTwinlySkuFromSellerSku(skuOriginal);
    if (!skuLimpio) {
      skippedNonTwinlyRows++;
      continue;
    }

    twinlyRows++;

    const countryRaw = getValue(row, COUNTRY_COLUMNS);
    const pais = resolveCountryFromValue(countryRaw, defaultPais);
    if (!pais) {
      skippedNoCountryRows++;
      warnings.push({
        row: rowNumber,
        message:
          "No se pudo resolver país (columna country/marketplace-country o ?pais=ES).",
      });
      continue;
    }

    if (!hasStockColumnPresent(row)) {
      skippedNoStockRows++;
      continue;
    }

    let stockFba = 0;
    for (const col of STOCK_COLUMNS) {
      const val = getValue(row, [col]);
      if (val !== "") {
        stockFba = parseInteger(val);
        break;
      }
    }

    if (stockFba < 0) stockFba = 0;

    validRows.push({
      rowNumber,
      skuOriginal,
      skuLimpio,
      pais,
      stockFba,
      snapshotDate,
      raw: rowToRecord(row),
    });
  }

  return {
    totalRows,
    twinlyRows,
    skippedNonTwinlyRows,
    skippedRows,
    skippedNoCountryRows,
    skippedNoStockRows,
    validRows,
    warnings: warnings.slice(0, 200),
  };
}

export function summarizeFbaCountryRows(rows: ParsedFbaCountryRow[]) {
  const skuSet = new Set<string>();
  let dateMin: string | null = null;
  let dateMax: string | null = null;

  for (const row of rows) {
    skuSet.add(row.skuLimpio);
    if (!dateMin || row.snapshotDate < dateMin) dateMin = row.snapshotDate;
    if (!dateMax || row.snapshotDate > dateMax) dateMax = row.snapshotDate;
  }

  return {
    uniqueSkus: skuSet.size,
    dateRange: { from: dateMin, to: dateMax },
  };
}

export function summarizeRowsByCountry(
  rows: ParsedFbaCountryRow[],
): FbaCountryRowsByKey[] {
  const map = new Map<string, { rows: number; stockFba: number }>();
  for (const row of rows) {
    const entry = map.get(row.pais) ?? { rows: 0, stockFba: 0 };
    entry.rows++;
    entry.stockFba += row.stockFba;
    map.set(row.pais, entry);
  }
  return Array.from(map.entries())
    .map(([key, v]) => ({ key, rows: v.rows, stockFba: v.stockFba }))
    .sort((a, b) => b.stockFba - a.stockFba);
}

export function summarizeUnlinkedSkus(
  rows: ParsedFbaCountryRow[],
  productoBySku: Map<string, string>,
) {
  const counts = new Map<string, number>();
  let skippedUnlinkedRows = 0;

  for (const row of rows) {
    if (productoBySku.get(row.skuLimpio)) continue;
    skippedUnlinkedRows++;
    counts.set(row.skuLimpio, (counts.get(row.skuLimpio) ?? 0) + 1);
  }

  const unlinkedSkus = Array.from(counts.entries())
    .map(([skuLimpio, rowCount]) => ({ skuLimpio, rows: rowCount }))
    .sort((a, b) => b.rows - a.rows) satisfies FbaCountryUnlinkedSku[];

  return { skippedUnlinkedRows, unlinkedSkus };
}

export function toPreviewSampleRows(
  rows: ParsedFbaCountryRow[],
  productoBySku: Map<string, string>,
  limit = 20,
): FbaCountryPreviewSampleRow[] {
  return rows.slice(0, limit).map((row) => ({
    snapshotDate: row.snapshotDate,
    skuOriginal: row.skuOriginal,
    skuLimpio: row.skuLimpio,
    pais: row.pais,
    stockFba: row.stockFba,
    productLinked: Boolean(productoBySku.get(row.skuLimpio)),
  }));
}
