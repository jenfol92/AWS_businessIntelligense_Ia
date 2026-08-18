import "server-only";

import { supabaseAdmin } from "@/server/supabase/adminClient";
import { AMAZON_INVENTORY_CANONICAL_JOB_KEY } from "@/modules/amazon-sp-api/amazonInventoryCanonicalSyncService";

export type AmazonCanonicalInventoryQuery = {
  productId?: string;
  asin?: string;
  operationalPool?: "EU" | "UK";
  limit?: number;
};

export type AmazonCanonicalInventoryMarketplaceQuery = AmazonCanonicalInventoryQuery & {
  skuLimpio?: string;
  marketplaceId?: string;
};

type ProductPoolRow = {
  producto_id: string | null;
  asin: string;
  operational_pool: "EU" | "UK";
  fba_available: number;
  fba_reserved: number;
  inbound_working: number;
  inbound_shipped: number;
  inbound_receiving: number;
  fba_inbound: number;
  fba_unfulfillable: number;
  fba_researching: number;
  unique_fnsku_count: number;
  observed_at: string;
  amazon_last_updated_time: string | null;
  confidence: "TRUSTED" | "UNAVAILABLE";
  freshness: "FRESH" | "AGING" | "STALE";
};

export async function getAmazonCanonicalInventory(query: AmazonCanonicalInventoryQuery = {}) {
  let request = supabaseAdmin
    .from("v_latest_amazon_fba_inventory_by_product_pool")
    .select("producto_id,asin,operational_pool,fba_available,fba_reserved,inbound_working,inbound_shipped,inbound_receiving,fba_inbound,fba_unfulfillable,fba_researching,unique_fnsku_count,observed_at,amazon_last_updated_time,confidence,freshness")
    .order("observed_at", { ascending: false })
    .limit(Math.max(1, Math.min(query.limit ?? 2_000, 5_000)));
  if (query.productId) request = request.eq("producto_id", query.productId);
  if (query.asin) request = request.eq("asin", query.asin);
  if (query.operationalPool) request = request.eq("operational_pool", query.operationalPool);

  const [{ data, error }, jobResult] = await Promise.all([
    request,
    supabaseAdmin.from("amazon_sync_jobs")
      .select("last_run_at,last_success_at,last_status,last_error,last_rows_upserted,next_run_hint")
      .eq("job_key", AMAZON_INVENTORY_CANONICAL_JOB_KEY)
      .maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  if (jobResult.error) throw new Error(jobResult.error.message);

  const rows = (data ?? []).map((raw) => {
    const row = raw as ProductPoolRow;
    return {
      productId: row.producto_id,
      asin: row.asin,
      operationalPool: row.operational_pool,
      available: Number(row.fba_available ?? 0),
      reserved: Number(row.fba_reserved ?? 0),
      inbound: {
        working: Number(row.inbound_working ?? 0),
        shipped: Number(row.inbound_shipped ?? 0),
        receiving: Number(row.inbound_receiving ?? 0),
        total: Number(row.fba_inbound ?? 0),
      },
      unfulfillable: Number(row.fba_unfulfillable ?? 0),
      researching: Number(row.fba_researching ?? 0),
      uniqueFnskuCount: Number(row.unique_fnsku_count ?? 0),
      observedAt: row.observed_at,
      amazonLastUpdatedTime: row.amazon_last_updated_time,
      confidence: row.confidence,
      freshness: row.freshness,
    };
  });
  const newestObservedAt = rows.map((row) => row.observedAt).sort().at(-1) ?? null;
  const job = jobResult.data;
  const freshness = rows.some((row) => row.freshness === "FRESH")
    ? "FRESH"
    : rows.some((row) => row.freshness === "AGING")
      ? "AGING"
      : rows.length > 0 ? "STALE" : "UNKNOWN";

  return {
    generatedAt: new Date().toISOString(),
    health: {
      status: job?.last_status === "ERROR" || job?.last_status === "RATE_LIMITED"
        ? "ERROR"
        : job?.last_status === "RUNNING" ? "RUNNING" : freshness,
      freshnessStatus: freshness,
      sourceTimestamp: newestObservedAt,
      lastRunAt: job?.last_run_at ?? null,
      lastSuccessAt: job?.last_success_at ?? null,
      lastError: job?.last_error ?? null,
      rows: job?.last_rows_upserted ?? null,
      nextRunHint: job?.next_run_hint ?? null,
      runtimeMode: process.env.VERCEL ? "DEPLOYED" : "LOCAL_MANUAL",
    },
    rows,
    pools: rows,
    totals: null,
    limitations: [
      "EU y UK se exponen por separado; no se publica un total consolidado mientras el modelo de pools siga PARTIAL.",
      "La ubicacion fisica procede del Inventory Ledger, no del marketplace consultado.",
    ],
  };
}

/** Detailed operational read model. Marketplace is part of the grain. */
export async function getAmazonCanonicalInventoryByMarketplace(
  query: AmazonCanonicalInventoryMarketplaceQuery = {},
) {
  let request = supabaseAdmin
    .from("v_latest_amazon_fba_inventory_by_product_marketplace")
    .select("producto_id,sku_limpio,marketplace_id,fba_available,fba_reserved,inbound_working,inbound_shipped,inbound_receiving,fba_inbound,fba_unfulfillable,fba_researching,seller_sku_row_count,asin_count,fnsku_count,observed_at,amazon_last_updated_time,confidence")
    .order("observed_at", { ascending: false })
    .limit(Math.max(1, Math.min(query.limit ?? 2_000, 5_000)));
  if (query.productId) request = request.eq("producto_id", query.productId);
  if (query.skuLimpio) request = request.eq("sku_limpio", query.skuLimpio);
  if (query.marketplaceId) request = request.eq("marketplace_id", query.marketplaceId);

  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      productId: (row.producto_id as string | null) ?? null,
      skuLimpio: (row.sku_limpio as string | null) ?? null,
      marketplaceId: String(row.marketplace_id ?? ""),
      available: Number(row.fba_available ?? 0),
      reserved: Number(row.fba_reserved ?? 0),
      inbound: {
        working: Number(row.inbound_working ?? 0),
        shipped: Number(row.inbound_shipped ?? 0),
        receiving: Number(row.inbound_receiving ?? 0),
        total: Number(row.fba_inbound ?? 0),
      },
      unfulfillable: Number(row.fba_unfulfillable ?? 0),
      researching: Number(row.fba_researching ?? 0),
      sellerSkuRowCount: Number(row.seller_sku_row_count ?? 0),
      asinCount: Number(row.asin_count ?? 0),
      fnskuCount: Number(row.fnsku_count ?? 0),
      observedAt: String(row.observed_at ?? ""),
      amazonLastUpdatedTime: (row.amazon_last_updated_time as string | null) ?? null,
      confidence: String(row.confidence ?? "UNAVAILABLE"),
    };
  });
}
