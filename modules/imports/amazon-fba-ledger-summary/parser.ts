import type Papa from "papaparse";
import { parseStrictLedgerText, strictLedgerInteger, LEDGER_MAX_BYTES, LedgerEvidenceError } from "./strictLedgerDocument.ts";
import { extractTwinlySkuFromMsku } from "../shared/twinlySku.ts";
import type {
  AmazonFbaLedgerParseResult,
  AmazonFbaLedgerParseWarning,
  AmazonFbaLedgerPreviewSampleRow,
  ParsedAmazonFbaLedgerRow,
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

const parseInteger = strictLedgerInteger;

function parseLedgerText(text: string): Promise<Papa.ParseResult<RawRow>> {
  return Promise.resolve(parseStrictLedgerText(text));
}

function splitMskuAliases(value: string): string[] {
  const raw = cleanText(value);
  if (!raw) return [];

  return Array.from(
    new Set(
      raw
        .split(/\r?\n|[;,|]+|\s+\/\s+|\s{2,}/g)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  );
}

function resolveCleanSkuFromAliases(aliases: string[]): {
  skuLimpio: string | null;
  conflictingSkus: string[];
} {
  const skuSet = new Set<string>();
  for (const alias of aliases) {
    const sku = extractTwinlySkuFromMsku(alias);
    if (sku) skuSet.add(sku);
  }
  const skus = Array.from(skuSet);
  return {
    skuLimpio: skus[0] ?? null,
    conflictingSkus: skus.length > 1 ? skus : [],
  };
}

/**
 * Fecha del informe Amazon: MM/DD/YYYY → YYYY-MM-DD
 */
function parseLedgerDate(value: string): string | null {
  const raw = cleanText(value);
  if (!raw) return null;

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const month = slash[1].padStart(2, "0");
    const day = slash[2].padStart(2, "0");
    const year = slash[3];
    return `${year}-${month}-${day}`;
  }

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;

  return null;
}

function rowToRecord(row: RawRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value;
  }
  return out;
}

export async function parseAmazonFbaLedgerSummaryCsv(
  file: File,
): Promise<AmazonFbaLedgerParseResult> {
  if (file.size > LEDGER_MAX_BYTES) throw new LedgerEvidenceError("LEDGER_DOCUMENT_TOO_LARGE");
  const text = await file.text();
  return parseAmazonFbaLedgerSummaryText(text);
}

