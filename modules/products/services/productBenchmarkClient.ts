// modules/products/services/productBenchmarkClient.ts

import type {
  GetProductBenchmarkCompetitorsResponse,
  ProductBenchmarkCompetitorRow,
  PutProductBenchmarkSelectionBody,
  PutProductBenchmarkSelectionResponse,
} from "../types/competitor-benchmark-selection.types";
import type {
  ForecastMethod,
  ProductForecastConfigUpsertBody,
  ProductSupplyConfig,
} from "@/modules/planning/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export async function fetchProductBenchmarkCompetitors(
  productId: string,
  marketplaceCountry = "ES",
): Promise<GetProductBenchmarkCompetitorsResponse> {
  const params = new URLSearchParams({ marketplaceCountry });
  const res = await fetch(
    `/api/products/${encodeURIComponent(productId)}/benchmarking/competitors?${params}`,
    { cache: "no-store" },
  );
  const payload: unknown = await res.json();

  if (!res.ok || !isRecord(payload) || payload.ok !== true) {
    const errMsg =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `Error ${res.status} al cargar competidores.`;
    throw new Error(errMsg);
  }

  return payload as GetProductBenchmarkCompetitorsResponse;
}

export async function saveProductBenchmarkSelection(
  productId: string,
  body: PutProductBenchmarkSelectionBody,
): Promise<PutProductBenchmarkSelectionResponse> {
  const res = await fetch(
    `/api/products/${encodeURIComponent(productId)}/benchmarking/selection`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const payload: unknown = await res.json();

  if (!res.ok || !isRecord(payload) || payload.ok !== true) {
    const errMsg =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `Error ${res.status} al guardar selección.`;
    throw new Error(errMsg);
  }

  return payload as PutProductBenchmarkSelectionResponse;
}

export type ProductForecastConfigFormState = {
  forecastMethod: ForecastMethod;
  forecastMixOwnWeight: number | null;
  forecastMixCompetitorWeight: number | null;
  competitorCapturePct: number | null;
  stockoutCorrectionEnabled: boolean;
};

export function forecastConfigFromSupplyConfig(
  config: ProductSupplyConfig,
): ProductForecastConfigFormState {
  return {
    forecastMethod: config.forecastMethod,
    forecastMixOwnWeight: config.forecastMixOwnWeight,
    forecastMixCompetitorWeight: config.forecastMixCompetitorWeight,
    competitorCapturePct: config.competitorCapturePct,
    stockoutCorrectionEnabled: config.stockoutCorrectionEnabled,
  };
}

export async function fetchProductForecastConfig(
  productId: string,
): Promise<ProductForecastConfigFormState> {
  const res = await fetch(
    `/api/planning/products/${encodeURIComponent(productId)}/supply-config/forecast`,
    { cache: "no-store" },
  );
  const payload: unknown = await res.json();

  if (!res.ok || !isRecord(payload) || payload.ok !== true) {
    const errMsg =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `Error ${res.status} al cargar configuración de forecast.`;
    throw new Error(errMsg);
  }

  const config = payload.config;
  if (!isRecord(config)) {
    throw new Error("Respuesta inválida del servidor.");
  }

  return {
    forecastMethod: (config.forecastMethod as ForecastMethod) ?? "AUTO",
    forecastMixOwnWeight:
      config.forecastMixOwnWeight != null
        ? Number(config.forecastMixOwnWeight)
        : null,
    forecastMixCompetitorWeight:
      config.forecastMixCompetitorWeight != null
        ? Number(config.forecastMixCompetitorWeight)
        : null,
    competitorCapturePct:
      config.competitorCapturePct != null
        ? Number(config.competitorCapturePct)
        : null,
    stockoutCorrectionEnabled: config.stockoutCorrectionEnabled === true,
  };
}

export async function saveProductForecastConfig(
  productId: string,
  body: ProductForecastConfigUpsertBody,
): Promise<ProductForecastConfigFormState> {
  const res = await fetch(
    `/api/planning/products/${encodeURIComponent(productId)}/supply-config/forecast`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const payload: unknown = await res.json();

  if (!res.ok || !isRecord(payload) || payload.ok !== true) {
    const errMsg =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `Error ${res.status} al guardar configuración de forecast.`;
    throw new Error(errMsg);
  }

  const config = payload.config;
  if (!isRecord(config)) {
    throw new Error("Respuesta inválida tras guardar.");
  }

  return forecastConfigFromSupplyConfig(config as unknown as ProductSupplyConfig);
}

export type { ProductBenchmarkCompetitorRow };
