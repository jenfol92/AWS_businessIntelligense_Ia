// modules/imports/amazon-sales/normalizer.ts

import { parseNumber } from "../shared/parseNumber";
import { countryToIso } from "../shared/countryToIso";
import type { NormalizedAmazonSalesRow } from "./types";

type RawAmazonRow = Record<string, unknown>;

export function normalizeAmazonSalesRows(
  rows: RawAmazonRow[],
): NormalizedAmazonSalesRow[] {
  return rows.map((row) => ({
    sku: String(row["seller-sku"] ?? row["SKU"] ?? ""),
    pais: countryToIso(row["marketplace"] ?? row["country"]),
    unidades: parseNumber(row["quantity"]),
    ingresos: parseNumber(row["item-price"]),
    fecha: row["purchase-date"],
  }));
}