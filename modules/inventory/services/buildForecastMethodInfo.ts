// modules/inventory/services/buildForecastMethodInfo.ts
//
// Metadata informativa del método configurado vs efectivo (sin alterar cálculo).

import type { ForecastMethod, ProductForecastConfigUpsertBody } from "@/modules/planning/types";
import type { StockoutCorrectionResult } from "@/modules/planner/types/stockoutCorrection.types";
import {
  normalizeForecastMixWeights,
  resolveForecastMethod,
} from "@/modules/planner/services/resolveForecastMethod";
import {
  getForecastMethodDescription,
  type ForecastMethodDescription,
} from "./forecastMethodDescriptions";

export type ForecastMethodInfo = {
  configuredMethod: ForecastMethod;
  effectiveMethod: ForecastMethod;
  reason: string;
  fallbackApplied: boolean;
  title: string;
  description: string;
  businessSummary?: string;
  sourcesUsed: string[];
  sourcesNotUsed: string[];
  notices: string[];
  recommendedWhen: string;
  warnings: string[];
  primarySourceLabel: string;
  benchmarkApplied: boolean;
  capturePctApplied: number | null;
  mixOwnWeightPct: number | null;
  mixCompetitorWeightPct: number | null;
  dataAvailability: {
    hasOwnSales: boolean;
    hasBenchmark: boolean;
  };
};

export type BuildForecastMethodInfoInput = {
  configuredMethod: ForecastMethod;
  hasOwnSales: boolean;
  hasBenchmark: boolean;
  capturePct?: number | null;
  mixOwnWeight?: number | null;
  mixCompetitorWeight?: number | null;
  stockoutCorrectionEnabled?: boolean;
  /** Cobertura baja o riesgo de rotura (informativo). */
  stockoutRiskHint?: boolean;
  /** Etiqueta de horizonte para textos de fuente principal. */
  horizonLabel?: "anual" | "corto plazo";
  /** Ventas en la ventana reciente filtrada (p. ej. 30 días). */
  hasRecentWindowSales?: boolean;
  /** Histórico anual / año anterior disponible. */
  hasAnnualOwnSales?: boolean;
  /** Resultado de corrección por rotura histórica (anual). */
  stockoutCorrection?: StockoutCorrectionResult;
};

function pct(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 10;
}

function primarySourceLabel(
  effective: ForecastMethod,
  resolvedEffective: ForecastMethod,
  input: BuildForecastMethodInfoInput,
  mixOwn: number | null,
  mixComp: number | null,
): string {
  const horizon =
    input.horizonLabel === "anual"
      ? "ventas propias del año anterior"
      : "ventas propias recientes (ventana filtrada)";

  switch (resolvedEffective) {
    case "OWN_SALES_CORRECTED":
      return "ventas propias corregidas por roturas de stock FBA";
    case "COMPETITOR_BENCHMARK":
      return "benchmark de competidores seleccionados";
    case "MIXED":
      return `mixto (${mixOwn ?? 50}% histórico / ${mixComp ?? 50}% competidores)`;
    case "OWN_SALES":
      if (input.hasOwnSales) return horizon;
      if (input.hasAnnualOwnSales && input.horizonLabel === "corto plazo") {
        return "histórico anual (sin ventas en ventana reciente)";
      }
      return "sin histórico propio (fallback)";
    default:
      return horizon;
  }
}

function dynamicWarnings(
  configured: ForecastMethod,
  resolved: ReturnType<typeof resolveForecastMethod>,
  input: BuildForecastMethodInfoInput,
): string[] {
  const warnings: string[] = [];
  const { hasOwnSales, hasBenchmark } = input;

  if (configured === "COMPETITOR_BENCHMARK" && !hasBenchmark) {
    warnings.push(
      "No hay competidores seleccionados con ventas estimadas para este producto/país. Se aplicará fallback.",
    );
  }

  if (configured === "MIXED") {
    if (!hasBenchmark) {
      warnings.push(
        "No hay benchmark disponible. El forecast mixto usará solo ventas propias.",
      );
    }
    if (!hasOwnSales) {
      warnings.push(
        "No hay ventas propias. El forecast mixto usará solo benchmark.",
      );
    }
  }

  if (
    configured === "OWN_SALES_CORRECTED" &&
    input.stockoutCorrection?.applied
  ) {
    warnings.push(
      `Corrección aplicada: ventas reales ${Math.round(input.stockoutCorrection.totalActualSales)} uds → demanda corregida ${Math.round(input.stockoutCorrection.totalCorrectedSales)} uds/año.`,
    );
  } else if (
    (configured === "OWN_SALES" || configured === "OWN_SALES_CORRECTED") &&
    input.stockoutRiskHint &&
    configured !== "OWN_SALES_CORRECTED"
  ) {
    warnings.push(
      "Las ventas propias podrían estar infravaloradas si hubo rotura de stock.",
    );
  }

  if (resolved.fallbackApplied && configured !== "OWN_SALES_CORRECTED") {
    warnings.push(`Fallback aplicado: ${resolved.reason}`);
  }

  if (
    configured === "OWN_SALES_CORRECTED" &&
    resolved.fallbackApplied
  ) {
    warnings.push(`Fallback aplicado: ${resolved.reason}`);
  }

  if (
    input.horizonLabel === "corto plazo" &&
    input.hasAnnualOwnSales &&
    input.hasRecentWindowSales === false &&
    resolved.method === "OWN_SALES"
  ) {
    warnings.push(
      "Corto plazo reciente sin ventas; el forecast anual y la reposición usan histórico/forecast anual.",
    );
  }

  return warnings;
}

