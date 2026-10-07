export type SalesRange = { fromDate: string; toDate: string };
export function isUtcDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function addUtcDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function splitInclusiveDateRange(fromDate: string, toDate: string, maxDays = 30): SalesRange[] {
  if (!isUtcDateOnly(fromDate) || !isUtcDateOnly(toDate) || fromDate > toDate ||
      !Number.isInteger(maxDays) || maxDays < 1 || maxDays > 30 || toDate === "9999-12-31") throw new Error("INVALID_SALES_DATE_RANGE");
  const ranges: SalesRange[] = [];
  for (let from = fromDate; from <= toDate;) {
    const candidate = addUtcDays(from, maxDays - 1);
    const to = candidate < toDate ? candidate : toDate;
    ranges.push({ fromDate: from, toDate: to });
    from = addUtcDays(to, 1);
  }
  return ranges;
}
export type SalesSyncStatus = "PENDING" | "PROCESSING" | "RATE_LIMITED" | "COMPLETED" | "FATAL" | "FAILED";
export type SalesChunk = SalesRange & {
  phase: "CREATE" | "CREATE_INTENT" | "POLL" | "DOWNLOAD" | "COMPLETED";
  reportId?: string; documentId?: string; attempts: number;
  committedAt?: string; processingStatus?: string; diagnostic?: Record<string, unknown>;
};
export type SalesSyncState = SalesRange & {
  version: 1; mode: "import" | "syncOnly"; marketplaceIds: string[]; tipoCliente: string;
  status: SalesSyncStatus; chunks: SalesChunk[]; chunkIndex: number;
  nextAttemptAt: string | null; error: string | null; lastCommittedAt: string | null;
};
export function retryAt(retryAfter: string | null | undefined, attempt: number, now: number): string {
  const seconds = retryAfter?.trim() ? Number(retryAfter) : NaN;
  const date = retryAfter ? Date.parse(retryAfter) : NaN;
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(date) ? date - now : Math.min(3600, 60 * 2 ** Math.min(attempt, 6)) * 1000;
  return new Date(now + Math.max(1000, delay)).toISOString();
}
export function salesSyncHttpStatus(status: SalesSyncStatus): number {
  return status === "COMPLETED" ? 200 : status === "FATAL" || status === "FAILED" ? 502 : 202;
}
