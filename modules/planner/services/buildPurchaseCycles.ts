import type { ForecastInboundScheduleEntry } from "../types/forecastInbound.types";
import type {
  PurchaseCycle,
  PurchaseCyclePlan,
  PurchaseCycleReason,
  PurchaseCycleStatus,
  ReplenishmentParams,
} from "../types/replenishment.types";
import { resolveLatestOrderDateForArrival } from "./resolveLatestOrderDateForArrival";
import {
  aggregateScheduleByEta,
  scheduleEntryUsableForPlanning,
} from "./resolveInboundPlanningKind";
import {
  type DailyDemandMode,
  addUtcDays,
  buildDailyDemandResolver,
  calendarDaysDifferenceUtc,
  findBelowReorderPointDate,
  simulateDailyReplenishment,
  utcTodayIso,
} from "./simulateDailyReplenishment";
import { applyMoqAndCartonToQuantity } from "./resolveReplenishmentParams";
import {
  type LogisticsCalendarEventInput,
  resolveLogisticsCalendarImpact,
} from "./resolveLogisticsCalendarImpact";
import {
  buildCalendarPreventiveCycles,
  orderOverlapsPreventiveEvent,
} from "./resolveCalendarPreventiveCycles";

export type BuildPurchaseCyclesInput = {
  initialStock: number;
  dailyDemand: DailyDemandMode;
  inboundSchedule?: ForecastInboundScheduleEntry[];
  replenishment: ReplenishmentParams;
  productionDays: number;
  transitDays: number;
  customsDays: number;
  calendarEvents: LogisticsCalendarEventInput[];
  unitCostEur?: number | null;
  /** Capital ya comprometido en inbound confirmado (uds × coste). */
  capitalAlreadyCommitted?: number | null;
  horizonDays?: number;
  maxCycles?: number;
  startDate?: string;
};

function monthFromIso(iso: string): number {
  return Number(iso.slice(5, 7));
}

function earliestIsoDate(dates: Array<string | null | undefined>): string | null {
  const valid = dates.filter((d): d is string => d != null && d !== "").sort();
  return valid[0] ?? null;
}

function baseSimInput(
  input: BuildPurchaseCyclesInput,
  schedule: ForecastInboundScheduleEntry[],
  startDate: string,
  initialStock?: number,
) {
  return {
    startDate,
    horizonDays: input.horizonDays ?? 365,
    initialStock: initialStock ?? input.initialStock,
    dailyDemand: input.dailyDemand,
    inboundSchedule: schedule,
    reorderPointUnits: input.replenishment.reorderPointUnits,
    safetyStockUnits: input.replenishment.safetyStockUnits,
    leadTimeDays: input.replenishment.leadTimeDays,
    targetCoverageDays: input.replenishment.targetCoverageDays,
    replenishment: input.replenishment,
    unitCostEur: input.unitCostEur,
    monthlyPlanMonths: [] as number[],
  };
}

function projectedStockOnDate(
  input: BuildPurchaseCyclesInput,
  schedule: ForecastInboundScheduleEntry[],
  fromDate: string,
  onDate: string,
): number {
  const days = calendarDaysDifferenceUtc(fromDate, onDate);
  if (days <= 0) return input.initialStock;
  return simulateDailyReplenishment({
    ...baseSimInput(input, schedule, fromDate),
    horizonDays: days,
  }).closingStock;
}

function sumDemandBetween(
  mode: DailyDemandMode,
  fromIso: string,
  toIso: string,
): number {
  const getDaily = buildDailyDemandResolver(mode);
  let total = 0;
  let current = fromIso.slice(0, 10);
  const end = toIso.slice(0, 10);
  while (current <= end) {
    total += getDaily(current);
    current = addUtcDays(current, 1);
  }
  return total;
}

function inboundPlanningBetween(
  schedule: ForecastInboundScheduleEntry[],
  fromIso: string,
  toIso: string,
  excludeEta?: string,
): number {
  let total = 0;
  for (const entry of schedule) {
    if (!scheduleEntryUsableForPlanning(entry)) continue;
    const eta = entry.eta.slice(0, 10);
    if (excludeEta && eta === excludeEta.slice(0, 10)) continue;
    if (eta >= fromIso.slice(0, 10) && eta <= toIso.slice(0, 10)) {
      total += entry.units;
    }
  }
  return total;
}

