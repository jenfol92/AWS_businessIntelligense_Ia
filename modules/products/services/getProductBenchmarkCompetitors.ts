// modules/products/services/getProductBenchmarkCompetitors.ts

import { fetchLatestBenchmarkSnapshotsForProduct } from "../repositories/competitorBenchmarkSnapshotRepository";
import { fetchAllSelectionsForProductMarketplace } from "../repositories/productCompetitorBenchmarkSelectionRepository";
import type { ProductBenchmarkCompetitorRow } from "../types/competitor-benchmark-selection.types";

export type GetProductBenchmarkCompetitorsResult = {
  productId: string;
  marketplaceCountry: string;
  competitors: ProductBenchmarkCompetitorRow[];
};

export async function getProductBenchmarkCompetitors(
  productoId: string,
  sku: string | null | undefined,
  marketplaceCountry: string,
  limit?: number,
): Promise<GetProductBenchmarkCompetitorsResult> {
  const country = marketplaceCountry.trim() || "ES";

  const [snapshots, selectionsByAsin] = await Promise.all([
    fetchLatestBenchmarkSnapshotsForProduct(productoId, sku, country, limit),
    fetchAllSelectionsForProductMarketplace(productoId, country),
  ]);

  const competitors: ProductBenchmarkCompetitorRow[] = snapshots.map((snap) => {
    const sel = selectionsByAsin.get(snap.competitor_asin.trim().toUpperCase());
    return {
      competitorAsin: snap.competitor_asin,
      competitorTitle: sel?.competitorTitle ?? snap.competitor_title,
      snapshotId: snap.id,
      snapshotDate: snap.snapshot_date || null,
      price: snap.price,
      rating: snap.rating,
      reviewCount: snap.review_count,
      bsr: snap.bsr,
      estimatedMonthlyUnits: snap.estimated_monthly_units,
      estimatedMonthlyRevenue: snap.estimated_monthly_revenue,
      source: snap.source || null,
      isSelected: sel?.isSelected ?? false,
      useForForecast: sel?.useForForecast ?? false,
      weight: sel?.weight ?? null,
      capturePct: sel?.capturePct ?? null,
      notes: sel?.notes ?? null,
    };
  });

  return {
    productId: productoId,
    marketplaceCountry: country,
    competitors,
  };
}
