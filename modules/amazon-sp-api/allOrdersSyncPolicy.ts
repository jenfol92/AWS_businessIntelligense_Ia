import { MARKETPLACE_TIMEZONES, localDateInTimeZone } from "./allOrdersReportParser.ts";

export const ORDERS_SOURCE = "all_orders_canonical_v1";
export const ORDERS_VERSION = 1;
export type CoverageStatus = "COMPLETE" | "PARTIAL" | "MISSING" | "IN_PROGRESS" | "FAILED";
export type OrdersWindow = {
  marketplaceId: string; country: string; fromDate: string; toDate: string;
  dataStartTime: string; dataEndTime: string;
  phase: "CREATE" | "POLL" | "IMPORT" | "COMPLETE" | "FAILED";
  reportId: string | null; documentId: string | null;
  createIntentAt?: string; processingStatus?: string; observedAt?: string;
  completedAt?: string; rowsUpserted?: number; unmatchedRows?: number; error?: string | null;
  coverageStatus: "COMPLETE" | "PARTIAL";
  attempts?: number;
  observedCountries?: string[];
  nonAmazonRows?: number;
  unknownMarketplaceRows?: number;
};
export type OrdersState = {
  version: 1; fromDate: string; toDate: string; marketplaceIds: string[];
  windows: OrdersWindow[]; nextAttemptAt: string | null; error: string | null;
};
export const ORDERS_MARKETPLACES: Readonly<Record<string, string>> = {
  A1RKKUPIHCS9HS: "ES", A13V1IB3VIYZZH: "FR", A1PA6795UKMFR9: "DE", APJ6JRA9NG5V4: "IT",
  A1F83G8C2ARO7P: "GB", AMEN7PMS3EDWL: "BE", A1805IZSGTT6HS: "NL", A2NODRKZP88ZB9: "SE",
  A1C3SOZRARQ6R3: "PL", A28R8C7NBKEWEA: "IE", A2VIGQ35RCS4UG: "AE", A17E79C6D8DWNP: "SA",
};
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function validateRange(from: string, to: string): void {
  for (const value of [from, to]) if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("ALL_ORDERS_INVALID_DATE");
  const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (days < 1 || days > 366) throw new Error("ALL_ORDERS_INVALID_RANGE");
}
export function splitIntoWindows(fromDate: string, toDate: string, maxDays = 29) {
  validateRange(fromDate, toDate);
  if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > 30) throw new Error("ALL_ORDERS_INVALID_WINDOW");
  const windows: { fromDate: string; toDate: string }[] = [];
  for (let start = fromDate; start <= toDate; start = addDays(start, maxDays)) windows.push({ fromDate: start, toDate: addDays(start, maxDays - 1) < toDate ? addDays(start, maxDays - 1) : toDate });
  return windows;
}
/** Convert local midnight to UTC, including DST, without a silent Madrid fallback. */
export function localMidnightUtc(date: string, country: string): string {
  const zone = MARKETPLACE_TIMEZONES[country]; if (!zone) throw new Error("ALL_ORDERS_UNKNOWN_MARKETPLACE");
  const target = Date.parse(`${date}T00:00:00Z`); let guess = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const p = Object.fromEntries(parts.map(v => [v.type, v.value]));
    const local = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    guess += target - local;
  }
  return new Date(guess).toISOString();
}
export function buildOrdersState(fromDate: string, toDate: string, marketplaceIds: string[], now: Date): OrdersState {
  const ids = Array.from(new Set(marketplaceIds)).sort(); if (!ids.length) throw new Error("ALL_ORDERS_EMPTY_SCOPE");
  const windows = ids.flatMap(marketplaceId => {
    const country = ORDERS_MARKETPLACES[marketplaceId]; if (!country) throw new Error("ALL_ORDERS_UNKNOWN_MARKETPLACE");
    validateRange(fromDate,toDate);
    const today = localDateInTimeZone(now.toISOString(),MARKETPLACE_TIMEZONES[country])!;
    if (toDate > today) throw new Error("ALL_ORDERS_RANGE_IN_FUTURE");
    const closedTo = toDate === today ? addDays(toDate,-1) : toDate;
    const chunks = fromDate <= closedTo ? splitIntoWindows(fromDate,closedTo) : [];
    if (toDate === today) chunks.push({ fromDate: today, toDate: today });
    return chunks.map(w => {
      const dataStartTime = localMidnightUtc(w.fromDate, country);
      const fullEnd = localMidnightUtc(addDays(w.toDate, 1), country);
      const end = Math.min(Date.parse(fullEnd),now.getTime()-180000);
      if (end <= Date.parse(dataStartTime)) throw new Error("ALL_ORDERS_RANGE_NOT_READY");
      const dataEndTime = new Date(end).toISOString();
      const coverageStatus = end === Date.parse(fullEnd) ? "COMPLETE" as const : "PARTIAL" as const;
      if (Date.parse(dataEndTime) - Date.parse(dataStartTime) > 30 * 86400000) throw new Error("ALL_ORDERS_WINDOW_TOO_LARGE");
      return { ...w, marketplaceId, country, dataStartTime, dataEndTime, coverageStatus, phase: "CREATE" as const, reportId: null, documentId: null };
    });
  });
  return { version: 1, fromDate, toDate, marketplaceIds: ids, windows, nextAttemptAt: null, error: null };
}
export function rollingRange(now: Date, daysValue = process.env.AMAZON_ORDERS_REIMPORT_DAYS ?? "14") {
  const days = Number(daysValue); if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error("ALL_ORDERS_INVALID_REIMPORT_DAYS");
  // Include today's mutable demand explicitly as PARTIAL, never certify a full day.
  const toDate = localDateInTimeZone(now.toISOString(), "Europe/London")!;
  return { fromDate: addDays(toDate, 1 - days), toDate };
}
export function assertSameScope(state: OrdersState, requested: Pick<OrdersState, "fromDate" | "toDate" | "marketplaceIds">): void {
  if (state.fromDate !== requested.fromDate || state.toDate !== requested.toDate || JSON.stringify([...state.marketplaceIds].sort()) !== JSON.stringify([...requested.marketplaceIds].sort())) throw new Error("ALL_ORDERS_RANGE_CONFLICT");
}
export function summarizeCoverage(from: string, to: string, intervals: { start_date: string; end_date: string; status: CoverageStatus }[]) {
  validateRange(from, to);
  const days: { date: string; status: CoverageStatus }[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const statuses = intervals.filter(i => i.start_date <= date && i.end_date >= date).map(i => i.status);
    const status: CoverageStatus = statuses.includes("COMPLETE") ? "COMPLETE" : statuses.includes("IN_PROGRESS") ? "IN_PROGRESS" : statuses.includes("FAILED") ? "FAILED" : statuses.includes("PARTIAL") ? "PARTIAL" : "MISSING";
    days.push({ date, status });
  }
  const status: CoverageStatus = days.every(d => d.status === "COMPLETE") ? "COMPLETE" : days.some(d => d.status === "COMPLETE") ? "PARTIAL" : days.some(d => d.status === "IN_PROGRESS") ? "IN_PROGRESS" : days.some(d => d.status === "FAILED") ? "FAILED" : days.some(d => d.status === "PARTIAL") ? "PARTIAL" : "MISSING";
  return { status, days };
}
