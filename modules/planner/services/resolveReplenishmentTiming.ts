import type { ForecastInboundScheduleEntry } from "../types/forecastInbound.types";
import type {
  ReplenishmentOrderTimingStatus,
  ReplenishmentParams,
  ReplenishmentTiming,
} from "../types/replenishment.types";
import { resolveLatestOrderDateForArrival } from "./resolveLatestOrderDateForArrival";
import {
  type LogisticsCalendarEventInput,
  resolveLogisticsCalendarImpact,
} from "./resolveLogisticsCalendarImpact";
import {
  type DailyDemandMode,
  calendarDaysDifferenceUtc,
  simulateDailyReplenishment,
  utcTodayIso,
} from "./simulateDailyReplenishment";
import { resolveInboundAwareTimingExtensions } from "./resolveInboundAwareTiming";

export type ResolveReplenishmentTimingInput = {
  openingStock: number;
  replenishment: ReplenishmentParams;
  inboundSchedule?: ForecastInboundScheduleEntry[];
  dailyDemandMode: DailyDemandMode;
  calendarEvents?: LogisticsCalendarEventInput[];
  originCountry?: string;
  horizonDays?: number;
  orderDate?: string;
};

function earliestIsoDate(dates: Array<string | null | undefined>): string | null {
  const valid = dates
    .filter((d): d is string => d != null && d !== "")
    .sort();
  return valid[0] ?? null;
}

function deriveReplenishmentStatus(params: {
  openingStock: number;
  reorderPointUnits: number;
  latestSafeOrderDate: string | null;
  today: string;
}): ReplenishmentOrderTimingStatus {
  const { openingStock, reorderPointUnits, latestSafeOrderDate, today } =
    params;

  if (latestSafeOrderDate != null && latestSafeOrderDate < today) {
    return openingStock <= reorderPointUnits ? "URGENT" : "OVERDUE";
  }
  if (openingStock <= reorderPointUnits) return "URGENT";
  if (latestSafeOrderDate != null) {
    const daysAhead = calendarDaysDifferenceUtc(today, latestSafeOrderDate);
    if (daysAhead <= 7) return "DUE";
  }
  return "OK";
}

function buildDailyDemandMode(
  replenishment: ReplenishmentParams,
  monthlyForecastLines?: Array<{ monthIndex: number; forecastUnits: number }>,
  startDate?: string,
): DailyDemandMode {
  if (monthlyForecastLines && monthlyForecastLines.length > 0) {
    return {
      kind: "horizon",
      monthlyLines: monthlyForecastLines,
      startDate: startDate ?? utcTodayIso(),
    };
  }
  return { kind: "uniform", dailyDemand: replenishment.dailyDemand };
}

