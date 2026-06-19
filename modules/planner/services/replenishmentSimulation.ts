import type { ForecastInboundScheduleEntry } from "../types/forecastInbound.types";
import type {
  ReplenishmentOrderTimingStatus,
  ReplenishmentSimulationMeta,
} from "../types/replenishment.types";
import type { ReplenishmentParams } from "../types/replenishment.types";
import {
  simulateDailyReplenishment,
  stockoutDayIndexFromDate,
  utcTodayIso,
} from "./simulateDailyReplenishment";

export function simulateReorderPointTiming(params: {
  openingStock: number;
  dailyDemand: number;
  reorderPointUnits: number;
  safetyStockUnits?: number;
  leadTimeDays?: number;
  inboundSchedule?: ForecastInboundScheduleEntry[];
  horizonDays?: number;
  monthlyForecastLines?: Array<{ monthIndex: number; forecastUnits: number }>;
}): ReplenishmentSimulationMeta & {
  stockoutDayIndex: number | null;
  dailySimulation: ReturnType<typeof simulateDailyReplenishment>;
} {
  const {
    openingStock,
    dailyDemand,
    reorderPointUnits,
    safetyStockUnits = 0,
    leadTimeDays = 0,
    inboundSchedule = [],
    horizonDays = 365,
  } = params;

  if (dailyDemand <= 0 || reorderPointUnits <= 0) {
    const emptySim = simulateDailyReplenishment({
      startDate: utcTodayIso(),
      horizonDays: 1,
      initialStock: openingStock,
      dailyDemand: { kind: "uniform", dailyDemand: 0 },
      reorderPointUnits,
      safetyStockUnits,
      leadTimeDays,
      targetCoverageDays: 90,
      inboundSchedule,
    });
    return {
      leadTimeDays,
      safetyBufferDays: 0,
      leadTimeDemandUnits: 0,
      safetyStockUnits,
      reorderPointUnits,
      belowReorderPointDate: null,
      belowSafetyStockDate: null,
      latestOrderDate: null,
      estimatedStockoutDate: null,
      stockoutDays: 0,
      estimatedLostSalesUnits: 0,
      projectedStockAtArrival: openingStock,
      replenishmentStatus: "OK",
      warnings: [
        "Sin demanda o punto de pedido no calculable; no se estima fecha límite.",
      ],
      stockoutDayIndex: null,
      dailySimulation: emptySim,
    };
  }

  const today = utcTodayIso();
  const dailyDemandMode =
    params.monthlyForecastLines && params.monthlyForecastLines.length > 0
      ? {
          kind: "horizon" as const,
          monthlyLines: params.monthlyForecastLines,
          startDate: today,
        }
      : { kind: "uniform" as const, dailyDemand };

  const dailySimulation = simulateDailyReplenishment({
    startDate: today,
    horizonDays,
    initialStock: openingStock,
    dailyDemand: dailyDemandMode,
    inboundSchedule,
    reorderPointUnits,
    safetyStockUnits,
    leadTimeDays,
    targetCoverageDays: 90,
    monthlyPlanMonths: [],
  });

  const stockoutDayIndex = stockoutDayIndexFromDate(
    today,
    dailySimulation.estimatedStockoutDate,
  );

  return {
    leadTimeDays,
    safetyBufferDays: 0,
    leadTimeDemandUnits: 0,
    safetyStockUnits,
    reorderPointUnits,
    belowReorderPointDate: dailySimulation.belowReorderPointDate,
    belowSafetyStockDate: dailySimulation.belowSafetyStockDate,
    latestOrderDate: dailySimulation.latestOrderDate,
    estimatedStockoutDate: dailySimulation.estimatedStockoutDate,
    stockoutDays: dailySimulation.stockoutDays,
    estimatedLostSalesUnits: dailySimulation.estimatedLostSalesUnits,
    projectedStockAtArrival: dailySimulation.projectedStockAtArrival,
    replenishmentStatus: dailySimulation.replenishmentStatus,
    warnings: dailySimulation.warnings,
    stockoutDayIndex,
    dailySimulation,
  };
}

export function mergeReplenishmentSimulationMeta(
  replenishment: ReplenishmentParams,
  timing: Omit<
    ReplenishmentSimulationMeta,
    | "leadTimeDays"
    | "safetyBufferDays"
    | "leadTimeDemandUnits"
    | "safetyStockUnits"
    | "reorderPointUnits"
  >,
): ReplenishmentSimulationMeta {
  return {
    leadTimeDays: replenishment.leadTimeDays,
    safetyBufferDays: replenishment.safetyBufferDays,
    leadTimeDemandUnits: replenishment.leadTimeDemandUnits,
    safetyStockUnits: replenishment.safetyStockUnits,
    reorderPointUnits: replenishment.reorderPointUnits,
    belowReorderPointDate: timing.belowReorderPointDate,
    belowSafetyStockDate: timing.belowSafetyStockDate,
    latestOrderDate: timing.latestOrderDate,
    estimatedStockoutDate: timing.estimatedStockoutDate,
    stockoutDays: timing.stockoutDays,
    estimatedLostSalesUnits: timing.estimatedLostSalesUnits,
    projectedStockAtArrival: timing.projectedStockAtArrival,
    replenishmentStatus: timing.replenishmentStatus,
    timing: timing.timing,
    warnings: [...replenishment.warnings, ...timing.warnings],
  };
}
