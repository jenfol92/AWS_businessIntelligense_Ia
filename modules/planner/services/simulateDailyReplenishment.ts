import type { ForecastInboundScheduleEntry } from "../types/forecastInbound.types";
import { scheduleEntryUsableForPlanning } from "./resolveInboundPlanningKind";
import type {
  DailyReplenishmentMonthlyPlanLine,
  DailyReplenishmentSimulation,
  ReplenishmentOrderTimingStatus,
} from "../types/replenishment.types";
import type { ReplenishmentParams } from "../types/replenishment.types";
import { computeRecommendedUnits } from "./resolveReplenishmentParams";

export function utcTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addUtcDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function calendarDaysDifferenceUtc(fromIso: string, toIso: string): number {
  const fromMs = Date.parse(`${fromIso.slice(0, 10)}T00:00:00.000Z`);
  const toMs = Date.parse(`${toIso.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  return Math.round((toMs - fromMs) / 86400000);
}

export function daysInCalendarMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function parseIsoParts(isoDate: string): { year: number; month: number; day: number } {
  return {
    year: Number(isoDate.slice(0, 4)),
    month: Number(isoDate.slice(5, 7)),
    day: Number(isoDate.slice(8, 10)),
  };
}

function inboundUnitsOnDate(
  schedule: ForecastInboundScheduleEntry[],
  isoDate: string,
  filter?: "planning" | "confirmed" | "provisional" | "ignored",
): number {
  let total = 0;
  for (const entry of schedule) {
    const usable = scheduleEntryUsableForPlanning(entry);
    if (filter === "planning" && !usable) continue;
    if (filter === "confirmed" && entry.confidence !== "confirmed") continue;
    if (filter === "provisional" && entry.confidence !== "provisional") continue;
    if (filter === "ignored" && usable) continue;
    if (entry.eta.slice(0, 10) !== isoDate.slice(0, 10)) continue;
    total += entry.units;
  }
  return total;
}

export type DailyDemandMode =
  | {
      kind: "calendar_year";
      monthlyForecast: number[];
      forecastYear: number;
    }
  | {
      kind: "horizon";
      monthlyLines: Array<{ monthIndex: number; forecastUnits: number }>;
      startDate: string;
    }
  | {
      kind: "uniform";
      dailyDemand: number;
    };

function horizonMonthIndexFromStart(startIso: string, dateIso: string): number | null {
  const start = parseIsoParts(startIso);
  const date = parseIsoParts(dateIso);
  const diff =
    (date.year - start.year) * 12 + (date.month - start.month) + 1;
  return diff >= 1 ? diff : null;
}

export function buildDailyDemandResolver(mode: DailyDemandMode): (isoDate: string) => number {
  if (mode.kind === "uniform") {
    const daily = Math.max(0, mode.dailyDemand);
    return () => daily;
  }

  if (mode.kind === "calendar_year") {
    return (isoDate: string) => {
      const { year, month } = parseIsoParts(isoDate);
      if (year !== mode.forecastYear || month < 1 || month > 12) return 0;
      const units = mode.monthlyForecast[month - 1] ?? 0;
      const dim = daysInCalendarMonth(year, month);
      return dim > 0 ? units / dim : 0;
    };
  }

  return (isoDate: string) => {
    const horizonMonth = horizonMonthIndexFromStart(mode.startDate, isoDate);
    if (horizonMonth == null) return 0;
    const line = mode.monthlyLines.find((m) => m.monthIndex === horizonMonth);
    const units = line?.forecastUnits ?? 0;
    const { year, month } = parseIsoParts(isoDate);
    const dim = daysInCalendarMonth(year, month);
    return dim > 0 ? units / dim : 0;
  };
}

export type SimulateDailyReplenishmentInput = {
  startDate: string;
  horizonMonths?: number;
  horizonDays?: number;
  initialStock: number;
  dailyDemand: DailyDemandMode;
  previousYearMonthly?: number[];
  inboundSchedule?: ForecastInboundScheduleEntry[];
  reorderPointUnits: number;
  safetyStockUnits: number;
  leadTimeDays: number;
  targetCoverageDays: number;
  replenishment?: ReplenishmentParams | null;
  unitCostEur?: number | null;
  includeProvisionalInbound?: boolean;
  monthlyPlanMonths?: number[];
  monthReason?: (
    lostSalesUnits: number,
    closingPhysicalStock: number,
    forecastUnits: number,
  ) => string;
};

type MonthBucket = {
  month: number;
  previousYearSales: number;
  forecastUnits: number;
  openingPhysicalStock: number | null;
  inboundConfirmed: number;
  inboundProvisional: number;
  servedUnits: number;
  lostSalesUnits: number;
  closingPhysicalStock: number;
  stockoutDays: number;
  stockoutStartDate: string | null;
  stockoutEndDate: string | null;
  belowReorderPointDate: string | null;
  monthlyInboundFirstDate: string | null;
  lostSalesBeforeFirstInbound: number;
  servedAfterInbound: number;
  stockAfterInbound: number | null;
};

function resolveReplenishmentStatus(params: {
  openingStock: number;
  reorderPointUnits: number;
  belowReorderPointDate: string | null;
  today: string;
}): ReplenishmentOrderTimingStatus {
  const { openingStock, reorderPointUnits, belowReorderPointDate, today } =
    params;
  if (belowReorderPointDate == null) return "OK";
  if (belowReorderPointDate <= today) {
    return openingStock <= reorderPointUnits ? "URGENT" : "OVERDUE";
  }
  const daysAhead = calendarDaysDifferenceUtc(today, belowReorderPointDate);
  return daysAhead <= 7 ? "DUE" : "OK";
}

function simulationEndDate(input: SimulateDailyReplenishmentInput): string {
  if (input.horizonDays != null && input.horizonDays > 0) {
    return addUtcDays(input.startDate, input.horizonDays - 1);
  }
  const months = input.horizonMonths ?? 12;
  const start = parseIsoParts(input.startDate);
  const endMonth = start.month - 1 + months;
  const endYear = start.year + Math.floor(endMonth / 12);
  const endMonth1 = (endMonth % 12) + 1;
  const lastDay = daysInCalendarMonth(endYear, endMonth1);
  return `${endYear}-${String(endMonth1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

function forecastUnitsForCalendarMonth(
  mode: DailyDemandMode,
  year: number,
  month: number,
): number {
  if (mode.kind === "calendar_year") {
    if (year !== mode.forecastYear) return 0;
    return mode.monthlyForecast[month - 1] ?? 0;
  }
  if (mode.kind === "uniform") {
    const dim = daysInCalendarMonth(year, month);
    return mode.dailyDemand * dim;
  }
  const start = parseIsoParts(mode.startDate);
  const diff = (year - start.year) * 12 + (month - start.month) + 1;
  const line = mode.monthlyLines.find((m) => m.monthIndex === diff);
  return line?.forecastUnits ?? 0;
}

type PhysicalDayResult = {
  stock: number;
  servedDemand: number;
  lostSales: number;
  availableBeforeDemand: number;
  inboundConfirmed: number;
  inboundProvisional: number;
  dailyDemand: number;
};

function simulatePhysicalDay(params: {
  stock: number;
  isoDate: string;
  schedule: ForecastInboundScheduleEntry[];
  getDailyDemand: (isoDate: string) => number;
  includeProvisional: boolean;
}): PhysicalDayResult {
  const inboundPlanning = inboundUnitsOnDate(
    params.schedule,
    params.isoDate,
    "planning",
  );
  const inboundProvisional = inboundUnitsOnDate(
    params.schedule,
    params.isoDate,
    "ignored",
  );
  const availableBeforeDemand =
    params.stock +
    inboundPlanning +
    (params.includeProvisional ? inboundProvisional : 0);
  const dailyDemand = params.getDailyDemand(params.isoDate);
  const servedDemand = Math.min(availableBeforeDemand, dailyDemand);
  const lostSales = Math.max(0, dailyDemand - availableBeforeDemand);
  const stock = Math.max(0, availableBeforeDemand - dailyDemand);

  return {
    stock,
    servedDemand,
    lostSales,
    availableBeforeDemand,
    inboundConfirmed: inboundPlanning,
    inboundProvisional,
    dailyDemand,
  };
}

function simulateClosingStockAfterDays(
  input: SimulateDailyReplenishmentInput,
  days: number,
  fromDate: string,
  initialStock: number,
): number {
  if (days <= 0) return Math.max(0, initialStock);
  const schedule = input.inboundSchedule ?? [];
  const getDailyDemand = buildDailyDemandResolver(input.dailyDemand);
  const includeProvisional = input.includeProvisionalInbound === true;

  let stock = Math.max(0, initialStock);
  let currentDate = fromDate.slice(0, 10);
  for (let i = 0; i < days; i += 1) {
    const day = simulatePhysicalDay({
      stock,
      isoDate: currentDate,
      schedule,
      getDailyDemand,
      includeProvisional,
    });
    stock = day.stock;
    currentDate = addUtcDays(currentDate, 1);
  }
  return stock;
}

export function simulateDailyReplenishment(
  input: SimulateDailyReplenishmentInput,
): DailyReplenishmentSimulation {
  const warnings: string[] = [];
  const schedule = input.inboundSchedule ?? [];
  const getDailyDemand = buildDailyDemandResolver(input.dailyDemand);
  const today = utcTodayIso();
  const endDate = simulationEndDate(input);
  const includeProvisional = input.includeProvisionalInbound === true;

  let stock = Math.max(0, input.initialStock);
  let estimatedStockoutDate: string | null = null;
  let stockoutStartDate: string | null = null;
  let stockoutEndDate: string | null = null;
  let stockoutDays = 0;
  let estimatedLostSalesUnits = 0;
  let belowReorderPointDate: string | null = null;
  let belowSafetyStockDate: string | null = null;

  const buckets = new Map<number, MonthBucket>();
  const planMonths =
    input.monthlyPlanMonths ??
    (input.dailyDemand.kind === "horizon"
      ? Array.from(
          { length: input.dailyDemand.monthlyLines.length || 12 },
          (_, i) => i + 1,
        )
      : Array.from({ length: 12 }, (_, i) => i + 1));

  for (const month of planMonths) {
    buckets.set(month, {
      month,
      previousYearSales: input.previousYearMonthly?.[month - 1] ?? 0,
      forecastUnits: 0,
      openingPhysicalStock: null,
      inboundConfirmed: 0,
      inboundProvisional: 0,
      servedUnits: 0,
      lostSalesUnits: 0,
      closingPhysicalStock: 0,
      stockoutDays: 0,
      stockoutStartDate: null,
      stockoutEndDate: null,
      belowReorderPointDate: null,
      monthlyInboundFirstDate: null,
      lostSalesBeforeFirstInbound: 0,
      servedAfterInbound: 0,
      stockAfterInbound: null,
    });
  }

  let currentDate = input.startDate.slice(0, 10);
  let activeBucketKey = -1;

  while (currentDate <= endDate) {
    const bucketKey =
      input.dailyDemand.kind === "horizon"
        ? (horizonMonthIndexFromStart(input.dailyDemand.startDate, currentDate) ??
          -1)
        : parseIsoParts(currentDate).month;
    const bucket = bucketKey > 0 ? buckets.get(bucketKey) : undefined;

    if (bucket && bucketKey !== activeBucketKey) {
      bucket.openingPhysicalStock = stock;
      activeBucketKey = bucketKey;
    }

    const day = simulatePhysicalDay({
      stock,
      isoDate: currentDate,
      schedule,
      getDailyDemand,
      includeProvisional,
    });

    if (belowReorderPointDate == null && day.availableBeforeDemand <= input.reorderPointUnits) {
      belowReorderPointDate = currentDate;
    }
    if (belowSafetyStockDate == null && day.availableBeforeDemand <= input.safetyStockUnits) {
      belowSafetyStockDate = currentDate;
    }
    if (estimatedStockoutDate == null && day.lostSales > 0) {
      estimatedStockoutDate = currentDate;
    }

    if (day.lostSales > 0) {
      estimatedLostSalesUnits += day.lostSales;
      stockoutDays += 1;
      if (stockoutStartDate == null) stockoutStartDate = currentDate;
      stockoutEndDate = currentDate;
      if (bucket) {
        bucket.stockoutDays += 1;
        if (bucket.stockoutStartDate == null) bucket.stockoutStartDate = currentDate;
        bucket.stockoutEndDate = currentDate;
      }
    }

    if (bucket) {
      if (
        day.inboundConfirmed > 0 &&
        bucket.monthlyInboundFirstDate == null
      ) {
        bucket.monthlyInboundFirstDate = currentDate;
        bucket.stockAfterInbound = day.stock;
      }

      if (
        bucket.monthlyInboundFirstDate == null ||
        currentDate < bucket.monthlyInboundFirstDate
      ) {
        bucket.lostSalesBeforeFirstInbound += day.lostSales;
      } else {
        bucket.servedAfterInbound += day.servedDemand;
      }

      bucket.inboundConfirmed += day.inboundConfirmed;
      bucket.inboundProvisional += day.inboundProvisional;
      bucket.servedUnits += day.servedDemand;
      bucket.lostSalesUnits += day.lostSales;
      bucket.forecastUnits += day.dailyDemand;
      if (
        bucket.belowReorderPointDate == null &&
        day.availableBeforeDemand <= input.reorderPointUnits
      ) {
        bucket.belowReorderPointDate = currentDate;
      }
      bucket.closingPhysicalStock = day.stock;
    }

    stock = day.stock;
    currentDate = addUtcDays(currentDate, 1);
  }

  const projectedStockAtArrival = Math.round(
    simulateClosingStockAfterDays(
      input,
      Math.max(0, input.leadTimeDays),
      today,
      input.initialStock,
    ),
  );

  let recommendedUnits = 0;
  let capitalRequired: number | null = null;
  if (input.replenishment && input.replenishment.dailyDemand > 0) {
    const breakdown = computeRecommendedUnits({
      replenishment: input.replenishment,
      projectedStockAtArrival,
    });
    recommendedUnits = breakdown.rawRecommendedUnits;
    if (input.unitCostEur != null && Number.isFinite(input.unitCostEur)) {
      capitalRequired = recommendedUnits * input.unitCostEur;
    }
  }

  const replenishmentStatus = resolveReplenishmentStatus({
    openingStock: input.initialStock,
    reorderPointUnits: input.reorderPointUnits,
    belowReorderPointDate,
    today,
  });

  if (replenishmentStatus === "URGENT") {
    warnings.push("Stock actual por debajo del punto de pedido; pedido urgente.");
  } else if (replenishmentStatus === "OVERDUE") {
    warnings.push("Fecha límite de pedido vencida.");
  }
  if (estimatedStockoutDate != null && !includeProvisional) {
    const provBeforeStockout = schedule.some(
      (e) =>
        e.confidence === "provisional" &&
        e.eta.slice(0, 10) <= (estimatedStockoutDate ?? "") &&
        e.eta.slice(0, 10) >= today,
    );
    if (provBeforeStockout) {
      warnings.push(
        "Hay inbound provisional antes de la rotura estimada; no evita la rotura crítica (solo confirmado cuenta).",
      );
    }
  }

  const forecastYear =
    input.dailyDemand.kind === "calendar_year"
      ? input.dailyDemand.forecastYear
      : parseIsoParts(input.startDate).year;

  const monthlyPlan: DailyReplenishmentMonthlyPlanLine[] = planMonths.map(
    (month) => {
      const bucket = buckets.get(month)!;
      const forecastUnits =
        input.dailyDemand.kind === "horizon"
          ? Math.round(
              input.dailyDemand.monthlyLines.find((m) => m.monthIndex === month)
                ?.forecastUnits ?? bucket.forecastUnits,
            )
          : bucket.forecastUnits > 0
            ? Math.round(bucket.forecastUnits)
            : Math.round(
                forecastUnitsForCalendarMonth(
                  input.dailyDemand,
                  forecastYear,
                  month,
                ),
              );

      let monthRecommended = 0;
      let monthCapital: number | null = null;
      const monthLatestOrderDate: string | null = null;

      const reason =
        input.monthReason?.(
          bucket.lostSalesUnits,
          bucket.closingPhysicalStock,
          forecastUnits,
        ) ??
        (bucket.lostSalesUnits > 0
          ? "STOCKOUT_RISK"
          : bucket.closingPhysicalStock < forecastUnits * 0.25 &&
              forecastUnits > 0
            ? "LOW_STOCK"
            : "PREVIOUS_YEAR_SEASONAL");

      return {
        month: String(month).padStart(2, "0"),
        previousYearSales: bucket.previousYearSales,
        forecastUnits,
        openingPhysicalStock: Math.round(bucket.openingPhysicalStock ?? 0),
        inboundConfirmed: Math.round(bucket.inboundConfirmed),
        inboundProvisional: Math.round(bucket.inboundProvisional),
        servedUnits: Math.round(bucket.servedUnits),
        lostSalesUnits: Math.round(bucket.lostSalesUnits),
        closingPhysicalStock: Math.round(bucket.closingPhysicalStock),
        stockoutDays: bucket.stockoutDays,
        stockoutStartDate: bucket.stockoutStartDate,
        stockoutEndDate: bucket.stockoutEndDate,
        belowReorderPointDate: bucket.belowReorderPointDate,
        monthlyInboundFirstDate: bucket.monthlyInboundFirstDate,
        lostSalesBeforeFirstInbound: Math.round(bucket.lostSalesBeforeFirstInbound),
        servedAfterInbound: Math.round(bucket.servedAfterInbound),
        stockAfterInbound:
          bucket.stockAfterInbound != null
            ? Math.round(bucket.stockAfterInbound)
            : null,
        latestOrderDate: monthLatestOrderDate,
        recommendedPurchaseUnits: monthRecommended,
        capitalRequired: monthCapital,
        reason,
      };
    },
  );

  return {
    estimatedStockoutDate,
    stockoutStartDate,
    stockoutEndDate,
    stockoutDays,
    estimatedLostSalesUnits: Math.round(estimatedLostSalesUnits),
    belowReorderPointDate,
    belowSafetyStockDate,
    latestOrderDate: belowReorderPointDate,
    projectedStockAtArrival,
    closingStock: Math.round(stock),
    replenishmentStatus,
    monthlyPlan,
    warnings,
  };
}

/** Primer día en que el stock disponible cae al punto de pedido (opcionalmente después de una fecha). */
export function findBelowReorderPointDate(
  input: SimulateDailyReplenishmentInput,
  afterDate?: string | null,
): string | null {
  const schedule = input.inboundSchedule ?? [];
  const getDailyDemand = buildDailyDemandResolver(input.dailyDemand);
  const endDate = simulationEndDate(input);
  const includeProvisional = input.includeProvisionalInbound === true;
  const minDate = afterDate?.slice(0, 10) ?? null;

  let stock = Math.max(0, input.initialStock);
  let currentDate = input.startDate.slice(0, 10);

  while (currentDate <= endDate) {
    if (minDate != null && currentDate <= minDate) {
      const daySkip = simulatePhysicalDay({
        stock,
        isoDate: currentDate,
        schedule,
        getDailyDemand,
        includeProvisional,
      });
      stock = daySkip.stock;
      currentDate = addUtcDays(currentDate, 1);
      continue;
    }

    const day = simulatePhysicalDay({
      stock,
      isoDate: currentDate,
      schedule,
      getDailyDemand,
      includeProvisional,
    });

    if (day.availableBeforeDemand <= input.reorderPointUnits) {
      return currentDate;
    }

    stock = day.stock;
    currentDate = addUtcDays(currentDate, 1);
  }

  return null;
}

export function stockoutDayIndexFromDate(
  startDate: string,
  stockoutDate: string | null,
): number | null {
  if (stockoutDate == null) return null;
  const diff = calendarDaysDifferenceUtc(startDate, stockoutDate);
  return diff >= 0 ? diff : null;
}