function summarizePlanningInbound(
  schedule: ForecastInboundScheduleEntry[],
): PurchaseCyclePlan["planningInbound"] {
  const used = aggregateScheduleByEta(
    schedule.filter((entry) => scheduleEntryUsableForPlanning(entry)),
  );
  const ignored = aggregateScheduleByEta(
    schedule.filter((entry) => !scheduleEntryUsableForPlanning(entry)),
  );
  return { used, ignored };
}

function resolveCycleReason(params: {
  isUrgent: boolean;
  hasStockoutBeforeArrival: boolean;
  calendarDelayDays: number;
}): PurchaseCycleReason {
  if (params.isUrgent && params.hasStockoutBeforeArrival) {
    return "STOCKOUT_RECOVERY";
  }
  if (params.isUrgent) return "URGENT_REORDER";
  if (params.calendarDelayDays > 0) return "REORDER_POINT";
  return "REORDER_POINT";
}

function resolveCycleStatus(params: {
  today: string;
  latestOrderDate: string;
  orderDate: string;
  isUrgent: boolean;
  isOrderLate: boolean;
}): PurchaseCycleStatus {
  if (params.isUrgent || params.orderDate <= params.today) {
    return params.isOrderLate ? "OVERDUE" : "URGENT";
  }
  if (params.latestOrderDate < params.today) return "OVERDUE";
  if (params.orderDate > params.today) return "PLANNED";
  return "OK";
}

function buildBusinessMessage(params: {
  reason: PurchaseCycleReason;
  status: PurchaseCycleStatus;
  latestOrderDate: string;
  orderDate: string;
  today: string;
  estimatedLostSalesBeforeArrival: number;
  calendarDelayDays: number;
}): string {
  const parts: string[] = [];
  if (params.status === "URGENT" || params.status === "OVERDUE") {
    if (params.latestOrderDate < params.today) {
      parts.push(
        `Pedido vencido desde ${params.latestOrderDate}; conviene pedir ya (${params.orderDate}).`,
      );
    } else {
      parts.push("Pedido urgente por stock bajo o rotura inminente.");
    }
  } else {
    parts.push("Reposición planificada por punto de pedido.");
  }
  if (params.estimatedLostSalesBeforeArrival > 0) {
    parts.push(
      `Ventas perdidas estimadas antes de llegada: ${Math.round(params.estimatedLostSalesBeforeArrival)} uds.`,
    );
  }
  if (params.calendarDelayDays > 0) {
    parts.push(`Calendario logístico añade ${params.calendarDelayDays} días al lead time.`);
  }
  if (params.reason === "STOCKOUT_RECOVERY") {
    parts.push("Recuperación de rotura prevista antes de la llegada.");
  }
  return parts.join(" ");
}

function timingBeforeOrder(
  input: BuildPurchaseCyclesInput,
  schedule: ForecastInboundScheduleEntry[],
  today: string,
): {
  projectedStockoutDate: string | null;
  belowSafetyStockDate: string | null;
  requiredArrivalDate: string | null;
} {
  const sim = simulateDailyReplenishment({
    ...baseSimInput(input, schedule, today),
    horizonDays: input.horizonDays ?? 365,
    monthlyPlanMonths: [],
  });
  let requiredArrivalDate = earliestIsoDate([
    sim.estimatedStockoutDate,
    sim.belowSafetyStockDate,
  ]);
  if (
    requiredArrivalDate == null &&
    input.initialStock <= input.replenishment.safetyStockUnits
  ) {
    requiredArrivalDate = today;
  }
  return {
    projectedStockoutDate: sim.estimatedStockoutDate,
    belowSafetyStockDate: sim.belowSafetyStockDate,
    requiredArrivalDate,
  };
}

