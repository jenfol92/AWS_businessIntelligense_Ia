import type {
  DemandForecastMonthlyLine,
  DemandForecastResult,
  DemandForecastScenario,
  PlannerParams,
  PlanningProduct,
} from "../types/planner.types";

const DEFAULT_HORIZON_MONTHS = 12;

function scenarioFactor(scenario: PlannerParams["scenario"]): number {
  switch (scenario ?? "base") {
    case "conservative":
      return 0.8;
    case "optimistic":
      return 1.25;
    default:
      return 1;
  }
}

function resolvedScenario(
  params: PlannerParams,
): DemandForecastScenario {
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
 * Perfiles simples Motor A; desconocidos → factor 1.
 * - evergreen: 1 en todos los meses
 * - summer: refuerzo mayo–agosto (5–8)
 * - christmas: refuerzo noviembre–diciembre (11–12)
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

export function buildDemandForecast(
  product: PlanningProduct,
  params: PlannerParams,
): DemandForecastResult {
  const horizonMonths = params.horizonMonths ?? DEFAULT_HORIZON_MONTHS;
  const windowDays = params.windowDays ?? product.windowDays;
  const scenario = resolvedScenario(params);
  const scFactor = scenarioFactor(params.scenario);

  if (product.salesUnits <= 0) {
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

  const averageDailySales =
    windowDays > 0 ? product.salesUnits / windowDays : 0;

  const monthly: DemandForecastMonthlyLine[] = [];
  for (let monthIndex = 1; monthIndex <= horizonMonths; monthIndex += 1) {
    const calMonth = calendarMonthForLine(monthIndex);
    const seasonalityFactor = seasonalityFactorForProfile(
      product.seasonalityProfile,
      calMonth,
    );
    const forecastUnits = Math.ceil(
      averageDailySales * 30 * scFactor * seasonalityFactor,
    );
    monthly.push({
      monthIndex,
      forecastUnits,
      scenario,
      seasonalityFactor,
    });
  }

  return {
    productId: product.id,
    sku: product.sku,
    method: "HISTORICAL_SIMPLE",
    averageDailySales,
    monthly,
  };
}
