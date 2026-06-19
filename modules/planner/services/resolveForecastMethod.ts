import type { ForecastMethod } from "@/modules/planning/types/supply-config.types";

export type ResolvedForecastMethod = {
  method: ForecastMethod;
  reason: string;
  fallbackApplied?: boolean;
};

export type ResolveForecastMethodInput = {
  configuredMethod: ForecastMethod | null | undefined;
  hasOwnSales: boolean;
  hasBenchmark: boolean;
  /** Reservado para fase stockout; no usado todavía. */
  stockoutCorrectionEnabled?: boolean;
};

/**
 * Resuelve el método efectivo de forecast según configuración del producto.
 * OWN_SALES_CORRECTED aplica corrección por rotura histórica FBA cuando hay ventas propias.
 */
export function resolveForecastMethod(
  input: ResolveForecastMethodInput,
): ResolvedForecastMethod {
  const configured = input.configuredMethod ?? "AUTO";

  switch (configured) {
    case "OWN_SALES":
      return {
        method: "OWN_SALES",
        reason: "Configurado explícitamente: solo ventas propias.",
      };

    case "COMPETITOR_BENCHMARK":
      return {
        method: "COMPETITOR_BENCHMARK",
        reason: "Configurado explícitamente: benchmarking de competidores.",
      };

    case "MIXED":
      return {
        method: "MIXED",
        reason: "Configurado explícitamente: mezcla ventas propias + competidores.",
      };

    case "OWN_SALES_CORRECTED":
      if (!input.hasOwnSales) {
        return {
          method: "OWN_SALES",
          reason:
            "OWN_SALES_CORRECTED sin ventas propias; fallback a flujo histórico/NO_HISTORY.",
          fallbackApplied: true,
        };
      }
      return {
        method: "OWN_SALES_CORRECTED",
        reason:
          "Ventas propias corregidas por días con stock histórico (v_product_fba_stock_daily).",
      };

    case "MANUAL":
      return {
        method: "AUTO",
        reason: "MANUAL sin override implementado; se usa AUTO.",
        fallbackApplied: true,
      };

    case "AUTO":
    default:
      if (input.hasOwnSales) {
        return {
          method: "OWN_SALES",
          reason: "AUTO: hay ventas propias; se usa histórico.",
        };
      }
      if (input.hasBenchmark) {
        return {
          method: "COMPETITOR_BENCHMARK",
          reason: "AUTO: sin ventas propias pero con benchmark disponible.",
        };
      }
      return {
        method: "OWN_SALES",
        reason: "AUTO: sin ventas ni benchmark; se mantiene flujo histórico/NO_HISTORY.",
      };
  }
}

/** Normaliza pesos de mezcla (0–1); default 50/50 si faltan o suman 0. */
export function normalizeForecastMixWeights(
  ownWeight: number | null | undefined,
  competitorWeight: number | null | undefined,
): { ownWeight: number; competitorWeight: number } {
  let own = ownWeight ?? 0.5;
  let competitor = competitorWeight ?? 0.5;
  if (own < 0) own = 0;
  if (competitor < 0) competitor = 0;
  const sum = own + competitor;
  if (sum <= 0) return { ownWeight: 0.5, competitorWeight: 0.5 };
  return { ownWeight: own / sum, competitorWeight: competitor / sum };
}
