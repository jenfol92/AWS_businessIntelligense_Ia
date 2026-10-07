import type { AmazonDeferredReleaseAggregate } from "../types/planning.types";

export function formatPlanningEur(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatOriginalAmount(value: number | null | undefined, currency: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ${currency}`;
}

export function monthAxisLabel(month: string): string {
  const [year, mm] = month.split("-");
  const names = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const idx = Number(mm) - 1;
  return `${names[idx] ?? mm} ${year.slice(2)}`;
}

export function unvaluedSummary(bucket: AmazonDeferredReleaseAggregate): string | null {
  if (bucket.unvaluedCount <= 0) return null;
  const parts = Object.entries(bucket.unvaluedOriginalByCurrency).map(
    ([currency, amount]) => formatOriginalAmount(amount, currency),
  );
  return `${bucket.unvaluedCount} sin valorar${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

export function buildAmazonAnnualChartRows(
  horizonMonths: string[],
  deferredMonthly: AmazonDeferredReleaseAggregate[],
  pendingMonthly: Array<{ month: string; knownEur: number | null }>,
  futureMonthly: Array<{ month: string; estimatedEur: number | null }>,
) {
  return horizonMonths.map((month) => {
    const deferred = deferredMonthly.find((row) => row.month === month) ?? null;
    const pending = pendingMonthly.find((row) => row.month === month) ?? null;
    const future = futureMonthly.find((row) => row.month === month) ?? null;
    return {
      month,
      axisLabel: monthAxisLabel(month),
      deferredBucket: deferred,
      deferredKnown: deferred?.knownEur ?? null,
      deferredIncomplete: deferred ? !deferred.isComplete : false,
      deferredUnvaluedCount: deferred?.unvaluedCount ?? 0,
      pendingKnown: pending?.knownEur ?? null,
      futureEstimated: future?.estimatedEur ?? null,
    };
  });
}