export function buildPurchaseCycles(
  input: BuildPurchaseCyclesInput,
): PurchaseCyclePlan {
  const today = input.startDate ?? utcTodayIso();
  const maxCycles = input.maxCycles ?? 8;
  const schedule: ForecastInboundScheduleEntry[] = [
    ...(input.inboundSchedule ?? []),
  ];
  const preventiveCycles = buildCalendarPreventiveCycles(input, schedule);
  const cycles: PurchaseCycle[] = [...preventiveCycles];
  const planWarnings: string[] = [];
  let afterDate: string | null =
    preventiveCycles.length > 0
      ? preventiveCycles[preventiveCycles.length - 1]!.estimatedArrivalDate
      : null;
  const coveredPreventiveKeys = new Set(
    preventiveCycles.flatMap((c) =>
      c.calendarEvents.map((e) => `${e.type}|${e.startDate.slice(0, 4)}`),
    ),
  );

  for (let i = 0; i < maxCycles; i += 1) {
    const belowReorderPointDate = findBelowReorderPointDate(
      baseSimInput(input, schedule, today),
      afterDate,
    );

    if (belowReorderPointDate == null) break;

    const isFirstCycle = i === 0;
    const isUrgent =
      isFirstCycle &&
      (input.initialStock <= input.replenishment.reorderPointUnits ||
        belowReorderPointDate <= today);

    const orderDate = isUrgent ? today : belowReorderPointDate;

    const preOrderTiming = timingBeforeOrder(input, schedule, today);
    let latestOrderDate = orderDate;

    if (isFirstCycle && preOrderTiming.requiredArrivalDate) {
      const backward = resolveLatestOrderDateForArrival({
        requiredArrivalDate: preOrderTiming.requiredArrivalDate,
        productionDays: input.productionDays,
        transitDays: input.transitDays,
        customsDays: input.customsDays,
        calendarEvents: input.calendarEvents,
      });
      latestOrderDate = backward.latestOrderDate;
    } else if (!isUrgent) {
      latestOrderDate = belowReorderPointDate;
    }

    const calendarImpact = resolveLogisticsCalendarImpact({
      orderDate,
      productionDays: input.productionDays,
      transitDays: input.transitDays,
      customsDays: input.customsDays,
      events: input.calendarEvents,
    });

    const leadTimeWithCalendar =
      input.productionDays +
      input.transitDays +
      input.customsDays +
      calendarImpact.delayDays;

    const estimatedArrivalDate = calendarImpact.etaFinal;

    const overlappingEvent = orderOverlapsPreventiveEvent(
      orderDate,
      estimatedArrivalDate,
      input.productionDays,
      input.calendarEvents,
    );
    if (overlappingEvent) {
      const eventKey = `${overlappingEvent.type}|${overlappingEvent.startDate.slice(0, 4)}`;
      if (coveredPreventiveKeys.has(eventKey)) {
        afterDate = addUtcDays(overlappingEvent.endDate, 1);
        continue;
      }
      afterDate = addUtcDays(overlappingEvent.endDate, 1);
      continue;
    }

    const projectedStockAtOrderDate = projectedStockOnDate(
      input,
      schedule,
      today,
      orderDate,
    );

    const projectedStockAtArrival = simulateDailyReplenishment({
      ...baseSimInput(input, schedule, today),
      horizonDays: Math.max(
        calendarDaysDifferenceUtc(today, estimatedArrivalDate),
        1,
      ),
      monthlyPlanMonths: [],
    }).closingStock;

    const coversFrom = estimatedArrivalDate.slice(0, 10);
    const coversTo = addUtcDays(
      coversFrom,
      input.replenishment.targetCoverageDays,
    );
    const coverageDays =
      calendarDaysDifferenceUtc(coversFrom, coversTo) + 1;

    const demandCoveredUnits = Math.ceil(
      sumDemandBetween(input.dailyDemand, coversFrom, coversTo),
    );
    const inboundInPeriod = inboundPlanningBetween(
      schedule,
      coversFrom,
      coversTo,
    );
    const safetyBufferUnits = input.replenishment.safetyStockUnits;

    const rawUnits = Math.max(
      0,
      demandCoveredUnits +
        safetyBufferUnits -
        projectedStockAtArrival -
        inboundInPeriod,
    );

    const { quantity: units } = applyMoqAndCartonToQuantity(
      rawUnits,
      input.replenishment.moq,
      input.replenishment.unitsPerCarton,
    );

    if (units <= 0) break;

    const lostSalesHorizon = Math.max(
      calendarDaysDifferenceUtc(orderDate, estimatedArrivalDate) + 1,
      1,
    );
    const lostSalesSim = simulateDailyReplenishment({
      ...baseSimInput(input, schedule, orderDate, projectedStockAtOrderDate),
      horizonDays: lostSalesHorizon,
      monthlyPlanMonths: [],
    });

    const estimatedLostSalesBeforeArrival =
      lostSalesSim.estimatedLostSalesUnits;
    const projectedStockoutDate =
      lostSalesSim.estimatedStockoutDate ?? preOrderTiming.projectedStockoutDate;

    const hasStockoutBeforeArrival = estimatedLostSalesBeforeArrival > 0;
    const isOrderLate = latestOrderDate < today;

    const reason = resolveCycleReason({
      isUrgent,
      hasStockoutBeforeArrival,
      calendarDelayDays: calendarImpact.delayDays,
    });

    const status = resolveCycleStatus({
      today,
      latestOrderDate,
      orderDate,
      isUrgent,
      isOrderLate,
    });

    const capitalRequired =
      input.unitCostEur != null && Number.isFinite(input.unitCostEur)
        ? units * input.unitCostEur
        : null;

    const calendarEvents = calendarImpact.events.map((e) => ({
      name: e.name,
      type: e.type,
      startDate: e.startDate,
      endDate: e.endDate,
      impactDays: e.impactDays,
    }));

    cycles.push({
      cycleNumber: cycles.length + 1,
      orderDate,
      latestOrderDate,
      estimatedArrivalDate,
      units,
      capitalRequired,
      coversFrom,
      coversTo,
      coverageDays,
      demandCoveredUnits,
      safetyBufferUnits,
      projectedStockoutDate,
      estimatedLostSalesBeforeArrival,
      projectedStockAtOrderDate,
      projectedStockAtArrival,
      calendarDelayDays: calendarImpact.delayDays,
      calendarEvents,
      calendarWarnings: calendarImpact.warnings,
      leadTimeDays: leadTimeWithCalendar,
      reason,
      status,
      businessMessage: buildBusinessMessage({
        reason,
        status,
        latestOrderDate,
        orderDate,
        today,
        estimatedLostSalesBeforeArrival,
        calendarDelayDays: calendarImpact.delayDays,
      }),
    });

    schedule.push({
      eta: estimatedArrivalDate,
      units,
      confidence: "confirmed",
      planningKind: "PURCHASE_ORDER_CONFIRMED",
      usableForPlanning: true,
      forecastCountry: null,
      forecastChannel: "ALL",
    });

    afterDate = estimatedArrivalDate;
  }

  cycles.sort((a, b) => a.orderDate.localeCompare(b.orderDate));
  cycles.forEach((cycle, index) => {
    cycle.cycleNumber = index + 1;
  });

  const additionalCapitalRequired = cycles.reduce(
    (sum, c) => sum + (c.capitalRequired ?? 0),
    0,
  );
  const capitalAlreadyCommitted = input.capitalAlreadyCommitted ?? null;
  const totalCapitalExposure =
    capitalAlreadyCommitted != null
      ? capitalAlreadyCommitted + additionalCapitalRequired
      : additionalCapitalRequired > 0
        ? additionalCapitalRequired
        : null;

  if (capitalAlreadyCommitted == null && (input.inboundSchedule?.length ?? 0) > 0) {
    planWarnings.push(
      "Capital ya comprometido en inbound no calculado con coste; solo se muestra capital adicional de nuevos ciclos.",
    );
  }

  const initialSchedule = input.inboundSchedule ?? [];
  const { used: planningInboundUsed, ignored: planningInboundIgnored } =
    summarizePlanningInbound(initialSchedule);

  return {
    cycles,
    capitalAlreadyCommitted,
    additionalCapitalRequired,
    totalCapitalExposure,
    planningInbound: {
      used: planningInboundUsed,
      ignored: planningInboundIgnored,
    },
    warnings: planWarnings,
  };
}

