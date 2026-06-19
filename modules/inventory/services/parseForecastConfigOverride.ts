// modules/inventory/services/parseForecastConfigOverride.ts
//
// Parsea overrides temporales de forecast desde query params (simulación sin guardar).

import type { ProductForecastConfigUpsertBody } from "@/modules/planning/types";
import { FORECAST_METHODS, type ForecastMethod } from "@/modules/planning/types/supply-config.types";

function parseOptionalDecimal(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseForecastMethod(raw: string | null): ForecastMethod | null {
  if (!raw?.trim()) return null;
  const value = raw.trim().toUpperCase();
  if ((FORECAST_METHODS as string[]).includes(value)) {
    return value as ForecastMethod;
  }
  return null;
}

function parseBoolean(raw: string | null): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Devuelve override solo si `forecastMethod` está en la query.
 * Sin ese param → null (usar configuración persistida en BD).
 */
export function parseForecastConfigOverrideFromSearchParams(
  params: URLSearchParams,
): ProductForecastConfigUpsertBody | null {
  const forecastMethod = parseForecastMethod(params.get("forecastMethod"));
  if (!forecastMethod) return null;

  return {
    forecastMethod,
    forecastMixOwnWeight: parseOptionalDecimal(
      params.get("forecastMixOwnWeight"),
    ),
    forecastMixCompetitorWeight: parseOptionalDecimal(
      params.get("forecastMixCompetitorWeight"),
    ),
    competitorCapturePct: parseOptionalDecimal(params.get("competitorCapturePct")),
    stockoutCorrectionEnabled: parseBoolean(
      params.get("stockoutCorrectionEnabled"),
    ),
  };
}

export function appendForecastConfigOverrideToSearchParams(
  params: URLSearchParams,
  override: ProductForecastConfigUpsertBody,
): void {
  params.set("forecastMethod", override.forecastMethod);
  if (override.forecastMixOwnWeight != null) {
    params.set("forecastMixOwnWeight", String(override.forecastMixOwnWeight));
  }
  if (override.forecastMixCompetitorWeight != null) {
    params.set(
      "forecastMixCompetitorWeight",
      String(override.forecastMixCompetitorWeight),
    );
  }
  if (override.competitorCapturePct != null) {
    params.set("competitorCapturePct", String(override.competitorCapturePct));
  }
  params.set(
    "stockoutCorrectionEnabled",
    override.stockoutCorrectionEnabled ? "true" : "false",
  );
}
