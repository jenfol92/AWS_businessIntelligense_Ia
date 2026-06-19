import type { ForecastInboundScheduleEntry } from "../types/forecastInbound.types";
import type {
  PurchaseCycle,
  PurchaseCycleReason,
  ReplenishmentParams,
} from "../types/replenishment.types";
import { resolveLatestOrderDateForArrival } from "./resolveLatestOrderDateForArrival";
import { scheduleEntryUsableForPlanning } from "./resolveInboundPlanningKind";
import { applyMoqAndCartonToQuantity } from "./resolveReplenishmentParams";
import {
  type LogisticsCalendarEventInput,
  datesOverlap,
  resolveLogisticsCalendarImpact,
} from "./resolveLogisticsCalendarImpact";
import {
  type DailyDemandMode,
  addUtcDays,
  buildDailyDemandResolver,
  calendarDaysDifferenceUtc,
  simulateDailyReplenishment,
  utcTodayIso,
} from "./simulateDailyReplenishment";
import type { BuildPurchaseCyclesInput } from "./buildPurchaseCycles";

const PREVENTIVE_EVENT_TYPES = new Set(["chinese_new_year", "golden_week"]);

export function isLogisticsPreventiveEvent(
  event: LogisticsCalendarEventInput,
): boolean {
  return (
    PREVENTIVE_EVENT_TYPES.has(event.type) &&
    (event.affectsProduction || event.affectsTransport) &&
    event.impactDays > 0
  );
}

function eventKey(event: LogisticsCalendarEventInput): string {
  return `${event.type}|${event.startDate.slice(0, 4)}`;
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
): number {
  let total = 0;
  for (const entry of schedule) {
    if (!scheduleEntryUsableForPlanning(entry)) continue;
    const eta = entry.eta.slice(0, 10);
    if (eta >= fromIso.slice(0, 10) && eta <= toIso.slice(0, 10)) {
      total += entry.units;
    }
  }
  return total;
}

function projectedStockOnDate(
  input: BuildPurchaseCyclesInput,
  schedule: ForecastInboundScheduleEntry[],
  fromDate: string,
  onDate: string,
  initialStock?: number,
): number {
  const days = calendarDaysDifferenceUtc(fromDate, onDate);
  if (days <= 0) return initialStock ?? input.initialStock;
  return simulateDailyReplenishment({
    startDate: fromDate,
    horizonDays: days,
    initialStock: initialStock ?? input.initialStock,
    dailyDemand: input.dailyDemand,
    inboundSchedule: schedule,
    reorderPointUnits: input.replenishment.reorderPointUnits,
    safetyStockUnits: input.replenishment.safetyStockUnits,
    leadTimeDays: input.replenishment.leadTimeDays,
    targetCoverageDays: input.replenishment.targetCoverageDays,
    replenishment: input.replenishment,
    monthlyPlanMonths: [],
  }).closingStock;
}

function simulatePeriodBeforeArrival(input: {
  buildInput: BuildPurchaseCyclesInput;
  schedule: ForecastInboundScheduleEntry[];
  today: string;
  demandWindowFrom: string;
  estimatedArrivalDate: string;
}): {
  lostSalesBeforeArrival: number;
  stockCoverageBeforeArrival: boolean;
  stockCoveredUntilBeforeArrival: string | null;
  projectedStockoutDate: string | null;
} {
  const arrival = input.estimatedArrivalDate.slice(0, 10);
  const windowFrom = input.demandWindowFrom.slice(0, 10);
  const dayBeforeArrival = addUtcDays(arrival, -1);

  if (windowFrom >= arrival) {
    return {
      lostSalesBeforeArrival: 0,
      stockCoverageBeforeArrival: true,
      stockCoveredUntilBeforeArrival: null,
      projectedStockoutDate: null,
    };
  }

  const simStart =
    windowFrom > input.today.slice(0, 10) ? windowFrom : input.today.slice(0, 10);
  if (simStart > dayBeforeArrival) {
    return {
      lostSalesBeforeArrival: 0,
      stockCoverageBeforeArrival: true,
      stockCoveredUntilBeforeArrival: dayBeforeArrival,
      projectedStockoutDate: null,
    };
  }

  const horizonDays = calendarDaysDifferenceUtc(simStart, dayBeforeArrival) + 1;
  const sim = simulateDailyReplenishment({
    startDate: simStart,
    horizonDays,
    initialStock: input.buildInput.initialStock,
    dailyDemand: input.buildInput.dailyDemand,
    inboundSchedule: input.schedule,
    reorderPointUnits: input.buildInput.replenishment.reorderPointUnits,
    safetyStockUnits: input.buildInput.replenishment.safetyStockUnits,
    leadTimeDays: input.buildInput.replenishment.leadTimeDays,
    targetCoverageDays: input.buildInput.replenishment.targetCoverageDays,
    replenishment: input.buildInput.replenishment,
    monthlyPlanMonths: [],
  });

  const lostSalesBeforeArrival = Math.round(sim.estimatedLostSalesUnits);
  const stockCoverageBeforeArrival = lostSalesBeforeArrival === 0;
  const stockCoveredUntilBeforeArrival = stockCoverageBeforeArrival
    ? dayBeforeArrival
    : sim.estimatedStockoutDate
      ? addUtcDays(sim.estimatedStockoutDate, -1)
      : null;

  return {
    lostSalesBeforeArrival,
    stockCoverageBeforeArrival,
    stockCoveredUntilBeforeArrival,
    projectedStockoutDate: sim.estimatedStockoutDate,
  };
}

