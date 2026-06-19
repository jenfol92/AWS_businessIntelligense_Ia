// modules/products/repositories/competitorBenchmarkSnapshotRepository.ts
//
// Lectura de histórico en competitor_benchmark_snapshots (sin flags de selección).

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export type CompetitorBenchmarkSnapshotRow = {
  id: string;
  producto_id: string | null;
  candidate_sku: string | null;
  marketplace_country: string;
  competitor_asin: string;
  competitor_title: string | null;
  snapshot_date: string;
  price: number | null;
  rating: number | null;
  review_count: number | null;
  estimated_monthly_units: number | null;
  estimated_monthly_revenue: number | null;
  bsr: number | null;
  source: string;
};

const SNAPSHOT_SELECT =
  "id, producto_id, candidate_sku, marketplace_country, competitor_asin, competitor_title, snapshot_date, price, rating, review_count, estimated_monthly_units, estimated_monthly_revenue, bsr, source";

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapSnapshotRow(row: Record<string, unknown>): CompetitorBenchmarkSnapshotRow {
  return {
    id: String(row.id ?? ""),
    producto_id: row.producto_id != null ? String(row.producto_id) : null,
    candidate_sku: row.candidate_sku != null ? String(row.candidate_sku) : null,
    marketplace_country: String(row.marketplace_country ?? ""),
    competitor_asin: String(row.competitor_asin ?? ""),
    competitor_title:
      row.competitor_title != null ? String(row.competitor_title) : null,
    snapshot_date: String(row.snapshot_date ?? ""),
    price: toNullableNumber(row.price),
    rating: toNullableNumber(row.rating),
    review_count: toNullableNumber(row.review_count),
    estimated_monthly_units: toNullableNumber(row.estimated_monthly_units),
    estimated_monthly_revenue: toNullableNumber(row.estimated_monthly_revenue),
    bsr: toNullableNumber(row.bsr),
    source: String(row.source ?? ""),
  };
}

/** Último snapshot por competitor_asin (fecha más reciente). */
function dedupeLatestByAsin(
  rows: CompetitorBenchmarkSnapshotRow[],
): CompetitorBenchmarkSnapshotRow[] {
  const byAsin = new Map<string, CompetitorBenchmarkSnapshotRow>();

  for (const row of rows) {
    const asin = row.competitor_asin.trim().toUpperCase();
    if (!asin) continue;
    const existing = byAsin.get(asin);
    if (!existing || row.snapshot_date > existing.snapshot_date) {
      byAsin.set(asin, row);
    }
  }

  return Array.from(byAsin.values()).sort((a, b) =>
    a.competitor_asin.localeCompare(b.competitor_asin),
  );
}

/**
 * Snapshots recientes para un producto/marketplace (producto_id o candidate_sku).
 */
export async function fetchLatestBenchmarkSnapshotsForProduct(
  productoId: string,
  sku: string | null | undefined,
  marketplaceCountry: string,
  limit?: number,
): Promise<CompetitorBenchmarkSnapshotRow[]> {
  const supabase = createSupabaseRouteClient();
  const country = marketplaceCountry.trim();
  const rows: CompetitorBenchmarkSnapshotRow[] = [];

  const { data: byId, error: errId } = await supabase
    .from("competitor_benchmark_snapshots")
    .select(SNAPSHOT_SELECT)
    .eq("producto_id", productoId)
    .eq("marketplace_country", country)
    .order("snapshot_date", { ascending: false });

  if (errId) throw new Error(errId.message);
  for (const row of byId ?? []) {
    rows.push(mapSnapshotRow(row as Record<string, unknown>));
  }

  if (sku?.trim()) {
    const { data: bySku, error: errSku } = await supabase
      .from("competitor_benchmark_snapshots")
      .select(SNAPSHOT_SELECT)
      .eq("candidate_sku", sku.trim())
      .eq("marketplace_country", country)
      .order("snapshot_date", { ascending: false });

    if (errSku) throw new Error(errSku.message);
    for (const row of bySku ?? []) {
      rows.push(mapSnapshotRow(row as Record<string, unknown>));
    }
  }

  let unique = dedupeLatestByAsin(rows);
  if (limit != null && limit > 0) {
    unique = unique.slice(0, limit);
  }
  return unique;
}
