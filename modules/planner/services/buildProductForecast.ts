// modules/planner/services/buildProductForecast.ts
//
// Forecast corto plazo por producto respetando producto_supply_config.forecast_method.

import type { ProductSupplyConfig } from "@/modules/planning/types";
import type {
  CompetitorBenchmarkRow,
  DemandForecastResult,
  PlannerParams,
  PlanningProduct,
} from "../types/planner.types";
import { buildDemandForecast } from "./demandForecast";
import { buildNewProductForecast } from "./newProductForecast";
import {
  normalizeForecastMixWeights,
  resolveForecastMethod,
} from "./resolveForecastMethod";

function getBenchmarkRowsForProduct(
  product: PlanningProduct,
  benchmarksMap: Map<string, CompetitorBenchmarkRow[]>,
): CompetitorBenchmarkRow[] {
  const byId = benchmarksMap.get(product.id) ?? [];
  const bySku =
    product.sku && product.sku.trim() !== ""
      ? benchmarksMap.get(product.sku) ?? []
      : [];
  return byId.length > 0 ? byId : bySku;
}

function hasUsableBenchmark(rows: CompetitorBenchmarkRow[]): boolean {
  return rows.some(
    (r) => r.estimatedMonthlyUnits != null && r.estimatedMonthlyUnits > 0,
  );
}

function blendForecasts(
  own: DemandForecastResult,
  competitor: DemandForecastResult,
  ownWeight: number,
  competitorWeight: number,
): DemandForecastResult {
  const monthly = own.monthly.map((line, idx) => {
    const compLine = competitor.monthly[idx];
    const forecastUnits = Math.ceil(
      line.forecastUnits * ownWeight +
        (compLine?.forecastUnits ?? 0) * competitorWeight,
    );
    return { ...line, forecastUnits };
  });
  const firstMonthForecast = monthly[0]?.forecastUnits ?? 0;
  const method =
    competitorWeight >= ownWeight
      ? ("NEW_PRODUCT_BENCHMARK" as const)
      : ("HISTORICAL_SIMPLE" as const);

  return {
    productId: own.productId,
    sku: own.sku,
    method,
    averageDailySales: firstMonthForecast / 30,
    monthly,
  };
}

export function buildProductForecast(
  product: PlanningProduct,
  benchmarksMap: Map<string, CompetitorBenchmarkRow[]>,
  params: PlannerParams,
  supplyConfig?: ProductSupplyConfig | null,
): DemandForecastResult {
  const benchmarkRows = getBenchmarkRowsForProduct(product, benchmarksMap);
  const hasBenchmark = hasUsableBenchmark(benchmarkRows);
  const hasOwnSales = product.salesUnits > 0;

  const resolved = resolveForecastMethod({
    configuredMethod: supplyConfig?.forecastMethod ?? "AUTO",
    hasOwnSales,
    hasBenchmark,
    stockoutCorrectionEnabled: supplyConfig?.stockoutCorrectionEnabled,
  });

  const forecastOptions = {
    capturePctOverride: supplyConfig?.competitorCapturePct,
  };

  switch (resolved.method) {
    case "OWN_SALES":
      return buildDemandForecast(product, params);

    case "COMPETITOR_BENCHMARK":
      if (hasBenchmark) {
        return buildNewProductForecast(
          product,
          benchmarkRows,
          params,
          forecastOptions,
        );
      }
      return buildDemandForecast(product, params);

    case "MIXED": {
      const { ownWeight, competitorWeight } = normalizeForecastMixWeights(
        supplyConfig?.forecastMixOwnWeight,
        supplyConfig?.forecastMixCompetitorWeight,
      );

      const ownForecast = hasOwnSales
        ? buildDemandForecast(product, params)
        : null;
      const competitorForecast = hasBenchmark
        ? buildNewProductForecast(
            product,
            benchmarkRows,
            params,
            forecastOptions,
          )
        : null;

      if (ownForecast && competitorForecast) {
        return blendForecasts(
          ownForecast,
          competitorForecast,
          ownWeight,
          competitorWeight,
        );
      }
      if (ownForecast) return ownForecast;
      if (competitorForecast) return competitorForecast;
      return buildDemandForecast(product, params);
    }

    default:
      return buildDemandForecast(product, params);
  }
}
