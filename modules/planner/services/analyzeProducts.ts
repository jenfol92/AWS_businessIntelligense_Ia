// modules/planner/services/analyzeProducts.ts

import { fetchPreviousYearMonthlySalesBatch } from "@/modules/inventory/repositories/inventoryRepository";
import {
  resolveChannelScope,
  resolveCountryScope,
} from "@/modules/inventory/services/inventoryScope";
import { findProductSupplyConfigsByProductoIds } from "@/modules/planning/repositories/productSupplyConfigRepository";
import { loadLogisticsCalendarEventsForPlanning } from "@/modules/planner/services/loadLogisticsCalendarEvents";
import {
  defaultProductSupplyConfig,
  mapRawToProductSupplyConfig,
} from "@/modules/planning/services/getProductSupplyConfig";
import type {
  ProductForecastConfigUpsertBody,
  ProductSupplyConfig,
} from "@/modules/planning/types";
import {
  getCompetitorBenchmarksForPlanning,
  getProductsForPlanning,
} from "../repositories/plannerRepository";
import {
  fetchLastOrderLeadTimesByProductIds,
  fetchRecentSalesByProductIds,
} from "../repositories/replenishmentRepository";
import type { ReplenishmentParams } from "../types/replenishment.types";
import { buildAnnualPurchasePlan } from "./buildAnnualPurchasePlan";
import { buildProductForecast } from "./buildProductForecast";
import { buildPortPurchasePlan } from "./buildPortPurchasePlan";
import { calculatePurchaseRecommendation } from "./purchaseRecomendationEngine";
import { resolveReplenishmentDemand } from "./resolveReplenishmentDemand";
import { resolveReplenishmentParams } from "./resolveReplenishmentParams";
import { simulateSupplyPlan } from "./simulateSupplyPlan";
import type {
  AnnualPurchasePlanResult,
  CompetitorBenchmarkRow,
  DemandForecastResult,
  PlannerParams,
  PortPurchasePlan,
  SupplySimulationResult,
} from "../types/planner.types";

type Analysis = ReturnType<typeof calculatePurchaseRecommendation>;

