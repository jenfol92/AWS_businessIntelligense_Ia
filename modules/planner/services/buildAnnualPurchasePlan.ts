import type {
  AnnualPurchasePlanLine,
  AnnualPurchasePlanResult,
  DemandForecastResult,
  PlanningProduct,
  SupplySimulationResult,
} from "../types/planner.types";
import type { ReplenishmentParams } from "../types/replenishment.types";
import {
  applyMoqAndCartonToQuantity,
  computeProjectedStockAtArrival,
  computeRecommendedUnits,
  DEFAULT_TARGET_COVERAGE_DAYS,
} from "./resolveReplenishmentParams";

function addCalendarDaysToIsoDate(
  isoDate: string,
  days: number,
): string | null {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function utcTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function calendarDaysDifferenceUtc(fromIso: string, toIso: string): number {
  const fromMs = Date.parse(`${fromIso.slice(0, 10)}T00:00:00.000Z`);
  const toMs = Date.parse(`${toIso.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  return Math.round((toMs - fromMs) / 86400000);
}

function orderTimingFromRecommendedDate(recommendedOrderDate: string | null): {
  orderTimingStatus: "ON_TIME" | "DUE_NOW" | "OVERDUE";
  daysLate: number;
} {
  if (recommendedOrderDate == null || recommendedOrderDate === "") {
    return { orderTimingStatus: "ON_TIME", daysLate: 0 };
  }
  const rec = recommendedOrderDate.slice(0, 10);
  const today = utcTodayIso();

  if (rec < today) {
    return {
      orderTimingStatus: "OVERDUE",
      daysLate: calendarDaysDifferenceUtc(rec, today),
    };
  }
  if (rec === today) {
    return { orderTimingStatus: "DUE_NOW", daysLate: 0 };
  }
  const daysAhead = calendarDaysDifferenceUtc(today, rec);
  if (daysAhead > 0 && daysAhead <= 7) {
    return { orderTimingStatus: "DUE_NOW", daysLate: 0 };
  }
  return { orderTimingStatus: "ON_TIME", daysLate: 0 };
}

function consolidationEligibleForProduct(product: PlanningProduct): boolean {
  return product.logisticsRestriction?.allowsConsolidation !== false;
}

export function buildAnnualPurchasePlan(
  products: PlanningProduct[],
  forecasts: DemandForecastResult[],
  simulations: SupplySimulationResult[],
  replenishmentByProductId: Map<string, ReplenishmentParams>,
  targetCoverageDays: number = DEFAULT_TARGET_COVERAGE_DAYS,
): AnnualPurchasePlanResult {
  const productById = new Map(products.map((p) => [p.id, p]));
  const forecastById = new Map(forecasts.map((f) => [f.productId, f]));
  const simulationById = new Map(simulations.map((s) => [s.productId, s]));

  const lines: AnnualPurchasePlanLine[] = [];
  let totalRecommendedUnits = 0;
  let totalRecommendedCbm = 0;
  let totalRecommendedWeightKg = 0;
  let totalPurchaseCapitalRequired = 0;
  let totalEstimatedRevenueAtSalePrice = 0;
  let totalEstimatedGrossMarginValue = 0;
  let capitalAlreadyCommitted = 0;

  for (const product of products) {
    capitalAlreadyCommitted += product.capitalAlreadyCommitted ?? 0;
  }

  for (const simulation of simulations) {
    if (!simulation.needsReplenishment) continue;

    const product = productById.get(simulation.productId);
    const forecast = forecastById.get(simulation.productId);
    const replenishment = replenishmentByProductId.get(simulation.productId);
    if (!product || !forecast || !replenishment) continue;
    if (replenishment.dailyDemand <= 0) continue;

    const projectedStockAtArrival = computeProjectedStockAtArrival({
      currentStock: product.stockTotal ?? 0,
      dailyDemand: replenishment.dailyDemand,
      leadTimeDays: replenishment.leadTimeDays,
      inboundSchedule: product.inboundSchedule,
      monthlyForecastLines: forecast.monthly.map((m) => ({
        monthIndex: m.monthIndex,
        forecastUnits: m.forecastUnits,
      })),
    });

    const breakdown = computeRecommendedUnits({
      replenishment,
      projectedStockAtArrival,
    });

    if (breakdown.rawRecommendedUnits <= 0) continue;

    const { quantity, moqApplied, cartonMultipleApplied } =
      applyMoqAndCartonToQuantity(
        breakdown.rawRecommendedUnits,
        replenishment.moq,
        replenishment.unitsPerCarton,
      );

    breakdown.roundedRecommendedUnits = quantity;

    const averageDailySales = forecast.averageDailySales;
    const projectedStock = projectedStockAtArrival + quantity;
    const expectedCoverageDaysAfterOrder =
      averageDailySales > 0 ? projectedStock / averageDailySales : null;

    const recommendedOrderDate =
      simulation.replenishment?.timing?.latestSafeOrderDate ??
      simulation.replenishment?.latestOrderDate ??
      simulation.recommendedOrderDate;
    const leadDays = replenishment.leadTimeDays;
    const today = utcTodayIso();
    const timing = simulation.replenishment?.timing;
    const estimatedArrivalDate =
      timing?.orderTodayEta != null &&
      (recommendedOrderDate == null ||
        recommendedOrderDate <= today ||
        timing.isOrderAlreadyLate)
        ? timing.orderTodayEta
        : recommendedOrderDate != null && recommendedOrderDate !== ""
          ? addCalendarDaysToIsoDate(recommendedOrderDate, leadDays)
          : timing?.orderTodayEta ?? null;

    const cbmPer = product.cbmPerUnit;
    const weightPer = product.weightKg;
    const cbmTotal =
      cbmPer != null && Number.isFinite(cbmPer) ? quantity * cbmPer : null;
    const weightKgTotal =
      weightPer != null && Number.isFinite(weightPer)
        ? quantity * weightPer
        : null;

    const { orderTimingStatus, daysLate } =
      orderTimingFromRecommendedDate(recommendedOrderDate);

    const unitPurchaseCost = product.purchaseCost ?? null;
    const purchaseCapitalRequired =
      unitPurchaseCost != null ? quantity * unitPurchaseCost : null;

    const unitSalePrice = product.salePrice ?? null;
    const estimatedRevenueAtSalePrice =
      unitSalePrice != null ? quantity * unitSalePrice : null;

    const estimatedGrossMarginValue =
      estimatedRevenueAtSalePrice != null && purchaseCapitalRequired != null
        ? estimatedRevenueAtSalePrice - purchaseCapitalRequired
        : null;

    lines.push({
      productId: product.id,
      sku: product.sku,
      productName: product.nombre,
      recommendedOrderUnits: quantity,
      recommendedOrderDate,
      estimatedArrivalDate,
      targetCoverageDays: replenishment.targetCoverageDays,
      expectedCoverageDaysAfterOrder,
      moqApplied,
      cartonMultipleApplied,
      cbmTotal,
      weightKgTotal,
      unitPurchaseCost,
      purchaseCapitalRequired,
      estimatedRevenueAtSalePrice,
      estimatedGrossMarginValue,
      supplierId: product.supplierId,
      supplierName: product.supplierName,
      agentId: product.agentId,
      agentName: product.agentName,
      originPortId: product.originPortId,
      consolidationEligible: consolidationEligibleForProduct(product),
      orderTimingStatus,
      daysLate,
      recommendationBreakdown: breakdown,
      replenishmentWarnings: replenishment.warnings,
    });

    totalRecommendedUnits += quantity;
    totalRecommendedCbm += cbmTotal ?? 0;
    totalRecommendedWeightKg += weightKgTotal ?? 0;
    totalPurchaseCapitalRequired += purchaseCapitalRequired ?? 0;
    totalEstimatedRevenueAtSalePrice += estimatedRevenueAtSalePrice ?? 0;
    totalEstimatedGrossMarginValue += estimatedGrossMarginValue ?? 0;
  }

  return {
    lines,
    totalRecommendedUnits,
    totalRecommendedCbm,
    totalRecommendedWeightKg,
    productsToOrder: lines.length,
    totalPurchaseCapitalRequired,
    totalEstimatedRevenueAtSalePrice,
    totalEstimatedGrossMarginValue,
    capitalAlreadyCommitted,
    additionalCapitalRequired: totalPurchaseCapitalRequired,
    totalCapitalExposure:
      capitalAlreadyCommitted + totalPurchaseCapitalRequired,
  };
}
