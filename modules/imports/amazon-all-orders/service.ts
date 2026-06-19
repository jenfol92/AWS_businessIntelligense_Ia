import {
  loadProductIdsBySku,
  mapAllOrdersRowsToDbPayload,
  syncVentasDiariasFromStaging,
  upsertAmazonAllOrdersItems,
} from "./repository";
import {
  parseAmazonAllOrdersFile,
  summarizeAllOrdersRows,
  summarizeRowsByKey,
  summarizeRowsByMonth,
  summarizeUnlinkedSkus,
  toPreviewSampleRows,
} from "./parser";
import type {
  AmazonAllOrdersCommitResponse,
  AmazonAllOrdersImportMode,
  AmazonAllOrdersPreviewResponse,
  AmazonAllOrdersSource,
} from "./types";

const DEFAULT_SOURCE: AmazonAllOrdersSource = "amazon_all_orders_manual";

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

export async function importAmazonAllOrders(params: {
  file: File;
  mode: AmazonAllOrdersImportMode;
  source?: string;
  skipUnlinkedProducts?: boolean;
}): Promise<AmazonAllOrdersPreviewResponse | AmazonAllOrdersCommitResponse> {
  const source = params.source?.trim() || DEFAULT_SOURCE;
  const skipUnlinkedProducts = params.skipUnlinkedProducts !== false;
  const parsed = await parseAmazonAllOrdersFile(params.file);
  const summary = summarizeAllOrdersRows(parsed.validRows);
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

  const importableParsedRows = skipUnlinkedProducts
    ? parsed.validRows.filter((row) => Boolean(productoBySku.get(row.skuLimpio)))
    : parsed.validRows;

  if (params.mode === "preview") {
    return {
      ok: true,
      mode: "preview",
      totalRows: parsed.totalRows,
      twinlyRows: parsed.twinlyRows,
      validRows: validRowCount,
      importableRows: importStats.importableRows,
      skippedNonTwinlyRows: parsed.skippedNonTwinlyRows,
      skippedCancelledRows: parsed.skippedCancelledRows,
      skippedQuantityZeroRows: parsed.skippedQuantityZeroRows,
      skippedUnlinkedRows,
      omittedUnlinkedRows: importStats.omittedUnlinkedRows,
      uniqueSkus: summary.uniqueSkus,
      skipUnlinkedProducts,
      dateRange: summary.dateRange,
      rowsByMonth: summarizeRowsByMonth(importableParsedRows),
      rowsByMarketplace: summarizeRowsByKey(
        importableParsedRows,
        (row) => row.marketplaceCountry,
      ),
      rowsByChannel: summarizeRowsByKey(
        importableParsedRows,
        (row) => row.canalVenta,
      ),
      unlinkedSkus,
      warnings: parsed.warnings,
      sampleRows: toPreviewSampleRows(parsed.validRows, productoBySku),
    };
  }

  const dbRows = mapAllOrdersRowsToDbPayload({
    rows: importableParsedRows,
    productoBySku,
    source,
    sourceFileName: params.file.name || null,
  });

  const importableWithProduct = dbRows.filter((row) => row.producto_id !== null);
  const stagingInsertedOrUpdated = await upsertAmazonAllOrdersItems(
    importableWithProduct,
  );

  const productoIds = Array.from(
    new Set(
      importableWithProduct
        .map((row) => row.producto_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const dates = importableWithProduct.map((row) => row.purchase_date).sort();
  const dateFrom = dates[0] ?? summary.dateRange.from ?? "";
  const dateTo = dates[dates.length - 1] ?? summary.dateRange.to ?? "";

  let ventasDiariasUpserted = 0;
  const syncWarnings: string[] = [];

  if (dateFrom && dateTo) {
    const syncResult = await syncVentasDiariasFromStaging({
      productoIds,
      dateFrom,
      dateTo,
      source: "amazon_all_orders",
    });
    ventasDiariasUpserted = syncResult.upserted;
    syncWarnings.push(...syncResult.warnings);
  }

  const commitWarnings = [
    ...parsed.warnings,
    ...syncWarnings.map((message) => ({ row: 0, message })),
  ];

  return {
    ok: true,
    mode: "commit",
    totalRows: parsed.totalRows,
    twinlyRows: parsed.twinlyRows,
    validRows: validRowCount,
    importableRows: importStats.importableRows,
    skippedNonTwinlyRows: parsed.skippedNonTwinlyRows,
    skippedCancelledRows: parsed.skippedCancelledRows,
    skippedQuantityZeroRows: parsed.skippedQuantityZeroRows,
    skippedUnlinkedRows,
    omittedUnlinkedRows: importStats.omittedUnlinkedRows,
    notFoundRows: skippedUnlinkedRows,
    uniqueSkus: summary.uniqueSkus,
    skipUnlinkedProducts,
    stagingInsertedOrUpdated,
    ventasDiariasUpserted,
    dateRange: summary.dateRange,
    rowsByMarketplace: summarizeRowsByKey(
      importableParsedRows,
      (row) => row.marketplaceCountry,
    ),
    unlinkedSkus,
    source,
    sourceFileName: params.file.name || null,
    warnings: commitWarnings,
  };
}
