import {
  type LogisticsCalendarEventInput,
  resolveLogisticsCalendarImpact,
} from "./resolveLogisticsCalendarImpact";
import {
  addUtcDays,
  calendarDaysDifferenceUtc,
} from "./simulateDailyReplenishment";

export type CalendarImpactEvent = {
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  impactDays: number;
  affectsProduction: boolean;
  affectsTransport: boolean;
};

export type ResolveLatestOrderDateForArrivalInput = {
  requiredArrivalDate: string;
  productionDays: number;
  transitDays: number;
  customsDays: number;
  domesticDays?: number;
  calendarEvents: LogisticsCalendarEventInput[];
  originCountry?: string;
};

export type LatestOrderDateForArrivalResult = {
  latestOrderDate: string;
  estimatedArrivalDate: string;
  totalLeadTimeDays: number;
  calendarDelayDays: number;
  events: CalendarImpactEvent[];
  warnings: string[];
};

const MAX_EXTRA_LOOKBACK_DAYS = 90;

/**
 * Busca la fecha de pedido más tardía cuya ETA (con calendario) llega a tiempo.
 */
export function resolveLatestOrderDateForArrival(
  input: ResolveLatestOrderDateForArrivalInput,
): LatestOrderDateForArrivalResult {
  const required = input.requiredArrivalDate.slice(0, 10);
  const domesticDays = input.domesticDays ?? 0;
  const baseLeadDays =
    input.productionDays +
    input.transitDays +
    input.customsDays +
    domesticDays;

  const searchStart = addUtcDays(
    required,
    -(baseLeadDays + MAX_EXTRA_LOOKBACK_DAYS),
  );
  const searchEnd = addUtcDays(required, -1);

  let latestOk: string | null = null;
  let bestImpact: ReturnType<typeof resolveLogisticsCalendarImpact> | null =
    null;

  let current = searchStart;
  while (current <= searchEnd) {
    const impact = resolveLogisticsCalendarImpact({
      orderDate: current,
      productionDays: input.productionDays,
      transitDays: input.transitDays,
      customsDays: input.customsDays,
      events: input.calendarEvents,
      originCountry: input.originCountry,
    });

    if (impact.etaFinal.slice(0, 10) <= required) {
      latestOk = current;
      bestImpact = impact;
    }

    current = addUtcDays(current, 1);
  }

  if (latestOk == null || bestImpact == null) {
    const fallbackOrder = addUtcDays(required, -baseLeadDays);
    const impact = resolveLogisticsCalendarImpact({
      orderDate: fallbackOrder,
      productionDays: input.productionDays,
      transitDays: input.transitDays,
      customsDays: input.customsDays,
      events: input.calendarEvents,
      originCountry: input.originCountry,
    });

    return {
      latestOrderDate: fallbackOrder,
      estimatedArrivalDate: impact.etaFinal,
      totalLeadTimeDays: calendarDaysDifferenceUtc(
        fallbackOrder,
        impact.etaFinal,
      ),
      calendarDelayDays: impact.delayDays,
      events: impact.events,
      warnings: [
        ...impact.warnings,
        "No se encontró fecha de pedido que llegue antes de la fecha objetivo; se usa estimación conservadora.",
      ],
    };
  }

  return {
    latestOrderDate: latestOk,
    estimatedArrivalDate: bestImpact.etaFinal,
    totalLeadTimeDays: calendarDaysDifferenceUtc(
      latestOk,
      bestImpact.etaFinal,
    ),
    calendarDelayDays: bestImpact.delayDays,
    events: bestImpact.events,
    warnings: bestImpact.warnings,
  };
}
