// modules/planning/services/getProductSupplyConfig.ts

import { findProductSupplyConfigByProductoId } from "../repositories/productSupplyConfigRepository";
import type {
  ForecastMethod,
  ProductSupplyConfig,
  ProductSupplyConfigGetResponse,
  ProductSupplyConfigRawRow,
} from "../types";
import { FORECAST_METHODS } from "../types/supply-config.types";

export function defaultProductSupplyConfig(productoId: string): ProductSupplyConfig {
  return {
    id: null,
    productoId,
    leadTimeProduccionDias: 30,
    leadTimeTransporteDias: 45,
    leadTimeAduanaDias: 7,
    stockSeguridadDias: 45,
    frecuenciaReposicionDias: 30,
    moq: 0,
    masterCartonQty: 0,
    puertoOrigen: null,
    puertoDestino: null,
    proveedorId: null,
    agenteId: null,
    forecastMethod: "AUTO",
    forecastMixOwnWeight: null,
    forecastMixCompetitorWeight: null,
    competitorCapturePct: null,
    stockoutCorrectionEnabled: false,
    createdAt: null,
  };
}

function toNullableNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseForecastMethod(value: string | null | undefined): ForecastMethod {
  const raw = (value ?? "AUTO").trim().toUpperCase();
  if ((FORECAST_METHODS as string[]).includes(raw)) {
    return raw as ForecastMethod;
  }
  return "AUTO";
}

function toInt(value: number | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function mapRawToProductSupplyConfig(
  row: ProductSupplyConfigRawRow
): ProductSupplyConfig {
  return {
    id: row.id,
    productoId: row.producto_id,
    leadTimeProduccionDias: toInt(row.lead_time_produccion_dias, 0),
    leadTimeTransporteDias: toInt(row.lead_time_transporte_dias, 0),
    leadTimeAduanaDias: toInt(row.lead_time_aduana_dias, 0),
    stockSeguridadDias: toInt(row.stock_seguridad_dias, 0),
    frecuenciaReposicionDias: toInt(row.frecuencia_reposicion_dias, 0),
    moq: toInt(row.moq, 0),
    masterCartonQty: toInt(row.master_carton_qty, 0),
    puertoOrigen: row.puerto_origen,
    puertoDestino: row.puerto_destino,
    proveedorId: row.proveedor_id,
    agenteId: row.agente_id,
    forecastMethod: parseForecastMethod(row.forecast_method),
    forecastMixOwnWeight: toNullableNumber(row.forecast_mix_own_weight),
    forecastMixCompetitorWeight: toNullableNumber(row.forecast_mix_competitor_weight),
    competitorCapturePct: toNullableNumber(row.competitor_capture_pct),
    stockoutCorrectionEnabled: row.stockout_correction_enabled === true,
    createdAt: row.created_at,
  };
}

export async function getProductSupplyConfig(
  productoId: string
): Promise<ProductSupplyConfigGetResponse> {
  const row = await findProductSupplyConfigByProductoId(productoId);

  return {
    ok: true,
    config: row ? mapRawToProductSupplyConfig(row) : defaultProductSupplyConfig(productoId),
  };
}