/** Ventana de demanda considerada al dimensionar el pedido preventivo. */
export function resolvePreventiveDemandWindow(
  event: LogisticsCalendarEventInput,
  replenishment: ReplenishmentParams,
): { demandWindowFrom: string; demandWindowTo: string } {
  const startYear = Number(event.startDate.slice(0, 4));
  const startMonth = Number(event.startDate.slice(5, 7));
  const leadTimeDays = replenishment.leadTimeDays;
  const bufferDays = replenishment.safetyBufferDays;

  if (event.type === "chinese_new_year" && startMonth <= 3) {
    return {
      demandWindowFrom: `${startYear - 1}-12-01`,
      demandWindowTo: addUtcDays(`${startYear}-03-31`, bufferDays),
    };
  }

  return {
    demandWindowFrom: addUtcDays(event.startDate, -30),
    demandWindowTo: addUtcDays(event.endDate, leadTimeDays + bufferDays),
  };
}

/** @deprecated Usar resolvePreventiveDemandWindow */
export function resolvePreventiveCoverageWindow(
  event: LogisticsCalendarEventInput,
  replenishment: ReplenishmentParams,
): { coverageFrom: string; coverageTo: string } {
  const window = resolvePreventiveDemandWindow(event, replenishment);
  return {
    coverageFrom: window.demandWindowFrom,
    coverageTo: window.demandWindowTo,
  };
}

function buildPreventiveBusinessMessage(
  event: LogisticsCalendarEventInput,
  demandWindowFrom: string,
  demandWindowTo: string,
  effectiveCoverageFrom: string,
  stockCoverageBeforeArrival: boolean,
  lostSalesBeforeArrival: number,
): string {
  const periodLabel = `${demandWindowFrom.slice(0, 7)} → ${demandWindowTo.slice(0, 7)}`;
  const priorStockNote = stockCoverageBeforeArrival
    ? "El stock/inbound previo cubre el tramo anterior a la llegada."
    : lostSalesBeforeArrival > 0
      ? `Ventas perdidas estimadas antes de llegada: ${lostSalesBeforeArrival} uds.`
      : "El stock previo no cubre todo el tramo anterior a la llegada.";

  if (event.type === "chinese_new_year") {
    return `Pedido preventivo por Año Nuevo Chino. Periodo protegido: ${periodLabel}. Este pedido cubre desde ${effectiveCoverageFrom.slice(0, 10)}. ${priorStockNote}`;
  }
  if (event.type === "golden_week") {
    return `Pedido preventivo por ${event.name}. Periodo protegido: ${periodLabel}. Este pedido cubre desde ${effectiveCoverageFrom.slice(0, 10)}. ${priorStockNote}`;
  }
  return `Pedido preventivo por ${event.name}. Periodo protegido: ${periodLabel}. ${priorStockNote}`;
}

export function orderOverlapsPreventiveEvent(
  orderDate: string,
  eta: string,
  productionDays: number,
  events: LogisticsCalendarEventInput[],
): LogisticsCalendarEventInput | null {
  const productionEnd = addUtcDays(orderDate, productionDays);
  for (const event of events) {
    if (!isLogisticsPreventiveEvent(event)) continue;
    if (datesOverlap(orderDate, eta, event.startDate, event.endDate)) {
      return event;
    }
    if (datesOverlap(orderDate, productionEnd, event.startDate, event.endDate)) {
      return event;
    }
  }
  return null;
}

