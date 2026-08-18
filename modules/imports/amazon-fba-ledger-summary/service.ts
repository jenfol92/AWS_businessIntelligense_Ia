import {
  loadProductIdsBySkuAndAsin,
  loadLatestFbaCountryConditionByIdentity,
  loadLedgerLocationEvidence,

  mapLedgerRowsToDbPayload,

  upsertAmazonFbaLedgerDailyRows,

} from "./repository";

import {
  resolveLedgerDocumentIdentity,
} from "./ledgerCanonicalIdentity";

import {

  parseAmazonFbaLedgerSummaryCsv,
  parseAmazonFbaLedgerSummaryText,

  summarizeLedgerRows,

  summarizeRowsByMonth,

  toPreviewSampleRows,

} from "./parser";

import type {

  AmazonFbaLedgerCommitResponse,

  AmazonFbaLedgerImportMode,

  AmazonFbaLedgerPreviewResponse,

  AmazonFbaLedgerSource,

} from "./types";



const DEFAULT_SOURCE: AmazonFbaLedgerSource = "amazon_fba_ledger_summary_manual";

function computeImportStats(

  validRows: number,

  unlinkedProductRows: number,

  skipUnlinkedProducts: boolean,

) {

  if (skipUnlinkedProducts) {

    return {

      importableRows: validRows - unlinkedProductRows,

      omittedUnlinkedRows: unlinkedProductRows,

    };

  }

  return {

    importableRows: validRows,

    omittedUnlinkedRows: 0,

  };

}



async function importParsedAmazonFbaLedgerSummary(params: {
  parsed: Awaited<ReturnType<typeof parseAmazonFbaLedgerSummaryCsv>>;
  mode: AmazonFbaLedgerImportMode;
  source?: string;
  skipUnlinkedProducts?: boolean;
  sourceFileName?: string | null;
  reportDocumentId: string | null;
  manualDocumentHash: string | null;
  documentIdentityType: "REPORT_DOCUMENT_ID" | "MANUAL_SHA256";
  documentIdentity: string;
}): Promise<AmazonFbaLedgerPreviewResponse | AmazonFbaLedgerCommitResponse> {

  const source = params.source?.trim() || DEFAULT_SOURCE;

  const skipUnlinkedProducts = params.skipUnlinkedProducts !== false;

  const parsed = params.parsed;

  const summary = summarizeLedgerRows(parsed.validRows);

  const validRowCount = parsed.validRows.length;



  const skus = parsed.validRows.flatMap((r) => [r.skuLimpio, ...r.mskuAliases]);
  const asins = parsed.validRows.map((r) => r.asin).filter(Boolean);

  const productMatches = await loadProductIdsBySkuAndAsin({
    skus,
    asins,
    fnskus: parsed.validRows.map((row) => row.fnsku).filter(Boolean),
  });
  const productoBySku = productMatches.bySku;
  const conditionByIdentity = await loadLatestFbaCountryConditionByIdentity(
    parsed.validRows.map((row) => ({ fnsku: row.fnsku, asin: row.asin })),
  );
  const locationEvidence = await loadLedgerLocationEvidence();

  const previewMapped = mapLedgerRowsToDbPayload({
    rows: parsed.validRows,
    productoBySku,
    productoByAsin: productMatches.byAsin,
    productoByFnsku: productMatches.byFnsku,
    productoByExistingAlias: productMatches.byExistingAlias,
    skuByProductId: productMatches.skuByProductId,
    ambiguousAsins: productMatches.ambiguousAsins,
    ambiguousFnskus: productMatches.ambiguousFnskus,
    ambiguousAliases: productMatches.ambiguousAliases,
    conditionByIdentity,
    source,
    sourceFileName: params.sourceFileName ?? null,
    reportDocumentId: params.reportDocumentId,
    manualDocumentHash: params.manualDocumentHash,
    documentIdentityType: params.documentIdentityType,
    documentIdentity: params.documentIdentity,
    locationEvidence,
  });
  const unlinkedProductRows = previewMapped.unlinkedProductRows;
  const unlinkedCounts = new Map<string, number>();
  for (const row of previewMapped.dbRows) {
    if (row.producto_id !== null) continue;
    const key = row.sku_limpio || row.asin || row.sku_original || "UNKNOWN";
    unlinkedCounts.set(key, (unlinkedCounts.get(key) ?? 0) + 1);
  }
  const unlinkedSkus = Array.from(unlinkedCounts.entries())
    .map(([skuLimpio, rows]) => ({ skuLimpio, rows }))
    .sort((a, b) => b.rows - a.rows);

  const importStats = computeImportStats(
    previewMapped.dbRows.length,
    unlinkedProductRows,
    skipUnlinkedProducts,
  );



  if (params.mode === "preview") {

    return {

      ok: true,

      mode: "preview",

      totalRows: parsed.totalRows,

      twinlyRows: parsed.twinlyRows,

      skippedNonTwinlyRows: parsed.skippedNonTwinlyRows,

      validRows: validRowCount,

      skippedRows: parsed.skippedRows,

      uniqueSkus: summary.uniqueSkus,

      unlinkedProductRows,
      conflictRows: previewMapped.conflictRows,
      unknownConditionRows: previewMapped.unknownConditionRows,

      unlinkedSkus,

      skipUnlinkedProducts,

      importableRows: importStats.importableRows,

      omittedUnlinkedRows: importStats.omittedUnlinkedRows,

      dateRange: summary.dateRange,

      rowsByMonth: summarizeRowsByMonth(parsed.validRows),

      dispositions: summary.dispositions,

      locations: summary.locations,

      warnings: parsed.warnings,

      sampleRows: toPreviewSampleRows(parsed.validRows),

    };

  }



  const { dbRows: allDbRows, conflictRows, unknownConditionRows } = mapLedgerRowsToDbPayload({

    rows: parsed.validRows,

    productoBySku,
    productoByAsin: productMatches.byAsin,
    productoByFnsku: productMatches.byFnsku,
    productoByExistingAlias: productMatches.byExistingAlias,
    skuByProductId: productMatches.skuByProductId,
    ambiguousAsins: productMatches.ambiguousAsins,
    ambiguousFnskus: productMatches.ambiguousFnskus,
    ambiguousAliases: productMatches.ambiguousAliases,
    conditionByIdentity,

    source,

    sourceFileName: params.sourceFileName ?? null,
    reportDocumentId: params.reportDocumentId,
    manualDocumentHash: params.manualDocumentHash,
    documentIdentityType: params.documentIdentityType,
    documentIdentity: params.documentIdentity,
    locationEvidence,

  });



  if (parsed.warnings.length > 0) {
    throw new Error(
      `Inventory Ledger bloqueado: ${parsed.warnings.length} warnings de parseo. Revisa la preview antes de importar.`,
    );
  }

  if (conflictRows > 0) {
    throw new Error(
      `Inventory Ledger bloqueado: ${conflictRows} filas tienen conflicto de matching de producto.`,
    );
  }

  const dbRows = skipUnlinkedProducts

    ? allDbRows.filter((row) => row.producto_id !== null)

    : allDbRows;



  const omittedUnlinkedRows = skipUnlinkedProducts ? unlinkedProductRows : 0;

  const insertedOrUpdated = await upsertAmazonFbaLedgerDailyRows(dbRows);



  return {

    ok: true,

    mode: "commit",

    totalRows: parsed.totalRows,

    twinlyRows: parsed.twinlyRows,

    skippedNonTwinlyRows: parsed.skippedNonTwinlyRows,

    validRows: validRowCount,

    skippedRows: parsed.skippedRows,

    uniqueSkus: summary.uniqueSkus,

    unlinkedProductRows,
    conflictRows,
    unknownConditionRows,

    skipUnlinkedProducts,

    insertedOrUpdated,

    omittedUnlinkedRows,

    source,

    sourceFileName: params.sourceFileName ?? null,
    reportDocumentId: params.reportDocumentId,

    warnings: parsed.warnings,

  };

}

