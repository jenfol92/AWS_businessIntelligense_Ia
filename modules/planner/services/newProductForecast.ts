import type {
  CompetitorBenchmarkRow,
  DemandForecastMonthlyLine,
  DemandForecastResult,
  DemandForecastScenario,
  PlannerParams,
  PlanningProduct,
} from "../types/planner.types";

const DEFAULT_HORIZON_MONTHS = 12;

function resolvedScenario(params: PlannerParams): DemandForecastScenario {
  const s = params.scenario ?? "base";
  if (s === "conservative" || s === "optimistic") return s;
  return "base";
}

/** Mes de calendario (1–12) para la línea `monthIndex` (1 = primer mes del horizonte). */
function calendarMonthForLine(monthIndex: number): number {
  const d = new Date();
  const zeroBased = d.getMonth() + (monthIndex - 1);
  return (zeroBased % 12) + 1;
}

/**
 * Misma lógica simple que Motor A (`demandForecast`): evergreen, summer, christmas.
 */
function seasonalityFactorForProfile(
  profile: string | null | undefined,
  calendarMonth: number,
): number {
  const raw = (profile ?? "evergreen").trim().toLowerCase();
  if (!raw || raw.includes("evergreen")) {
    return 1;
  }
  if (raw.includes("summer") || raw.includes("verano")) {
    return calendarMonth >= 5 && calendarMonth <= 8 ? 1.25 : 1;
  }
  if (raw.includes("christmas") || raw.includes("navidad")) {
    return calendarMonth >= 11 && calendarMonth <= 12 ? 1.3 : 1;
  }
  return 1;
}

function benchmarkInitialQuota(scenario: PlannerParams["scenario"]): number {
  switch (scenario ?? "base") {
    case "conservative":
      return 0.04;
    case "optimistic":
      return 0.12;
    default:
      return 0.07;
  }
}

function launchRampFactor(monthIndex: number): number {
  if (monthIndex <= 1) return 0.55;
  if (monthIndex === 2) return 0.75;
  if (monthIndex === 3) return 0.9;
  return 1;
}

function medianPositive(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function emptyBenchmarkResult(
  product: PlanningProduct,
  params: PlannerParams,
): DemandForecastResult {
  const horizonMonths = params.horizonMonths ?? DEFAULT_HORIZON_MONTHS;
  const scenario = resolvedScenario(params);
  const monthly: DemandForecastMonthlyLine[] = [];
  for (let monthIndex = 1; monthIndex <= horizonMonths; monthIndex += 1) {
    const calMonth = calendarMonthForLine(monthIndex);
    const seasonalityFactor = seasonalityFactorForProfile(
      product.seasonalityProfile,
      calMonth,
    );
    monthly.push({
      monthIndex,
      forecastUnits: 0,
      scenario,
      seasonalityFactor,
    });
  }
  return {
    productId: product.id,
    sku: product.sku,
    method: "NO_HISTORY",
    averageDailySales: 0,
    monthly,
  };
}

export type NewProductForecastOptions = {
  /** Override de cuota de captura (0–1); si no, escenario planner. */
  capturePctOverride?: number | null;
};

function resolvedCaptureQuota(
  params: PlannerParams,
  override?: number | null,
): number {
  if (
    override != null &&
    Number.isFinite(override) &&
    override >= 0 &&
    override <= 1
  ) {
    return override;
  }
  return benchmarkInitialQuota(params.scenario);
}

export function buildNewProductForecast(
  product: PlanningProduct,
  benchmarkRows: CompetitorBenchmarkRow[],
  params: PlannerParams,
  options?: NewProductForecastOptions,
): DemandForecastResult {
  const horizonMonths = params.horizonMonths ?? DEFAULT_HORIZON_MONTHS;
  const scenario = resolvedScenario(params);
  const quota = resolvedCaptureQuota(params, options?.capturePctOverride);

  const competitorUnits = benchmarkRows
    .map((r) => r.estimatedMonthlyUnits)
    .filter((u): u is number => u != null && u > 0);

  const medianCompetitorUnits = medianPositive(competitorUnits);
  if (medianCompetitorUnits == null) {
    return emptyBenchmarkResult(product, params);
  }

  const monthly: DemandForecastMonthlyLine[] = [];
  for (let monthIndex = 1; monthIndex <= horizonMonths; monthIndex += 1) {
    const calMonth = calendarMonthForLine(monthIndex);
    const seasonalityFactor = seasonalityFactorForProfile(
      product.seasonalityProfile,
      calMonth,
    );
    const rawUnits =
      medianCompetitorUnits *
      quota *
      seasonalityFactor *
      launchRampFactor(monthIndex);
    const forecastUnits = Math.ceil(rawUnits);
    monthly.push({
      monthIndex,
      forecastUnits,
      scenario,
      seasonalityFactor,
    });
  }

  const firstMonthForecast = monthly[0]?.forecastUnits ?? 0;
  const averageDailySales = firstMonthForecast / 30;

  return {
    productId: product.id,
    sku: product.sku,
    method: "NEW_PRODUCT_BENCHMARK",
    averageDailySales,
    monthly,
  };
}
