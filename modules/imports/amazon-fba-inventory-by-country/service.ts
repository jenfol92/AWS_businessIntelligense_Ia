import {
  commitFbaCountryInventory,
  loadProductIdsBySku,
} from "./repository";
import {
  parseAmazonFbaCountryInventoryFile,
  parseAmazonFbaCountryInventoryFromText,
  summarizeFbaCountryRows,
  summarizeRowsByCountry,
  summarizeUnlinkedSkus,
  toPreviewSampleRows,
} from "./parser";
import type {
  FbaCountryCommitResponse,
  FbaCountryPreviewResponse,
  AmazonFbaCountryImportMode,
  AmazonFbaCountrySource,
  FbaCountryParseResult,
} from "./types";

const DEFAULT_SOURCE: AmazonFbaCountrySource = "amazon_fba_country_report";

function computeImportStats(
  validRows: number,
  skippedUnlinkedRows: number,
  skipUnlinkedProducts: boolean,
) {
  if (skipUnlinkedProducts) {
    return {
      importableRows: validRows - skippedUnlinkedRows,
      omittedUnlinkedRows: skippedUnlinkedRows,
    };
  }
  return {
    importableRows: validRows,
    omittedUnlinkedRows: 0,
  };
}

async function buildImportResponse(params: {
  parsed: FbaCountryParseResult;
  mode: AmazonFbaCountryImportMode;
  source: string;
  skipUnlinkedProducts: boolean;
  defaultPais: string | null;
  sourceFileName: string | null;
}) {
  const { parsed, mode, source, skipUnlinkedProducts, defaultPais, sourceFileName } =
    params;
  const summary = summarizeFbaCountryRows(parsed.validRows);
  const validRowCount = parsed.validRows.length;

  const skus = parsed.validRows.map((r) => r.skuLimpio);
  const productoBySku = await loadProductIdsBySku(skus);
  const { skippedUnlinkedRows, unlinkedSkus } = summarizeUnlinkedSkus(
    parsed.validRows,
    productoBySku,
  );
  const importStats = computeImportStats(
    validRowCount,
    skippedUnlinkedRows,
    skipUnlinkedProducts,
  );

  const importableRows = skipUnlinkedProducts
    ? parsed.validRows.filter((row) => Boolean(productoBySku.get(row.skuLimpio)))
    : parsed.validRows;

  if (mode === "preview") {
    return {
      ok: true as const,
      mode: "preview" as const,
      totalRows: parsed.totalRows,
      twinlyRows: parsed.twinlyRows,
      validRows: validRowCount,
      importableRows: importStats.importableRows,
      skippedNonTwinlyRows: parsed.skippedNonTwinlyRows,
      skippedNoCountryRows: parsed.skippedNoCountryRows,
      skippedNoStockRows: parsed.skippedNoStockRows,
      skippedUnlinkedRows,
      omittedUnlinkedRows: importStats.omittedUnlinkedRows,
      uniqueSkus: summary.uniqueSkus,
      skipUnlinkedProducts,
      defaultPais,
      dateRange: summary.dateRange,
      rowsByCountry: summarizeRowsByCountry(importableRows),
      unlinkedSkus,
      warnings: parsed.warnings,
      sampleRows: toPreviewSampleRows(parsed.validRows, productoBySku),
    } satisfies FbaCountryPreviewResponse;
  }

  const commitRows = skipUnlinkedProducts ? importableRows : parsed.validRows;
  const { inventarioPaisesUpserted, historySnapshotsUpserted } =
    await commitFbaCountryInventory({
      rows: commitRows,
      productoBySku,
      source,
    });

  return {
    ok: true as const,
    mode: "commit" as const,
    totalRows: parsed.totalRows,
    twinlyRows: parsed.twinlyRows,
    validRows: validRowCount,
    importableRows: importStats.importableRows,
    skippedNonTwinlyRows: parsed.skippedNonTwinlyRows,
    skippedNoCountryRows: parsed.skippedNoCountryRows,
    skippedUnlinkedRows,
    omittedUnlinkedRows: importStats.omittedUnlinkedRows,
    inventarioPaisesUpserted,
    historySnapshotsUpserted,
    defaultPais,
    dateRange: summary.dateRange,
    rowsByCountry: summarizeRowsByCountry(commitRows),
    source,
    sourceFileName,
    warnings: parsed.warnings,
  } satisfies FbaCountryCommitResponse;
}

export async function importAmazonFbaInventoryByCountry(params: {
  file: File;
  mode: AmazonFbaCountryImportMode;
  source?: string;
  skipUnlinkedProducts?: boolean;
  defaultPais?: string | null;
}): Promise<FbaCountryPreviewResponse | FbaCountryCommitResponse> {
  const source = params.source?.trim() || DEFAULT_SOURCE;
  const skipUnlinkedProducts = params.skipUnlinkedProducts !== false;
  const defaultPais = params.defaultPais?.trim().toUpperCase() || null;

  const parsed = await parseAmazonFbaCountryInventoryFile(params.file, defaultPais);

  return buildImportResponse({
    parsed,
    mode: params.mode,
    source,
    skipUnlinkedProducts,
    defaultPais,
    sourceFileName: params.file.name || null,
  });
}

export async function importAmazonFbaInventoryByCountryFromText(params: {
  text: string;
  mode: AmazonFbaCountryImportMode;
  source?: string;
  skipUnlinkedProducts?: boolean;
  defaultPais?: string | null;
  sourceFileName?: string | null;
}): Promise<FbaCountryPreviewResponse | FbaCountryCommitResponse> {
  const source = params.source?.trim() || DEFAULT_SOURCE;
  const skipUnlinkedProducts = params.skipUnlinkedProducts !== false;
  const defaultPais = params.defaultPais?.trim().toUpperCase() || null;

  const parsed = parseAmazonFbaCountryInventoryFromText(params.text, defaultPais);

  return buildImportResponse({
    parsed,
    mode: params.mode,
    source,
    skipUnlinkedProducts,
    defaultPais,
    sourceFileName: params.sourceFileName ?? "sp-api-report.txt",
  });
}
