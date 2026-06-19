import type {
  DemandForecastResult,
  PlanningProduct,
  SupplySimulationMonthlyLine,
  SupplySimulationResult,
} from "../types/planner.types";
import type { ReplenishmentParams } from "../types/replenishment.types";
import type { DailyReplenishmentSimulation } from "../types/replenishment.types";
import { mergeReplenishmentSimulationMeta } from "./replenishmentSimulation";
import { simulateDailyReplenishment, utcTodayIso } from "./simulateDailyReplenishment";
import { DEFAULT_TARGET_COVERAGE_DAYS } from "./resolveReplenishmentParams";
import type { LogisticsCalendarEventInput } from "./resolveLogisticsCalendarImpact";
import { resolveReplenishmentTiming } from "./resolveReplenishmentTiming";

export { DEFAULT_TARGET_COVERAGE_DAYS };

function mapMonthlyLinesFromDailySim(
  dailySimulation: DailyReplenishmentSimulation,
  monthlyForecast: DemandForecastResult["monthly"],
): SupplySimulationMonthlyLine[] {
  return monthlyForecast.map((line, i) => {
    const monthNum = line.monthIndex;
    const planLine = dailySimulation.monthlyPlan.find(
      (m) => Number(m.month) === monthNum,
    );
    const forecastUnits = line.forecastUnits;
    const openingStock = planLine?.openingPhysicalStock ?? 0;
    const inboundUnits = planLine?.inboundConfirmed ?? 0;
    const inboundUnitsProvisional = planLine?.inboundProvisional ?? 0;
    const closingStock = planLine?.closingPhysicalStock ?? openingStock;
    const stockout =
      (planLine?.lostSalesUnits ?? 0) > 0 || (planLine?.stockoutDays ?? 0) > 0;

    return {
      monthIndex: line.monthIndex ?? i + 1,
      forecastUnits,
      openingStock,
      inboundUnits,
      inboundUnitsProvisional,
      closingStock,
      stockout,
      servedUnits: planLine?.servedUnits,
      lostSalesUnits: planLine?.lostSalesUnits,
      stockoutDays: planLine?.stockoutDays,
    };
  });
}

export function simulateSupplyPlan(
  product: PlanningProduct,
  forecast: DemandForecastResult,
  replenishment: ReplenishmentParams,
  targetCoverageDays: number = DEFAULT_TARGET_COVERAGE_DAYS,
  calendarEvents: LogisticsCalendarEventInput[] = [],
): SupplySimulationResult {
  const monthlyForecast = forecast.monthly;
  const horizonMonths = Math.max(monthlyForecast.length, 1);
  const schedule = product.inboundSchedule ?? [];
  const today = utcTodayIso();

  const timingResult = resolveReplenishmentTiming({
    openingStock: product.stockTotal ?? 0,
    replenishment,
    inboundSchedule: schedule,
    dailyDemandMode: {
      kind: "horizon",
      monthlyLines: monthlyForecast.map((m) => ({
        monthIndex: m.monthIndex,
        forecastUnits: m.forecastUnits,
      })),
      startDate: today,
    },
    calendarEvents,
    horizonDays: Math.max(horizonMonths * 31, 365),
  });

  const dailySimulation = simulateDailyReplenishment({
    startDate: today,
    horizonMonths,
    initialStock: product.stockTotal ?? 0,
    dailyDemand: {
      kind: "horizon",
      monthlyLines: monthlyForecast.map((m) => ({
        monthIndex: m.monthIndex,
        forecastUnits: m.forecastUnits,
      })),
      startDate: today,
    },
    inboundSchedule: schedule,
    reorderPointUnits: replenishment.reorderPointUnits,
    safetyStockUnits: replenishment.safetyStockUnits,
    leadTimeDays: replenishment.leadTimeDays,
    targetCoverageDays: replenishment.targetCoverageDays,
    replenishment,
  });

  const recommendedOrderDate =
    timingResult.latestSafeOrderDate ??
    timingResult.belowReorderPointDate;

  const replenishmentMeta = mergeReplenishmentSimulationMeta(replenishment, {
    belowReorderPointDate: timingResult.belowReorderPointDate,
    belowSafetyStockDate: timingResult.belowSafetyStockDate,
    latestOrderDate: recommendedOrderDate,
    estimatedStockoutDate: timingResult.projectedStockoutDate,
    stockoutDays: timingResult.dailySimulation.stockoutDays,
    estimatedLostSalesUnits: timingResult.dailySimulation.estimatedLostSalesUnits,
    projectedStockAtArrival: timingResult.dailySimulation.projectedStockAtArrival,
    replenishmentStatus: timingResult.replenishmentStatus,
    warnings: timingResult.warnings,
    timing: {
      projectedStockoutDate: timingResult.projectedStockoutDate,
      belowSafetyStockDate: timingResult.belowSafetyStockDate,
      belowReorderPointDate: timingResult.belowReorderPointDate,
      requiredArrivalDate: timingResult.requiredArrivalDate,
      latestSafeOrderDate: timingResult.latestSafeOrderDate,
      orderTodayEta: timingResult.orderTodayEta,
      orderTodayCalendarDelayDays: timingResult.orderTodayCalendarDelayDays,
      orderTodayLostSalesBeforeArrival:
        timingResult.orderTodayLostSalesBeforeArrival,
      orderTodayCalendarEvents: timingResult.orderTodayCalendarEvents,
      isOrderAlreadyLate: timingResult.isOrderAlreadyLate,
    },
  });

  if (monthlyForecast.length === 0) {
    return {
      productId: product.id,
      sku: product.sku,
      months: [],
      stockoutMonthIndex: null,
      estimatedStockoutDate: timingResult.projectedStockoutDate,
      recommendedOrderDate,
      needsReplenishment:
        replenishmentMeta.replenishmentStatus === "URGENT" ||
        replenishmentMeta.replenishmentStatus === "OVERDUE" ||
        replenishmentMeta.replenishmentStatus === "DUE",
      targetCoverageDays,
      replenishment: replenishmentMeta,
      dailySimulation,
    };
  }

  const months = mapMonthlyLinesFromDailySim(dailySimulation, monthlyForecast);

  let stockoutMonthIndex: number | null = null;
  for (const line of months) {
    if (line.stockout && stockoutMonthIndex == null) {
      stockoutMonthIndex = line.monthIndex;
    }
  }

  const needsReplenishment =
    replenishmentMeta.replenishmentStatus === "URGENT" ||
    replenishmentMeta.replenishmentStatus === "OVERDUE" ||
    replenishmentMeta.replenishmentStatus === "DUE" ||
    stockoutMonthIndex != null ||
    (timingResult.orderTodayLostSalesBeforeArrival ?? 0) > 0;

  return {
    productId: product.id,
    sku: product.sku,
    months,
    stockoutMonthIndex,
    estimatedStockoutDate: timingResult.projectedStockoutDate,
    recommendedOrderDate,
    needsReplenishment,
    targetCoverageDays,
    replenishment: replenishmentMeta,
    dailySimulation,
  };
}
