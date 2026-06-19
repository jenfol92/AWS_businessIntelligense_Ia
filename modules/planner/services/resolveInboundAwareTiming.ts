import type { ForecastInboundScheduleEntry } from "../types/forecastInbound.types";
import type { ReplenishmentTiming } from "../types/replenishment.types";
import { scheduleEntryUsableForPlanning } from "./resolveInboundPlanningKind";
import {
  type DailyDemandMode,
  calendarDaysDifferenceUtc,
  simulateDailyReplenishment,
  utcTodayIso,
} from "./simulateDailyReplenishment";
import type { ResolveReplenishmentTimingInput } from "./resolveReplenishmentTiming";

export function findNextPlanningInbound(
  schedule: ForecastInboundScheduleEntry[],
  fromDate: string,
): { date: string; units: number } | null {
  const from = fromDate.slice(0, 10);
  const future = schedule
    .filter(
      (entry) =>
        scheduleEntryUsableForPlanning(entry) &&
        entry.eta.slice(0, 10) >= from &&
        entry.units > 0,
    )
    .sort((a, b) => a.eta.localeCompare(b.eta));

  if (future.length === 0) return null;

  const firstDate = future[0]!.eta.slice(0, 10);
  const units = future
    .filter((entry) => entry.eta.slice(0, 10) === firstDate)
    .reduce((sum, entry) => sum + entry.units, 0);

  return { date: firstDate, units };
}

export function simulateLostSalesUntilDate(input: {
  startDate: string;
  untilDateExclusive: string;
  openingStock: number;
  dailyDemandMode: DailyDemandMode;
  inboundSchedule: ForecastInboundScheduleEntry[];
  replenishment: ResolveReplenishmentTimingInput["replenishment"];
}): number {
  const start = input.startDate.slice(0, 10);
  const endExclusive = input.untilDateExclusive.slice(0, 10);
  if (endExclusive <= start) return 0;

  const horizonDays = calendarDaysDifferenceUtc(start, endExclusive);
  const sim = simulateDailyReplenishment({
    startDate: start,
    horizonDays,
    initialStock: input.openingStock,
    dailyDemand: input.dailyDemandMode,
    inboundSchedule: input.inboundSchedule,
    reorderPointUnits: Number.MAX_SAFE_INTEGER,
    safetyStockUnits: 0,
    leadTimeDays: input.replenishment.leadTimeDays,
    targetCoverageDays: input.replenishment.targetCoverageDays,
    replenishment: input.replenishment,
    monthlyPlanMonths: [],
  });

  return Math.round(sim.estimatedLostSalesUnits);
}

export function resolveInboundAwareTimingExtensions(input: {
  openingStock: number;
  replenishment: ResolveReplenishmentTimingInput["replenishment"];
  inboundSchedule: ForecastInboundScheduleEntry[];
  dailyDemandMode: DailyDemandMode;
  orderTodayEta: string | null;
  today?: string;
}): Pick<
  ReplenishmentTiming,
  | "currentStockout"
  | "nextInboundDate"
  | "nextInboundUnits"
  | "lostSalesUntilNextInbound"
  | "orderTodaySupersededByInbound"
  | "orderTodaySupersededMessage"
> {
  const today = input.today ?? utcTodayIso();
  const currentStockout =
    input.openingStock <= 0 && input.replenishment.dailyDemand > 0;

  const nextInbound = findNextPlanningInbound(input.inboundSchedule, today);
  const lostSalesUntilNextInbound = nextInbound
    ? simulateLostSalesUntilDate({
        startDate: today,
        untilDateExclusive: nextInbound.date,
        openingStock: input.openingStock,
        dailyDemandMode: input.dailyDemandMode,
        inboundSchedule: input.inboundSchedule,
        replenishment: input.replenishment,
      })
    : 0;

  const orderTodayEta = input.orderTodayEta?.slice(0, 10) ?? null;
  const orderTodaySupersededByInbound =
    nextInbound != null &&
    orderTodayEta != null &&
    nextInbound.date < orderTodayEta;

  const orderTodaySupersededMessage = orderTodaySupersededByInbound
    ? `Hay entrada prevista el ${nextInbound!.date} (${nextInbound!.units} uds). Un pedido nuevo hoy llegaría el ${orderTodayEta} y no evita la rotura antes de esa entrada.`
    : null;

  return {
    currentStockout,
    nextInboundDate: nextInbound?.date ?? null,
    nextInboundUnits: nextInbound?.units ?? 0,
    lostSalesUntilNextInbound,
    orderTodaySupersededByInbound,
    orderTodaySupersededMessage,
  };
}
