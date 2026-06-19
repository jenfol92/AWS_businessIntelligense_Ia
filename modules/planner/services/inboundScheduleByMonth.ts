import type {
  ForecastInboundConfidence,
  ForecastInboundScheduleEntry,
} from "../types/forecastInbound.types";

/** Índice de mes relativo (1 = mes calendario actual). */
export function monthIndexFromToday(isoDate: string): number | null {
  const today = new Date();
  const eta = new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(eta.getTime())) return null;

  const diff =
    (eta.getUTCFullYear() - today.getUTCFullYear()) * 12 +
    (eta.getUTCMonth() - today.getUTCMonth()) +
    1;

  return diff >= 1 ? diff : null;
}

export function aggregateInboundByMonthIndex(
  schedule: ForecastInboundScheduleEntry[],
  horizonMonths: number,
  confidence?: ForecastInboundConfidence,
): number[] {
  const months = Array.from({ length: horizonMonths }, () => 0);

  for (const entry of schedule) {
    if (confidence && entry.confidence !== confidence) continue;
    const monthIndex = monthIndexFromToday(entry.eta);
    if (monthIndex == null || monthIndex > horizonMonths) continue;
    months[monthIndex - 1] += entry.units;
  }

  return months;
}

export function aggregateInboundByCalendarMonth(
  schedule: ForecastInboundScheduleEntry[],
  forecastYear: number,
  confidence?: ForecastInboundConfidence,
): number[] {
  const months = Array.from({ length: 12 }, () => 0);

  for (const entry of schedule) {
    if (confidence && entry.confidence !== confidence) continue;
    const eta = entry.eta.slice(0, 10);
    const year = Number(eta.slice(0, 4));
    const month = Number(eta.slice(5, 7));
    if (year !== forecastYear || month < 1 || month > 12) continue;
    months[month - 1] += entry.units;
  }

  return months;
}
