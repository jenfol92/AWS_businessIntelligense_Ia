import {

  loadProductIdsBySku,

  mapLedgerRowsToDbPayload,

  upsertAmazonFbaLedgerDailyRows,

} from "./repository";

import {

  parseAmazonFbaLedgerSummaryCsv,

  summarizeLedgerRows,

  summarizeRowsByMonth,

  summarizeUnlinkedSkus,

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



export async function importAmazonFbaLedgerSummary(params: {

  file: File;

  mode: AmazonFbaLedgerImportMode;

  source?: string;

  skipUnlinkedProducts?: boolean;

}): Promise<AmazonFbaLedgerPreviewResponse | AmazonFbaLedgerCommitResponse> {

  const source = params.source?.trim() || DEFAULT_SOURCE;

  const skipUnlinkedProducts = params.skipUnlinkedProducts !== false;

  const parsed = await parseAmazonFbaLedgerSummaryCsv(params.file);

  const summary = summarizeLedgerRows(parsed.validRows);

  const validRowCount = parsed.validRows.length;



  const skus = parsed.validRows.map((r) => r.skuLimpio);

  const productoBySku = await loadProductIdsBySku(skus);

  const { unlinkedProductRows, unlinkedSkus } = summarizeUnlinkedSkus(

    parsed.validRows,

    productoBySku,

  );

  const importStats = computeImportStats(

    validRowCount,

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



  const { dbRows: allDbRows } = mapLedgerRowsToDbPayload({

    rows: parsed.validRows,

    productoBySku,

    source,

    sourceFileName: params.file.name || null,

  });



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

    skipUnlinkedProducts,

    insertedOrUpdated,

    omittedUnlinkedRows,

    source,

    sourceFileName: params.file.name || null,

    warnings: parsed.warnings,

  };

}