export function resolveReplenishmentTiming(
  input: ResolveReplenishmentTimingInput,
): ReplenishmentTiming & {
  replenishmentStatus: ReplenishmentOrderTimingStatus;
  dailySimulation: ReturnType<typeof simulateDailyReplenishment>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const today = input.orderDate ?? utcTodayIso();
  const calendarEvents = input.calendarEvents ?? [];
  const { replenishment, openingStock } = input;
  const horizonDays = input.horizonDays ?? 365;

  if (replenishment.dailyDemand <= 0 || replenishment.reorderPointUnits <= 0) {
    const emptySim = simulateDailyReplenishment({
      startDate: today,
      horizonDays: 1,
      initialStock: openingStock,
      dailyDemand: { kind: "uniform", dailyDemand: 0 },
      inboundSchedule: input.inboundSchedule ?? [],
      reorderPointUnits: replenishment.reorderPointUnits,
      safetyStockUnits: replenishment.safetyStockUnits,
      leadTimeDays: replenishment.leadTimeDays,
      targetCoverageDays: replenishment.targetCoverageDays,
    });

    warnings.push(
      "Sin demanda o punto de pedido no calculable; no se estima fecha límite.",
    );

    const inboundAware = resolveInboundAwareTimingExtensions({
      openingStock,
      replenishment,
      inboundSchedule: input.inboundSchedule ?? [],
      dailyDemandMode: input.dailyDemandMode,
      orderTodayEta: null,
      today,
    });

    return {
      projectedStockoutDate: inboundAware.currentStockout ? today : null,
      belowSafetyStockDate: null,
      belowReorderPointDate: null,
      requiredArrivalDate: null,
      latestSafeOrderDate: null,
      orderTodayEta: null,
      orderTodayCalendarDelayDays: 0,
      orderTodayLostSalesBeforeArrival: 0,
      orderTodayCalendarEvents: [],
      isOrderAlreadyLate: false,
      ...inboundAware,
      replenishmentStatus: "OK",
      dailySimulation: emptySim,
      warnings,
    };
  }

  const dailySimulation = simulateDailyReplenishment({
    startDate: today,
    horizonDays,
    initialStock: openingStock,
    dailyDemand: input.dailyDemandMode,
    inboundSchedule: input.inboundSchedule ?? [],
    reorderPointUnits: replenishment.reorderPointUnits,
    safetyStockUnits: replenishment.safetyStockUnits,
    leadTimeDays: replenishment.leadTimeDays,
    targetCoverageDays: replenishment.targetCoverageDays,
    replenishment,
    monthlyPlanMonths: [],
  });

  let projectedStockoutDate = dailySimulation.estimatedStockoutDate;
  const belowSafetyStockDate = dailySimulation.belowSafetyStockDate;
  const belowReorderPointDate = dailySimulation.belowReorderPointDate;

  let requiredArrivalDate = earliestIsoDate([
    projectedStockoutDate,
    belowSafetyStockDate,
  ]);

  if (requiredArrivalDate == null && openingStock <= replenishment.safetyStockUnits) {
    requiredArrivalDate = today;
  }

  let latestSafeOrderDate: string | null = null;
  let backwardWarnings: string[] = [];

  if (requiredArrivalDate != null) {
    const backward = resolveLatestOrderDateForArrival({
      requiredArrivalDate,
      productionDays: replenishment.productionDays,
      transitDays: replenishment.transitDays,
      customsDays: replenishment.customsDays,
      domesticDays: replenishment.domesticDays,
      calendarEvents,
      originCountry: input.originCountry,
    });
    latestSafeOrderDate = backward.latestOrderDate;
    backwardWarnings = backward.warnings;
  }

  const orderTodayImpact = resolveLogisticsCalendarImpact({
    orderDate: today,
    productionDays: replenishment.productionDays,
    transitDays: replenishment.transitDays,
    customsDays: replenishment.customsDays,
    events: calendarEvents,
    originCountry: input.originCountry,
  });

  const orderTodayEta = orderTodayImpact.etaFinal;
  const daysUntilEta =
    calendarDaysDifferenceUtc(today, orderTodayEta) + 1;

  const lostSalesSim = simulateDailyReplenishment({
    startDate: today,
    horizonDays: Math.max(daysUntilEta, 1),
    initialStock: openingStock,
    dailyDemand: input.dailyDemandMode,
    inboundSchedule: input.inboundSchedule ?? [],
    reorderPointUnits: Number.MAX_SAFE_INTEGER,
    safetyStockUnits: 0,
    leadTimeDays: replenishment.leadTimeDays,
    targetCoverageDays: replenishment.targetCoverageDays,
    monthlyPlanMonths: [],
  });

  const isOrderAlreadyLate =
    latestSafeOrderDate != null && latestSafeOrderDate < today;

  const replenishmentStatus = deriveReplenishmentStatus({
    openingStock,
    reorderPointUnits: replenishment.reorderPointUnits,
    latestSafeOrderDate,
    today,
  });

  if (isOrderAlreadyLate) {
    warnings.push("Fecha límite de pedido vencida.");
  }
  if (replenishmentStatus === "URGENT") {
    warnings.push("Stock actual por debajo del punto de pedido; pedido urgente.");
  }
  for (const w of [...dailySimulation.warnings, ...backwardWarnings, ...orderTodayImpact.warnings]) {
    if (!warnings.includes(w)) warnings.push(w);
  }

  const inboundAware = resolveInboundAwareTimingExtensions({
    openingStock,
    replenishment,
    inboundSchedule: input.inboundSchedule ?? [],
    dailyDemandMode: input.dailyDemandMode,
    orderTodayEta,
    today,
  });

  if (inboundAware.currentStockout && projectedStockoutDate == null) {
    projectedStockoutDate = today;
  }

  return {
    projectedStockoutDate,
    belowSafetyStockDate,
    belowReorderPointDate,
    requiredArrivalDate,
    latestSafeOrderDate,
    orderTodayEta,
    orderTodayCalendarDelayDays: orderTodayImpact.delayDays,
    orderTodayLostSalesBeforeArrival: lostSalesSim.estimatedLostSalesUnits,
    orderTodayCalendarEvents: orderTodayImpact.events,
    isOrderAlreadyLate,
    ...inboundAware,
    replenishmentStatus,
    dailySimulation,
    warnings,
  };
}

export { buildDailyDemandMode };