export async function parseAmazonFbaLedgerSummaryText(
  text: string,
): Promise<AmazonFbaLedgerParseResult> {
  const parsed = await parseLedgerText(text);
  const warnings: AmazonFbaLedgerParseWarning[] = [];
  const validRows: ParsedAmazonFbaLedgerRow[] = [];

  let totalRows = 0;
  let twinlyRows = 0;
  let skippedNonTwinlyRows = 0;
  let skippedRows = 0;

  const dataRows = parsed.data ?? [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNumber = i + 2;

    if (!row || Object.keys(row).length === 0) continue;

    const hasContent = Object.values(row).some((v) => cleanText(v) !== "");
    if (!hasContent) continue;

    totalRows++;

    const msku = getValue(row, ["MSKU", "Seller SKU", "SKU"]);
    const asin = getValue(row, ["ASIN"]);
    const mskuAliases = splitMskuAliases(msku);
    if (!msku) {
      skippedRows++;
      continue;
    }

    const resolvedSku = resolveCleanSkuFromAliases(mskuAliases.length > 0 ? mskuAliases : [msku]);
    if (!resolvedSku.skuLimpio && !asin) {
      skippedNonTwinlyRows++;
      continue;
    }

    if (resolvedSku.skuLimpio) twinlyRows++;

    const skuLimpio = resolvedSku.skuLimpio ?? asin;
    if (!skuLimpio) {
      skippedRows++;
      warnings.push({
        row: rowNumber,
        message: "Fila Ledger sin SKU Twinly ni ASIN utilizable.",
      });
      continue;
    }

    if (resolvedSku.conflictingSkus.length > 0) {
      skippedRows++;
      warnings.push({
        row: rowNumber,
        message: `MSKU contiene aliases de varios productos (${resolvedSku.conflictingSkus.join(", ")}). No se duplica la fila.`,
      });
      continue;
    }

    const dateRaw = getValue(row, ["Date", "Fecha"]);
    if (!dateRaw) {
      skippedRows++;
      warnings.push({
        row: rowNumber,
        message: "Falta columna Date.",
      });
      continue;
    }

    const snapshotDate = parseLedgerDate(dateRaw);
    if (!snapshotDate) {
      skippedRows++;
      warnings.push({
        row: rowNumber,
        message: `Fecha no válida: "${dateRaw}" (esperado MM/DD/YYYY).`,
      });
      continue;
    }

    const fnsku = getValue(row, ["FNSKU"]) || null;
    const disposition = getValue(row, ["Disposition"]);
    const location = getValue(row, ["Location"]);

    validRows.push({
      rowNumber,
      snapshotDate,
      skuOriginal: msku,
      mskuAliases: mskuAliases.length > 0 ? mskuAliases : [msku],
      skuLimpio,
      fnsku,
      asin,
      conditionType:
        getValue(row, ["Condition Type", "Condition", "condition-type"]) || null,
      title: getValue(row, ["Title"]) || null,
      disposition,
      startingWarehouseBalance: parseInteger(
        getValue(row, ["Starting Warehouse Balance"]),
      ),
      inTransitBetweenWarehouses: parseInteger(
        getValue(row, ["In Transit Between Warehouses"]),
      ),
      receipts: parseInteger(getValue(row, ["Receipts"])),
      customerShipments: parseInteger(getValue(row, ["Customer Shipments"])),
      customerReturns: parseInteger(getValue(row, ["Customer Returns"])),
      vendorReturns: parseInteger(getValue(row, ["Vendor Returns"])),
      warehouseTransferInOut: parseInteger(
        getValue(row, ["Warehouse Transfer In/Out", "Warehouse Transfer In Out"]),
      ),
      found: parseInteger(getValue(row, ["Found"])),
      lost: parseInteger(getValue(row, ["Lost"])),
      damaged: parseInteger(getValue(row, ["Damaged"])),
      disposed: parseInteger(getValue(row, ["Disposed"])),
      otherEvents: parseInteger(getValue(row, ["Other Events"])),
      endingWarehouseBalance: parseInteger(
        getValue(row, ["Ending Warehouse Balance"]),
      ),
      unknownEvents: parseInteger(getValue(row, ["Unknown Events"])),
      location,
      raw: rowToRecord(row),
    });
  }

  return {
    totalRows,
    twinlyRows,
    skippedNonTwinlyRows,
    validRows,
    skippedRows,
    warnings: warnings.slice(0, 200),
  };
}

export function summarizeLedgerRows(rows: ParsedAmazonFbaLedgerRow[]) {
  const skuSet = new Set<string>();
  const dispositionSet = new Set<string>();
  const locationSet = new Set<string>();
  let dateMin: string | null = null;
  let dateMax: string | null = null;

  for (const row of rows) {
    skuSet.add(row.skuLimpio);
    if (row.disposition) dispositionSet.add(row.disposition);
    if (row.location) locationSet.add(row.location);

    if (!dateMin || row.snapshotDate < dateMin) dateMin = row.snapshotDate;
    if (!dateMax || row.snapshotDate > dateMax) dateMax = row.snapshotDate;
  }

  return {
    uniqueSkus: skuSet.size,
    dispositions: Array.from(dispositionSet).sort(),
    locations: Array.from(locationSet).sort(),
    dateRange: { from: dateMin, to: dateMax },
  };
}