function sumMonthly(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function benchmarkMonthlyUnits(
  rows: CompetitorBenchmarkRow[],
  capturePct: number | null | undefined,
): number {
  const values = rows
    .map((row) => Number(row.estimatedMonthlyUnits ?? 0))
    .filter((value) => value > 0);
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[mid]!
      : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const capture = capturePct != null && Number.isFinite(capturePct) ? capturePct : 0.07;
  return Math.ceil(median * capture);
}

function getBenchmarkRowsForProduct(
  productId: string,
  sku: string,
  benchmarksMap: Map<string, CompetitorBenchmarkRow[]>,
): CompetitorBenchmarkRow[] {
  const byId = benchmarksMap.get(productId) ?? [];
  if (byId.length > 0) return byId;
  if (sku.trim() !== "") return benchmarksMap.get(sku) ?? [];
  return [];
}

function supplyConfigForProduct(
  productId: string,
  configsByProductId: Map<string, ProductSupplyConfig>,
  overrides?: Record<string, ProductForecastConfigUpsertBody>,
): ProductSupplyConfig {
  const base =
    configsByProductId.get(productId) ?? defaultProductSupplyConfig(productId);
  const override = overrides?.[productId];
  if (!override) return base;
  return {
    ...base,
    forecastMethod: override.forecastMethod,
    forecastMixOwnWeight: override.forecastMixOwnWeight,
    forecastMixCompetitorWeight: override.forecastMixCompetitorWeight,
    competitorCapturePct: override.competitorCapturePct,
    stockoutCorrectionEnabled: override.stockoutCorrectionEnabled,
  };
}

function buildPlannerStats(
  analyses: Analysis[],
  purchasePlan: PortPurchasePlan,
  forecasts: DemandForecastResult[],
  simulations: SupplySimulationResult[],
  annualPurchasePlan: AnnualPurchasePlanResult,
) {
  const separatedProducts = purchasePlan.portGroups.reduce(
    (sum, g) => sum + g.separatedProducts.length,
    0,
  );
  const consolidableGroups = purchasePlan.portGroups.filter(
    (g) => g.canConsolidate,
  ).length;

  const forecastedProducts = forecasts.filter(
    (f) => f.method === "HISTORICAL_SIMPLE",
  ).length;
  const noHistoryProducts = forecasts.filter(
    (f) => f.method === "NO_HISTORY",
  ).length;
  const newProductBenchmarkForecasts = forecasts.filter(
    (f) => f.method === "NEW_PRODUCT_BENCHMARK",
  ).length;
  const totalForecastUnitsFirstMonth = forecasts.reduce(
    (sum, f) => sum + (f.monthly[0]?.forecastUnits ?? 0),
    0,
  );

  const replenishmentNeededProducts = simulations.filter(
    (s) => s.needsReplenishment,
  ).length;
  const stockoutProducts = simulations.filter(
    (s) => s.stockoutMonthIndex != null,
  ).length;
  const recommendedDates = simulations
    .map((s) => s.recommendedOrderDate)
    .filter((d): d is string => d != null && d !== "");
  const earliestRecommendedOrderDate =
    recommendedDates.length === 0
      ? null
      : recommendedDates.reduce((a, b) => (a < b ? a : b));

  const annualProductsToOrder = annualPurchasePlan.productsToOrder;
  const annualRecommendedUnits = annualPurchasePlan.totalRecommendedUnits;
  const annualRecommendedCbm = annualPurchasePlan.totalRecommendedCbm;
  const annualRecommendedWeightKg =
    annualPurchasePlan.totalRecommendedWeightKg;
  const overduePurchaseLines = annualPurchasePlan.lines.filter(
    (line) => line.orderTimingStatus === "OVERDUE",
  ).length;

  const dueNowPurchaseLines = annualPurchasePlan.lines.filter(
    (line) => line.orderTimingStatus === "DUE_NOW",
  ).length;

  return {
    count: analyses.length,
    urgent: analyses.filter((a) => a.status === "urgente").length,
    portsCount: purchasePlan.portGroups.length,
    separatedProducts,
    consolidableGroups,
    forecastedProducts,
    noHistoryProducts,
    newProductBenchmarkForecasts,
    totalForecastUnitsFirstMonth,
    replenishmentNeededProducts,
    stockoutProducts,
    earliestRecommendedOrderDate,
    annualProductsToOrder,
    annualRecommendedUnits,
    annualRecommendedCbm,
    annualRecommendedWeightKg,
    overduePurchaseLines,
    dueNowPurchaseLines,
    capitalAlreadyCommitted: annualPurchasePlan.capitalAlreadyCommitted,
    additionalCapitalRequired: annualPurchasePlan.additionalCapitalRequired,
    totalCapitalExposure: annualPurchasePlan.totalCapitalExposure,
  };
}

export async function analyzeProducts(params: PlannerParams) {
  const products = await getProductsForPlanning(params);
  const productIds = products.map((p) => p.id);
  const candidateSkus = products.map((p) => p.sku).filter(Boolean);

  const countryScope = resolveCountryScope(
    params.country && params.country !== "ALL" ? params.country : undefined,
  );
  const channelScope = resolveChannelScope(
    params.channel === "AMAZON_FBA"
      ? "FBA"
      : params.channel === "AMAZON_FBM"
        ? "FBM"
        : params.channel,
  );
  const baseYear = new Date().getFullYear() - 1;
  const forecastYear = new Date().getFullYear();

  const [
    benchmarksMap,
    supplyConfigRows,
    lastOrderLeadMap,
    previousYearMonthlyMap,
    recentSales30Map,
    recentSales90Map,
    calendarEvents,
  ] = await Promise.all([
    getCompetitorBenchmarksForPlanning(
      productIds,
      candidateSkus,
      params.country,
    ),
    findProductSupplyConfigsByProductoIds(productIds),
    fetchLastOrderLeadTimesByProductIds(productIds),
    fetchPreviousYearMonthlySalesBatch(
      productIds,
      baseYear,
      countryScope.countries,
      channelScope.ventasCanal,
    ),
    fetchRecentSalesByProductIds(
      productIds,
      30,
      params.country,
      channelScope.ventasCanal,
    ),
    fetchRecentSalesByProductIds(
      productIds,
      90,
      params.country,
      channelScope.ventasCanal,
    ),
    loadLogisticsCalendarEventsForPlanning(),
  ]);

  const supplyConfigsByProductId = new Map<string, ProductSupplyConfig>();
  for (const [productoId, row] of Array.from(supplyConfigRows.entries())) {
    supplyConfigsByProductId.set(productoId, mapRawToProductSupplyConfig(row));
  }

  const forecasts = products.map((product) =>
    buildProductForecast(
      product,
      benchmarksMap,
      params,
      supplyConfigForProduct(
        product.id,
        supplyConfigsByProductId,
        params.forecastConfigOverrides,
      ),
    ),
  );
  const forecastByProductId = new Map(forecasts.map((f) => [f.productId, f]));

  const replenishmentByProductId = new Map<string, ReplenishmentParams>();
  for (const product of products) {
    const forecast = forecastByProductId.get(product.id);
    if (!forecast) continue;

    const supplyRow = supplyConfigRows.get(product.id) ?? null;
    const supplyConfig = supplyConfigForProduct(
      product.id,
      supplyConfigsByProductId,
      params.forecastConfigOverrides,
    );
    const lastOrder = lastOrderLeadMap.get(product.id);
    const demandOverride = params.replenishmentDemandOverrides?.[product.id];
    const previousYearMonthly = previousYearMonthlyMap.get(product.id) ?? [];
    const previousYearTotal =
      demandOverride?.previousYearTotal ?? sumMonthly(previousYearMonthly);

    const annualForecastMonthly =
      demandOverride?.annualForecastMonthly ??
      (previousYearTotal > 0 ? previousYearMonthly : undefined);

    const benchmarkRows = getBenchmarkRowsForProduct(
      product.id,
      product.sku,
      benchmarksMap,
    );

    const demand = resolveReplenishmentDemand({
      annualForecastMonthly,
      recentSales30:
        demandOverride?.recentSales30 ??
        recentSales30Map.get(product.id) ??
        (params.windowDays === 30 ? product.salesUnits : undefined),
      recentSales90:
        demandOverride?.recentSales90 ?? recentSales90Map.get(product.id),
      previousYearTotal,
      benchmarkMonthlyUnits:
        demandOverride?.benchmarkMonthlyUnits ??
        benchmarkMonthlyUnits(benchmarkRows, supplyConfig.competitorCapturePct),
      plannerForecastMonth1Units: forecast.monthly[0]?.forecastUnits,
      useStockoutCorrectedForecast:
        demandOverride?.useStockoutCorrectedForecast === true,
    });

    replenishmentByProductId.set(
      product.id,
      resolveReplenishmentParams({
        productId: product.id,
        demand,
        supplyConfig,
        hasSupplyConfigRow: supplyRow != null,
        supplierProductionDays: product.leadTimeProductionDays ?? null,
        supplierTransitDays: product.leadTimeSeaDays ?? null,
        lastOrderProductionDays: lastOrder?.leadTimeProduccion ?? null,
        lastOrderTransitDays: lastOrder?.leadTimeTransito ?? null,
        moq: product.moq ?? null,
        unitsPerCarton: product.cartonMultiple ?? null,
        calendarEvents,
      }),
    );
  }

  const simulations = products.map((product) => {
    const forecast = forecastByProductId.get(product.id);
    const replenishment = replenishmentByProductId.get(product.id);
    if (!forecast || !replenishment) {
      throw new Error(`Forecast no encontrado para producto ${product.sku}`);
    }
    return simulateSupplyPlan(product, forecast, replenishment, undefined, calendarEvents);
  });

  const purchasePlan = buildPortPurchasePlan(products);
  const annualPurchasePlan = buildAnnualPurchasePlan(
    products,
    forecasts,
    simulations,
    replenishmentByProductId,
  );

  const analyses = products.map((product) =>
    calculatePurchaseRecommendation(product),
  );

  return {
    analyses,
    forecasts,
    simulations,
    replenishmentByProductId,
    annualPurchasePlan,
    stats: buildPlannerStats(
      analyses,
      purchasePlan,
      forecasts,
      simulations,
      annualPurchasePlan,
    ),
    purchasePlan,
  };
}
