import {
  reconcileReturnedRowsForAsin,
  type ReturnedInventoryRow,
} from "../../amazon-sp-api/fbaInventoryAsinDiagnostic.ts";

export type InventoryFreshness = "FRESH" | "AGING" | "STALE" | "UNKNOWN";

export const AMAZON_INVENTORY_FRESH_HOURS = 24;
export const AMAZON_INVENTORY_STALE_HOURS = 72;

export function classifyInventoryFreshness(sourceTimestamp: string | null, now = new Date()): InventoryFreshness {
  if (!sourceTimestamp) return "UNKNOWN";
  const ageHours = (now.getTime() - new Date(sourceTimestamp).getTime()) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours < 0) return "UNKNOWN";
  if (ageHours <= AMAZON_INVENTORY_FRESH_HOURS) return "FRESH";
  if (ageHours <= AMAZON_INVENTORY_STALE_HOURS) return "AGING";
  return "STALE";
}

export type AmazonFbaSnapshotRow = {
  producto_id: string | null;
  sku_original: string;
  marketplace_id: string;
  country: string | null;
  snapshot_at: string;
  fulfillable_quantity: number;
  reserved_quantity: number | null;
  inbound_quantity: number | null;
  unfulfillable_quantity: number | null;
  researching_quantity: number | null;
  source: string;
  raw?: Record<string, unknown> | null;
};

export function toCanonicalAmazonInventory(row: AmazonFbaSnapshotRow, now = new Date()) {
  const freshnessStatus = classifyInventoryFreshness(row.snapshot_at, now);
  return {
    productId: row.producto_id,
    sku: row.sku_original,
    asin: typeof row.raw?.asin === "string" ? row.raw.asin : null,
    marketplaceId: row.marketplace_id,
    country: row.country,
    fulfillmentChannel: "FBA" as const,
    sellable: Number(row.fulfillable_quantity || 0),
    reserved: Number(row.reserved_quantity || 0),
    inbound: Number(row.inbound_quantity || 0),
    unfulfillable: Number(row.unfulfillable_quantity || 0),
    researching: Number(row.researching_quantity || 0),
    total: Number(row.fulfillable_quantity || 0) + Number(row.reserved_quantity || 0) + Number(row.unfulfillable_quantity || 0),
    source: row.source,
    sourceTimestamp: row.snapshot_at,
    freshnessStatus,
    reliable: freshnessStatus === "FRESH",
    confidence: freshnessStatus === "FRESH" ? "HIGH" as const : freshnessStatus === "AGING" ? "MEDIUM" as const : "UNAVAILABLE" as const,
  };
}

export function dedupeMarketplaceSnapshots<T extends { sku: string; marketplaceId: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter(row => { const key = `${row.sku}\u0000${row.marketplaceId}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

export type CanonicalOperationalPoolInventory = {
  asin: string;
  pool: "EU" | "UK";
  available: number;
  reserved: number;
  inbound: { working: number; shipped: number; receiving: number; total: number };
  unfulfillable: number;
  researching: number;
  uniqueFnskuCount: number;
  sellerSkuAliases: string[];
  confidence: "TRUSTED" | "FNSKU_CONFLICT" | "INCOMPLETE";
  conflictingFnskus: string[];
};

/** Seller SKU y marketplace de consulta son provenance, no grain cuantitativo. */
export function aggregateOperationalPoolInventory(
  asin: string,
  pool: "EU" | "UK",
  rows: readonly ReturnedInventoryRow[],
): CanonicalOperationalPoolInventory {
  const canonical = reconcileReturnedRowsForAsin(asin, rows);
  return {
    asin,
    pool,
    available: canonical.availableFba,
    reserved: canonical.reservedFba,
    inbound: canonical.inbound,
    unfulfillable: canonical.unfulfillableFba,
    researching: canonical.researchingFba,
    uniqueFnskuCount: canonical.uniqueFnskuCount,
    sellerSkuAliases: Array.from(new Set(
      canonical.rawIdentities.flatMap((row) => row.sellerSku ? [row.sellerSku] : []),
    )).sort(),
    confidence: canonical.inventoryConfidence,
    conflictingFnskus: canonical.conflictingFnskus,
  };
}
