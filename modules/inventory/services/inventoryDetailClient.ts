// modules/inventory/services/inventoryDetailClient.ts

import type { ProductForecastConfigUpsertBody } from "@/modules/planning/types";
import type {
  InventoryProductCoreResponse,
  InventoryProductForecastResponse,
} from "../types/inventory.types";
import { appendForecastConfigOverrideToSearchParams } from "./parseForecastConfigOverride";

export type FetchInventoryDetailParams = {
  canal?: string | null;
  pais?: string | null;
  windowDays?: number;
  periodFrom?: string | null;
  periodTo?: string | null;
  forecastOverride?: ProductForecastConfigUpsertBody | null;
  debugStockout?: boolean;
  signal?: AbortSignal;
};

export async function fetchInventoryProductDetail(
  productId: string,
  params: FetchInventoryDetailParams = {},
): Promise<InventoryProductCoreResponse> {
  const q = new URLSearchParams();
  if (params.canal && params.canal !== "ALL") q.set("canal", params.canal);
  if (params.pais && params.pais !== "ALL") q.set("pais", params.pais);
  if (params.windowDays) q.set("windowDays", String(params.windowDays));
  if (params.periodFrom) q.set("periodFrom", params.periodFrom);
  if (params.periodTo) q.set("periodTo", params.periodTo);
  if (params.forecastOverride) {
    appendForecastConfigOverrideToSearchParams(q, params.forecastOverride);
  }
  if (params.debugStockout) {
    q.set("debugStockout", "1");
  }

  const res = await fetch(
    `/api/inventory/product/${encodeURIComponent(productId)}?${q.toString()}`,
    { cache: "no-store", signal: params.signal },
  );
  const json = (await res.json()) as InventoryProductCoreResponse | {
    ok: false;
    error: string;
  };

  if (!res.ok || json.ok === false) {
    throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
  }

  return json;
}
export async function fetchInventoryProductForecast(
  productId: string,
  params: FetchInventoryDetailParams = {},
): Promise<InventoryProductForecastResponse> {
  const q = new URLSearchParams();

  if (params.canal && params.canal !== "ALL") {
    q.set("canal", params.canal);
  }

  if (params.pais && params.pais !== "ALL") {
    q.set("pais", params.pais);
  }

  if (params.windowDays) {
    q.set("windowDays", String(params.windowDays));
  }

  if (params.periodFrom) {
    q.set("periodFrom", params.periodFrom);
  }

  if (params.periodTo) {
    q.set("periodTo", params.periodTo);
  }

  if (params.forecastOverride) {
    appendForecastConfigOverrideToSearchParams(
      q,
      params.forecastOverride,
    );
  }

  if (params.debugStockout) {
    q.set("debugStockout", "1");
  }

  const res = await fetch(
    `/api/inventory/product/${encodeURIComponent(productId)}/forecast?${q.toString()}`,
    {
      cache: "no-store",
      signal: params.signal,
    },
  );

  const json = (await res.json()) as
    | InventoryProductForecastResponse
    | {
        ok: false;
        error: string;
      };

  if (!res.ok || json.ok === false) {
    throw new Error(
      "error" in json ? json.error : `HTTP ${res.status}`,
    );
  }

  return json;
}

export type FetchInventorySalesParams = {
  fromDate: string;
  toDate: string;
  canal?: string | null;
  pais?: string | null;
  signal?: AbortSignal;
};

async function getJsonOrThrow<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal });
  const json = (await res.json().catch(() => null)) as (T & { ok?: boolean }) | { ok: false; error: string } | null;
  if (!res.ok || !json || json.ok === false) {
    throw new Error(json && "error" in json ? String(json.error) : `HTTP ${res.status}`);
  }
  return json as T;
}

/** Ventas del producto por país de marketplace en el periodo. */
export async function fetchInventorySalesByCountry(
  productId: string,
  params: FetchInventorySalesParams,
): Promise<import("../types/inventory.types").InventorySalesByCountryResponse> {
  const q = new URLSearchParams({ fromDate: params.fromDate, toDate: params.toDate });
  if (params.canal && params.canal !== "ALL") q.set("canal", params.canal);
  if (params.pais && params.pais !== "ALL") q.set("pais", params.pais);
  return getJsonOrThrow(
    `/api/inventory/product/${encodeURIComponent(productId)}/sales-by-country?${q.toString()}`,
    params.signal,
  );
}

/** Detalle de ventas de un país: precios y líneas de venta. */
export async function fetchInventorySalesCountryDetail(
  productId: string,
  country: string,
  params: FetchInventorySalesParams,
): Promise<import("../types/inventory.types").InventorySalesCountryDetailResponse> {
  const q = new URLSearchParams({ fromDate: params.fromDate, toDate: params.toDate });
  if (params.canal && params.canal !== "ALL") q.set("canal", params.canal);
  return getJsonOrThrow(
    `/api/inventory/product/${encodeURIComponent(productId)}/sales-by-country/${encodeURIComponent(country)}?${q.toString()}`,
    params.signal,
  );
}
