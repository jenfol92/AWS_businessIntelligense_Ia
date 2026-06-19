import type { ForecastMethod } from "@/modules/planning/types";

export const FORECAST_METHOD_BUSINESS_LABELS: Record<ForecastMethod, string> = {
  AUTO: "Automático",
  OWN_SALES: "Histórico propio",
  OWN_SALES_CORRECTED: "Histórico corregido por roturas",
  MIXED: "Mixto histórico + competencia",
  MANUAL: "Manual",
  COMPETITOR_BENCHMARK: "Competidores",
};

/** Métodos visibles en selector (AUTO se resuelve internamente). */
export const SELECTABLE_FORECAST_METHODS: ForecastMethod[] = [
  "OWN_SALES",
  "OWN_SALES_CORRECTED",
  "MIXED",
  "MANUAL",
  "COMPETITOR_BENCHMARK",
];

export function forecastMethodBusinessLabel(
  method: ForecastMethod | string | null | undefined,
): string {
  if (!method) return "—";
  const key = method as ForecastMethod;
  return FORECAST_METHOD_BUSINESS_LABELS[key] ?? String(method);
}

export function usesCompetitorCapture(
  method: ForecastMethod | null | undefined,
): boolean {
  return method === "MIXED" || method === "COMPETITOR_BENCHMARK";
}

/** Si la config guardada es AUTO, devuelve el método efectivo para mostrar en UI. */
export function resolveDisplayForecastMethod(
  configured: ForecastMethod | null | undefined,
  effective: ForecastMethod | null | undefined,
): ForecastMethod {
  if (configured && configured !== "AUTO") return configured;
  return effective ?? configured ?? "OWN_SALES";
}