function toPreviewSampleRow(
  row: ParsedAmazonFbaLedgerRow,
): AmazonFbaLedgerPreviewSampleRow {
  return {
    snapshotDate: row.snapshotDate,
    skuOriginal: row.skuOriginal,
    mskuAliases: row.mskuAliases,
    skuLimpio: row.skuLimpio,
    fnsku: row.fnsku,
    asin: row.asin || null,
    conditionType: row.conditionType,
    title: row.title,
    disposition: row.disposition || null,
    endingWarehouseBalance: row.endingWarehouseBalance,
    receipts: row.receipts,
    customerShipments: row.customerShipments,
    location: row.location || null,
  };
}

function rowSampleKey(row: ParsedAmazonFbaLedgerRow): string {
  return `${row.snapshotDate}|${row.fnsku ?? row.skuOriginal}|${row.asin}|${row.disposition}|${row.location}`;
}

export function summarizeRowsByMonth(rows: ParsedAmazonFbaLedgerRow[]) {
  const byMonth = new Map<string, { rows: number; skus: Set<string> }>();

  for (const row of rows) {
    const month = row.snapshotDate.slice(0, 7);
    const entry = byMonth.get(month) ?? { rows: 0, skus: new Set<string>() };
    entry.rows++;
    entry.skus.add(row.skuLimpio);
    byMonth.set(month, entry);
  }

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { rows: rowCount, skus }]) => ({
      month,
      rows: rowCount,
      uniqueSkus: skus.size,
    }));
}

export function summarizeUnlinkedSkus(
  rows: ParsedAmazonFbaLedgerRow[],
  productoBySku: Map<string, string>,
) {
  const counts = new Map<string, number>();
  let unlinkedProductRows = 0;

  for (const row of rows) {
    if (productoBySku.get(row.skuLimpio)) continue;
    unlinkedProductRows++;
    counts.set(row.skuLimpio, (counts.get(row.skuLimpio) ?? 0) + 1);
  }

  const unlinkedSkus = Array.from(counts.entries())
    .map(([skuLimpio, rowCount]) => ({ skuLimpio, rows: rowCount }))
    .sort((a, b) => b.rows - a.rows);

  return { unlinkedProductRows, unlinkedSkus };
}

/**
 * Muestra distribuida por fechas (inicio, medio, fin) para no confundir con solo la primera fecha del CSV.
 */
export function toPreviewSampleRows(
  rows: ParsedAmazonFbaLedgerRow[],
  limit = 20,
): AmazonFbaLedgerPreviewSampleRow[] {
  if (rows.length === 0) return [];
  if (rows.length <= limit) {
    return rows.map(toPreviewSampleRow);
  }

  const byDate = new Map<string, ParsedAmazonFbaLedgerRow[]>();
  for (const row of rows) {
    const list = byDate.get(row.snapshotDate) ?? [];
    list.push(row);
    byDate.set(row.snapshotDate, list);
  }

  const sortedDates = Array.from(byDate.keys()).sort();
  const minDate = sortedDates[0];
  const maxDate = sortedDates[sortedDates.length - 1];
  const midDate = sortedDates[Math.floor(sortedDates.length / 2)];

  const perBucket = 5;
  const picked: ParsedAmazonFbaLedgerRow[] = [];
  const seen = new Set<string>();

  function pickFromDate(date: string, maxCount: number) {
    const list = byDate.get(date) ?? [];
    let taken = 0;
    for (const row of list) {
      if (picked.length >= limit || taken >= maxCount) break;
      const key = rowSampleKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(row);
      taken++;
    }
  }

  pickFromDate(minDate, perBucket);
  if (midDate !== minDate) pickFromDate(midDate, perBucket);
  if (maxDate !== minDate && maxDate !== midDate) pickFromDate(maxDate, perBucket);

  if (picked.length < limit) {
    for (const date of sortedDates) {
      pickFromDate(date, limit - picked.length);
      if (picked.length >= limit) break;
    }
  }

  return picked.map(toPreviewSampleRow);
}
