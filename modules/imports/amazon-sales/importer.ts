// modules/imports/amazon-sales/importer.ts

import { parseAmazonSalesCsv } from "./parser";
import { normalizeAmazonSalesRows } from "./normalizer";
import { saveAmazonSalesRows } from "./repository";

export async function importAmazonSalesCsv(file: File) {
  const rawRows = await parseAmazonSalesCsv(file);
  const rows = normalizeAmazonSalesRows(rawRows);

  const result = await saveAmazonSalesRows(rows);

  return {
    imported: result.imported,
    skipped: result.skipped,
    errors: result.errors,
  };
}