export async function importAmazonFbaLedgerSummary(params: {
  file: File;
  mode: AmazonFbaLedgerImportMode;
  source?: string;
  skipUnlinkedProducts?: boolean;
  sourceFileName?: string | null;
  reportDocumentId?: string | null;
}): Promise<AmazonFbaLedgerPreviewResponse | AmazonFbaLedgerCommitResponse> {
  const text = await params.file.text();
  const parsed = await parseAmazonFbaLedgerSummaryText(text);
  const identity = resolveLedgerDocumentIdentity({
    reportDocumentId: params.reportDocumentId,
    text,
  });
  return importParsedAmazonFbaLedgerSummary({
    parsed,
    mode: params.mode,
    source: params.source,
    skipUnlinkedProducts: params.skipUnlinkedProducts,
    sourceFileName: params.sourceFileName ?? params.file.name ?? null,
    ...identity,
  });
}

export async function importAmazonFbaLedgerSummaryFromText(params: {
  text: string;
  mode: AmazonFbaLedgerImportMode;
  source?: string;
  skipUnlinkedProducts?: boolean;
  sourceFileName?: string | null;
  reportDocumentId?: string | null;
}): Promise<AmazonFbaLedgerPreviewResponse | AmazonFbaLedgerCommitResponse> {
  const parsed = await parseAmazonFbaLedgerSummaryText(params.text);
  const identity = resolveLedgerDocumentIdentity({
    reportDocumentId: params.reportDocumentId,
    text: params.text,
  });
  return importParsedAmazonFbaLedgerSummary({
    parsed,
    mode: params.mode,
    source: params.source,
    skipUnlinkedProducts: params.skipUnlinkedProducts,
    sourceFileName: params.sourceFileName ?? null,
    ...identity,
  });
}


