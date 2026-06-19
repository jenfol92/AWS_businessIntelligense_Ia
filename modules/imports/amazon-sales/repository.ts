import type { NormalizedAmazonSalesRow } from "./types";

export async function saveAmazonSalesRows(
  rows: NormalizedAmazonSalesRow[],
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  return {
    imported: 0,
    skipped: rows.length,
    errors: [],
  };
}
