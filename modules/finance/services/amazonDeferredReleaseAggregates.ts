export type DeferredObservationRow = {
  amazon_release_date?: string | null;
  official_amount_eur?: number | string | null;
  amount_eur?: number | string | null;
  estimated_amount_eur?: number | string | null;
  original_amount?: number | string | null;
  original_currency?: string | null;
};

export type AmazonDeferredReleaseAggregate = {
  date: string | null;
  month: string | null;
  knownEur: number | null;
  transactionCount: number;
  positiveKnownEur: number | null;
  negativeKnownEur: number | null;
  unvaluedCount: number;
  unvaluedOriginalByCurrency: Record<string, number>;
  isComplete: boolean;
};

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function releaseDate(row: DeferredObservationRow): string | null {
  const raw = row.amazon_release_date;
  if (typeof raw !== "string" || raw.length < 10) return null;
  return raw.slice(0, 10);
}

export function valuedEur(row: DeferredObservationRow): number | null {
  return asNumber(row.official_amount_eur) ?? asNumber(row.amount_eur) ?? asNumber(row.estimated_amount_eur);
}

function aggregateBucket(
  rows: DeferredObservationRow[],
  date: string | null,
  month: string | null,
): AmazonDeferredReleaseAggregate {
  let positiveKnownEur = 0;
  let negativeKnownEur = 0;
  let hasPositive = false;
  let hasNegative = false;
  let unvaluedCount = 0;
  const unvaluedOriginalByCurrency: Record<string, number> = {};

  for (const row of rows) {
    const eur = valuedEur(row);
    if (eur == null) {
      unvaluedCount++;
      const currency = String(row.original_currency ?? "UNKNOWN").toUpperCase();
      const original = asNumber(row.original_amount) ?? 0;
      unvaluedOriginalByCurrency[currency] = round2((unvaluedOriginalByCurrency[currency] ?? 0) + original);
      continue;
    }
    if (eur >= 0) {
      hasPositive = true;
      positiveKnownEur = round2(positiveKnownEur + eur);
    } else {
      hasNegative = true;
      negativeKnownEur = round2(negativeKnownEur + eur);
    }
  }

  const knownParts = [hasPositive ? positiveKnownEur : null, hasNegative ? negativeKnownEur : null].filter(
    (v): v is number => v != null,
  );
  const knownEur = knownParts.length === 0 ? null : round2(knownParts.reduce((sum, v) => sum + v, 0));

  return {
    date,
    month,
    knownEur,
    transactionCount: rows.length,
    positiveKnownEur: hasPositive ? positiveKnownEur : null,
    negativeKnownEur: hasNegative ? negativeKnownEur : null,
    unvaluedCount,
    unvaluedOriginalByCurrency,
    isComplete: rows.length === 0 ? true : unvaluedCount === 0 && (date != null || month != null),
  };
}

function round2(value: number) {
  return Math.round(value * 100 + 1e-7) / 100;
}

export function aggregateDeferredByReleaseDate(rows: DeferredObservationRow[]): AmazonDeferredReleaseAggregate[] {
  const groups = new Map<string, DeferredObservationRow[]>();
  const undated: DeferredObservationRow[] = [];
  for (const row of rows) {
    const date = releaseDate(row);
    if (!date) {
      undated.push(row);
      continue;
    }
    groups.set(date, [...(groups.get(date) ?? []), row]);
  }
  const dated = Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bucket]) => aggregateBucket(bucket, date, date.slice(0, 7)));
  if (undated.length > 0) {
    dated.push(aggregateBucket(undated, null, null));
  }
  return dated;
}

export function aggregateDeferredByReleaseMonth(
  rows: DeferredObservationRow[],
  horizonMonths: string[],
): AmazonDeferredReleaseAggregate[] {
  const byMonth = new Map<string, DeferredObservationRow[]>();
  for (const month of horizonMonths) byMonth.set(month, []);
  const outsideHorizon: DeferredObservationRow[] = [];

  for (const row of rows) {
    const date = releaseDate(row);
    const month = date?.slice(0, 7) ?? null;
    if (month && byMonth.has(month)) {
      byMonth.get(month)!.push(row);
    } else if (month) {
      outsideHorizon.push(row);
    } else {
      outsideHorizon.push(row);
    }
  }

  const aggregates = horizonMonths.map((month) => aggregateBucket(byMonth.get(month) ?? [], null, month));
  if (outsideHorizon.length > 0) {
    aggregates.push(aggregateBucket(outsideHorizon, null, null));
  }
  return aggregates;
}

export function buildAmazonDeferredReleasePlanning(
  rows: DeferredObservationRow[],
  observedAt: string | null,
  horizonMonths: string[],
) {
  const deferredRows = rows.filter((row) => row != null);
  return {
    runId: null as string | null,
    semantic: "amazon_release" as const,
    label: "Liberación Amazon (no ingreso bancario)",
    observedAt,
    dailyByReleaseDate: aggregateDeferredByReleaseDate(deferredRows),
    monthlyByReleaseMonth: aggregateDeferredByReleaseMonth(deferredRows, horizonMonths),
  };
}
