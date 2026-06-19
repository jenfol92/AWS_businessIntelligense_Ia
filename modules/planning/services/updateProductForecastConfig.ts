// modules/planning/services/updateProductForecastConfig.ts

import { updateProductForecastConfigRow } from "../repositories/productSupplyConfigRepository";
import type {
  ForecastMethod,
  ProductForecastConfigUpsertBody,
  ProductForecastConfigUpsertResponse,
  ProductForecastConfigUpsertRaw,
} from "../types";
import { FORECAST_METHODS } from "../types/supply-config.types";
import { mapRawToProductSupplyConfig } from "./getProductSupplyConfig";

function toNullableNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseForecastMethod(value: unknown): ForecastMethod {
  const raw = String(value ?? "AUTO")
    .trim()
    .toUpperCase();
  if ((FORECAST_METHODS as string[]).includes(raw)) {
    return raw as ForecastMethod;
  }
  return "AUTO";
}

function assertWeightRange(
  value: number | null,
  label: string,
): void {
  if (value == null) return;
  if (value < 0 || value > 1) {
    throw new Error(`${label} debe estar entre 0 y 1.`);
  }
}

export function parseProductForecastConfigUpsertBody(
  raw: unknown,
): ProductForecastConfigUpsertBody {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("El cuerpo debe ser un objeto JSON.");
  }

  const body = raw as Record<string, unknown>;
  const forecastMethod = parseForecastMethod(body.forecastMethod);
  const forecastMixOwnWeight = toNullableNumber(
    body.forecastMixOwnWeight as number | null | undefined,
  );
  const forecastMixCompetitorWeight = toNullableNumber(
    body.forecastMixCompetitorWeight as number | null | undefined,
  );
  const competitorCapturePct = toNullableNumber(
    body.competitorCapturePct as number | null | undefined,
  );

  assertWeightRange(forecastMixOwnWeight, "forecastMixOwnWeight");
  assertWeightRange(forecastMixCompetitorWeight, "forecastMixCompetitorWeight");
  assertWeightRange(competitorCapturePct, "competitorCapturePct");

  return {
    forecastMethod,
    forecastMixOwnWeight,
    forecastMixCompetitorWeight,
    competitorCapturePct,
    stockoutCorrectionEnabled: body.stockoutCorrectionEnabled === true,
  };
}

function mapBodyToRaw(
  body: ProductForecastConfigUpsertBody,
): ProductForecastConfigUpsertRaw {
  return {
    forecast_method: body.forecastMethod,
    forecast_mix_own_weight: body.forecastMixOwnWeight,
    forecast_mix_competitor_weight: body.forecastMixCompetitorWeight,
    competitor_capture_pct: body.competitorCapturePct,
    stockout_correction_enabled: body.stockoutCorrectionEnabled,
  };
}

export async function updateProductForecastConfig(
  productoId: string,
  body: ProductForecastConfigUpsertBody,
): Promise<ProductForecastConfigUpsertResponse> {
  const row = await updateProductForecastConfigRow(
    productoId,
    mapBodyToRaw(body),
  );

  return {
    ok: true,
    config: mapRawToProductSupplyConfig(row),
  };
}