export function buildCalendarPreventiveCycles(
  input: BuildPurchaseCyclesInput,
  schedule: ForecastInboundScheduleEntry[],
): PurchaseCycle[] {
  const today = input.startDate ?? utcTodayIso();
  const horizonEnd = addUtcDays(today, (input.horizonDays ?? 365) - 1);
  const preventiveEvents = input.calendarEvents.filter(isLogisticsPreventiveEvent);
  const cycles: PurchaseCycle[] = [];
  const handled = new Set<string>();

  for (const event of preventiveEvents) {
    if (event.endDate.slice(0, 10) < today) continue;
    if (event.startDate.slice(0, 10) > horizonEnd) continue;

    const key = eventKey(event);
    if (handled.has(key)) continue;
    handled.add(key);

    const { demandWindowFrom, demandWindowTo } = resolvePreventiveDemandWindow(
      event,
      input.replenishment,
    );
    if (demandWindowTo.slice(0, 10) < today) continue;

    const requiredArrivalDate = addUtcDays(event.startDate, -7);
    const backward = resolveLatestOrderDateForArrival({
      requiredArrivalDate,
      productionDays: input.productionDays,
      transitDays: input.transitDays,
      customsDays: input.customsDays,
      calendarEvents: input.calendarEvents,
    });

    const latestOrderDate = backward.latestOrderDate;
    const orderDate = latestOrderDate < today ? today : latestOrderDate;

    const calendarImpact = resolveLogisticsCalendarImpact({
      orderDate,
      productionDays: input.productionDays,
      transitDays: input.transitDays,
      customsDays: input.customsDays,
      events: input.calendarEvents,
    });

    const estimatedArrivalDate =
      calendarImpact.etaFinal <= requiredArrivalDate
        ? calendarImpact.etaFinal
        : requiredArrivalDate;

    const effectiveCoverageFrom = estimatedArrivalDate.slice(0, 10);
    let effectiveCoverageTo = demandWindowTo.slice(0, 10);
    if (effectiveCoverageTo < effectiveCoverageFrom) {
      effectiveCoverageTo = effectiveCoverageFrom;
    }

    const beforeArrival = simulatePeriodBeforeArrival({
      buildInput: input,
      schedule,
      today,
      demandWindowFrom,
      estimatedArrivalDate: effectiveCoverageFrom,
    });

    const stockAtDemandWindowFrom = projectedStockOnDate(
      input,
      schedule,
      today,
      demandWindowFrom,
    );
    const demandCoveredUnits = Math.ceil(
      sumDemandBetween(input.dailyDemand, demandWindowFrom, demandWindowTo),
    );
    const inboundInPeriod = inboundPlanningBetween(
      schedule,
      demandWindowFrom,
      demandWindowTo,
    );
    const safetyBufferUnits = input.replenishment.safetyStockUnits;

    const rawUnits = Math.max(
      0,
      demandCoveredUnits +
        safetyBufferUnits -
        stockAtDemandWindowFrom -
        inboundInPeriod,
    );

    const { quantity: units } = applyMoqAndCartonToQuantity(
      rawUnits,
      input.replenishment.moq,
      input.replenishment.unitsPerCarton,
    );

    if (units <= 0) continue;

    const isOrderLate = latestOrderDate < today;
    const reason: PurchaseCycleReason = "CALENDAR_PREVENTIVE";
    const calendarEvents = [
      {
        name: event.name,
        type: event.type,
        startDate: event.startDate,
        endDate: event.endDate,
        impactDays: event.impactDays,
      },
    ];

    cycles.push({
      cycleNumber: 0,
      orderDate,
      latestOrderDate,
      estimatedArrivalDate: effectiveCoverageFrom,
      units,
      capitalRequired:
        input.unitCostEur != null && Number.isFinite(input.unitCostEur)
          ? units * input.unitCostEur
          : null,
      coversFrom: effectiveCoverageFrom,
      coversTo: effectiveCoverageTo,
      coverageDays:
        calendarDaysDifferenceUtc(effectiveCoverageFrom, effectiveCoverageTo) + 1,
      demandCoveredUnits,
      safetyBufferUnits,
      projectedStockoutDate: beforeArrival.projectedStockoutDate,
      estimatedLostSalesBeforeArrival: beforeArrival.lostSalesBeforeArrival,
      projectedStockAtOrderDate: projectedStockOnDate(
        input,
        schedule,
        today,
        orderDate,
      ),
      projectedStockAtArrival: projectedStockOnDate(
        input,
        schedule,
        today,
        effectiveCoverageFrom,
      ),
      calendarDelayDays: calendarImpact.delayDays,
      calendarEvents,
      calendarWarnings: calendarImpact.warnings,
      leadTimeDays:
        input.productionDays +
        input.transitDays +
        input.customsDays +
        calendarImpact.delayDays,
      reason,
      status: isOrderLate ? "OVERDUE" : "PLANNED",
      demandWindowFrom,
      demandWindowTo,
      effectiveCoverageFrom,
      effectiveCoverageTo,
      stockCoverageBeforeArrival: beforeArrival.stockCoverageBeforeArrival,
      stockCoveredUntilBeforeArrival:
        beforeArrival.stockCoveredUntilBeforeArrival,
      businessMessage: buildPreventiveBusinessMessage(
        event,
        demandWindowFrom,
        demandWindowTo,
        effectiveCoverageFrom,
        beforeArrival.stockCoverageBeforeArrival,
        beforeArrival.lostSalesBeforeArrival,
      ),
    });

    schedule.push({
      eta: effectiveCoverageFrom,
      units,
      confidence: "confirmed",
      planningKind: "PURCHASE_ORDER_CONFIRMED",
      usableForPlanning: true,
      forecastCountry: null,
      forecastChannel: "ALL",
    });
  }

  cycles.sort((a, b) => a.orderDate.localeCompare(b.orderDate));
  return cycles;
}
