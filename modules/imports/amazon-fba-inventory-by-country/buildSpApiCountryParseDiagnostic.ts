/**
 * Módulo      : imports / amazon-fba-inventory-by-country
 * Archivo     : buildSpApiCountryParseDiagnostic.ts
 * Responsabilidad: resumen en memoria del informe FBA Country descargado vía SP-API.
 * No debe     : escribir en Supabase, inventario ni snapshots.
 */

import {
  parseAmazonFbaCountryInventoryFromText,
  summarizeRowsByCountry,
  summarizeUnlinkedSkus,
} from "./parser";
import { loadProductIdsBySku } from "./repository";
import type { ParsedFbaCountryRow } from "./types";

const SAMPLE_ROW_LIMIT = 5;
const NOT_FOUND_SAMPLE_LIMIT = 10;

function extractAsin(raw: Record<string, unknown>): string | null {
  const asin = String(raw["asin"] ?? raw["ASIN"] ?? "").trim();
  return asin || null;
}

function toSampleRows(rows: ParsedFbaCountryRow[]) {
  return rows.slice(0, SAMPLE_ROW_LIMIT).map((row) => ({
    sellerSku: row.skuOriginal,
    asin: extractAsin(row.raw),
    country: row.pais,
    quantity: row.stockFba,
  }));
}

export type SpApiFbaCountryParseDiagnostic = {
  ok: true;
  stage: "report_parsed";
  marketplace: string;
  reportId: string;
  processingStatus: string;
  bytesLength: number;
  lineCount: number;
  parsedRows: number;
  countries: Array<{
    country: string;
    rows: number;
    units: number;
  }>;
  sampleRows: Array<{
    sellerSku: string;
    asin: string | null;
    country: string;
    quantity: number;
  }>;
  matchedProducts: number;
  notFoundProducts: number;
  notFoundSamples: string[];
  warnings?: string[];
};

/**
 * Parsea un informe FBA Country en memoria y devuelve un resumen seguro para diagnóstico SP-API.
 */
export async function buildSpApiFbaCountryParseDiagnostic(params: {
  content: string;
  marketplace: string;
  reportId: string;
  processingStatus: string;
}): Promise<SpApiFbaCountryParseDiagnostic> {
  const { content, marketplace, reportId, processingStatus } = params;
  const bytesLength = Buffer.byteLength(content, "utf8");
  const lineCount = content.split(/\r?\n/).length;

  const parsed = parseAmazonFbaCountryInventoryFromText(content, marketplace);
  const countries = summarizeRowsByCountry(parsed.validRows).map((entry) => ({
    country: entry.key,
    rows: entry.rows,
    units: entry.stockFba,
  }));

  const skus = parsed.validRows.map((row) => row.skuLimpio);
  const productoBySku = await loadProductIdsBySku(skus);
  const { unlinkedSkus } = summarizeUnlinkedSkus(parsed.validRows, productoBySku);

  const matchedSkuSet = new Set<string>();
  for (const row of parsed.validRows) {
    if (productoBySku.has(row.skuLimpio)) {
      matchedSkuSet.add(row.skuLimpio);
    }
  }

  const notFoundSkuSet = new Set(unlinkedSkus.map((entry) => entry.skuLimpio));

  const warnings =
    parsed.warnings.length > 0
      ? parsed.warnings.slice(0, 20).map((w) => `Fila ${w.row}: ${w.message}`)
      : undefined;

  return {
    ok: true,
    stage: "report_parsed",
    marketplace,
    reportId,
    processingStatus,
    bytesLength,
    lineCount,
    parsedRows: parsed.validRows.length,
    countries,
    sampleRows: toSampleRows(parsed.validRows),
    matchedProducts: matchedSkuSet.size,
    notFoundProducts: notFoundSkuSet.size,
    notFoundSamples: unlinkedSkus
      .slice(0, NOT_FOUND_SAMPLE_LIMIT)
      .map((entry) => entry.skuLimpio),
    ...(warnings ? { warnings } : {}),
  };
}
