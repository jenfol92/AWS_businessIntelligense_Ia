import type { ReplenishmentDemand } from "../types/replenishment.types";

export type ResolveReplenishmentDemandInput = {  /** Forecast mensual efectivo (12 meses, índice 0 = enero). */
  annualForecastMonthly?: number[];
  recentSales30?: number;
  recentSales90?: number;
  previousYearTotal?: number;
  benchmarkMonthlyUnits?: number;
  /** Forecast corto plazo del planner (fallback si no hay mensual anual). */
  plannerForecastMonth1Units?: number;
  referenceDate?: Date;
  /** Forecast anual ya corregido por rotura histórica (OWN_SALES_CORRECTED). */
  useStockoutCorrectedForecast?: boolean;
};

function daysInCalendarMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function pickAnnualForecastMonth(
  monthly: number[],
  refDate: Date,
): { monthIndex0: number; units: number } | null {
  if (monthly.length === 0) return null;

  const padded =
    monthly.length >= 12
      ? monthly.slice(0, 12)
      : [...monthly, ...Array.from({ length: 12 - monthly.length }, () => 0)];

  const current = refDate.getUTCMonth();
  const next = (current + 1) % 12;

  const candidates = [current, next];
  for (const idx of candidates) {
    const units = Number(padded[idx] ?? 0);
    if (units > 0) return { monthIndex0: idx, units };
  }

  for (let idx = 0; idx < 12; idx += 1) {
    const units = Number(padded[idx] ?? 0);
    if (units > 0) return { monthIndex0: idx, units };
  }

  return null;
}

export function resolveReplenishmentDemand(
  input: ResolveReplenishmentDemandInput,
): ReplenishmentDemand {
  const refDate = input.referenceDate ?? new Date();
  const year = refDate.getUTCFullYear();
  const warnings: string[] = [];

  const annualPick = input.annualForecastMonthly
    ? pickAnnualForecastMonth(input.annualForecastMonthly, refDate)
    : null;

  if (annualPick && annualPick.units > 0) {
    const days = daysInCalendarMonth(year, annualPick.monthIndex0);
    const dailyDemand = annualPick.units / days;
    const monthName = [
      "enero",
      "febrero",
      "marzo",
      "abril",
      "mayo",
      "junio",
      "julio",
      "agosto",
      "septiembre",
      "octubre",
      "noviembre",
      "diciembre",
    ][annualPick.monthIndex0];

    if ((input.recentSales30 ?? 0) <= 0) {
      warnings.push(
        "No hay ventas recientes en 30 días, pero existe histórico/forecast anual. La reposición usa el forecast anual como base de demanda.",
      );
    }

    return {
      dailyDemand,
      monthlyDemand: annualPick.units,
      source: input.useStockoutCorrectedForecast
        ? "ANNUAL_FORECAST_CORRECTED"
        : "ANNUAL_FORECAST_MONTH",
      basis: input.useStockoutCorrectedForecast
        ? `Forecast corregido ${monthName}: ${annualPick.units} uds / ${days} días (rotura histórica)`
        : `Forecast ${monthName}: ${annualPick.units} uds / ${days} días`,
      warnings,
    };
  }

  const plannerMonth1 = Number(input.plannerForecastMonth1Units ?? 0);
  if (plannerMonth1 > 0) {
    const days = daysInCalendarMonth(year, refDate.getUTCMonth());
    return {
      dailyDemand: plannerMonth1 / days,
      monthlyDemand: plannerMonth1,
      source: "ANNUAL_FORECAST_MONTH",
      basis: `Forecast mes actual (planner): ${plannerMonth1} uds / ${days} días`,
      warnings,
    };
  }

  const sales90 = Number(input.recentSales90 ?? 0);
  if (sales90 > 0) {
    return {
      dailyDemand: sales90 / 90,
      monthlyDemand: (sales90 / 90) * 30,
      source: "RECENT_90D",
      basis: `Ventas 90 días: ${sales90} uds / 90`,
      warnings,
    };
  }

  const sales30 = Number(input.recentSales30 ?? 0);
  if (sales30 > 0) {
    return {
      dailyDemand: sales30 / 30,
      monthlyDemand: sales30,
      source: "RECENT_30D",
      basis: `Ventas 30 días: ${sales30} uds / 30`,
      warnings,
    };
  }

  const annualTotal = Number(input.previousYearTotal ?? 0);
  if (annualTotal > 0) {
    warnings.push(
      "No hay ventas recientes en 30 días, pero existe histórico anual. La reposición usa el forecast anual como base de demanda.",
    );
    return {
      dailyDemand: annualTotal / 365,
      monthlyDemand: (annualTotal / 365) * 30,
      source: "ANNUAL_AVERAGE",
      basis: `Media anual: ${annualTotal} uds / 365 días`,
      warnings,
    };
  }

  const benchmarkMonthly = Number(input.benchmarkMonthlyUnits ?? 0);
  if (benchmarkMonthly > 0) {
    const days = daysInCalendarMonth(year, refDate.getUTCMonth());
    return {
      dailyDemand: benchmarkMonthly / days,
      monthlyDemand: benchmarkMonthly,
      source: "BENCHMARK",
      basis: `Benchmark competidor: ${benchmarkMonthly} uds/mes`,
      warnings,
    };
  }

  warnings.push(
    "Sin demanda diaria estimada; no se calcula punto de pedido ni unidades recomendadas.",
  );

  return {
    dailyDemand: 0,
    monthlyDemand: 0,
    source: "NO_DATA",
    basis: "Sin histórico, forecast ni benchmark aplicable",
    warnings,
  };
}