function benchmarkApplied(
  resolvedEffective: ForecastMethod,
  hasBenchmark: boolean,
): boolean {
  if (!hasBenchmark) return false;
  return (
    resolvedEffective === "COMPETITOR_BENCHMARK" ||
    resolvedEffective === "MIXED"
  );
}

export function buildForecastMethodInfo(
  input: BuildForecastMethodInfoInput,
): ForecastMethodInfo {
  const configured = input.configuredMethod ?? "AUTO";
  const resolved = resolveForecastMethod({
    configuredMethod: configured,
    hasOwnSales: input.hasOwnSales || input.hasAnnualOwnSales === true,
    hasBenchmark: input.hasBenchmark,
    stockoutCorrectionEnabled: input.stockoutCorrectionEnabled,
  });

  const staticDesc: ForecastMethodDescription =
    getForecastMethodDescription(configured);

  const { ownWeight, competitorWeight } = normalizeForecastMixWeights(
    input.mixOwnWeight,
    input.mixCompetitorWeight,
  );
  const mixOwnPct = configured === "MIXED" ? pct(ownWeight) : null;
  const mixCompPct = configured === "MIXED" ? pct(competitorWeight) : null;
  const capture =
    input.capturePct != null && Number.isFinite(input.capturePct)
      ? input.capturePct
      : 0.07;

  const warnings = dynamicWarnings(configured, resolved, input);

  return {
    configuredMethod: configured,
    effectiveMethod: resolved.method,
    reason: resolved.reason,
    fallbackApplied: resolved.fallbackApplied === true,
    title: staticDesc.title,
    description: staticDesc.description,
    businessSummary: staticDesc.businessSummary,
    sourcesUsed: staticDesc.sourcesUsed,
    sourcesNotUsed: staticDesc.sourcesNotUsed,
    notices: staticDesc.notices,
    recommendedWhen: staticDesc.recommendedWhen,
    warnings,
    primarySourceLabel: primarySourceLabel(
      configured,
      resolved.method,
      input,
      mixOwnPct,
      mixCompPct,
    ),
    benchmarkApplied: benchmarkApplied(resolved.method, input.hasBenchmark),
    capturePctApplied: benchmarkApplied(resolved.method, input.hasBenchmark)
      ? capture
      : null,
    mixOwnWeightPct: mixOwnPct,
    mixCompetitorWeightPct: mixCompPct,
    dataAvailability: {
      hasOwnSales: input.hasOwnSales || input.hasAnnualOwnSales === true,
      hasBenchmark: input.hasBenchmark,
    },
  };
}

export function buildForecastMethodInfoFromConfig(
  config: Pick<
    ProductForecastConfigUpsertBody,
    | "forecastMethod"
    | "forecastMixOwnWeight"
    | "forecastMixCompetitorWeight"
    | "competitorCapturePct"
    | "stockoutCorrectionEnabled"
  >,
  context: Omit<BuildForecastMethodInfoInput, "configuredMethod" | "capturePct" | "mixOwnWeight" | "mixCompetitorWeight" | "stockoutCorrectionEnabled">,
): ForecastMethodInfo {
  return buildForecastMethodInfo({
    configuredMethod: config.forecastMethod,
    capturePct: config.competitorCapturePct,
    mixOwnWeight: config.forecastMixOwnWeight,
    mixCompetitorWeight: config.forecastMixCompetitorWeight,
    stockoutCorrectionEnabled: config.stockoutCorrectionEnabled,
    ...context,
  });
}