export function purchaseCyclesForMonth(
  cycles: PurchaseCycle[],
  month: number,
  year: number,
): PurchaseCycle[] {
  return cycles.filter((cycle) => {
    const ref = cycle.latestOrderDate ?? cycle.orderDate;
    const y = Number(ref.slice(0, 4));
    const m = monthFromIso(ref);
    return y === year && m === month;
  });
}

export function aggregatePurchaseCyclesForMonth(
  cycles: PurchaseCycle[],
  month: number,
  year: number,
): {
  latestOrderDate: string | null;
  recommendedPurchaseUnits: number;
  capitalRequired: number | null;
} {
  const monthCycles = purchaseCyclesForMonth(cycles, month, year);
  if (monthCycles.length === 0) {
    return {
      latestOrderDate: null,
      recommendedPurchaseUnits: 0,
      capitalRequired: null,
    };
  }

  const units = monthCycles.reduce((sum, c) => sum + c.units, 0);
  const capitalParts = monthCycles
    .map((c) => c.capitalRequired)
    .filter((c): c is number => c != null);
  const capitalRequired =
    capitalParts.length > 0
      ? capitalParts.reduce((sum, c) => sum + c, 0)
      : null;

  return {
    latestOrderDate: monthCycles[0]!.latestOrderDate,
    recommendedPurchaseUnits: units,
    capitalRequired,
  };
}
