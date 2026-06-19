// modules/planning/repositories/productSupplyConfigRepository.ts

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type {
  ProductForecastConfigUpsertRaw,
  ProductSupplyConfigRawRow,
  ProductSupplyConfigUpsertRaw,
} from "../types";

const TABLE = "producto_supply_config";

/**
 * Una fila por producto (`producto_id` único) para upsert.
 */
export async function findProductSupplyConfigByProductoId(
  producto_id: string
): Promise<ProductSupplyConfigRawRow | null> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("producto_id", producto_id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? null) as ProductSupplyConfigRawRow | null;
}

/** Config supply por lote (planner / forecast batch). */
export async function findProductSupplyConfigsByProductoIds(
  productoIds: string[],
): Promise<Map<string, ProductSupplyConfigRawRow>> {
  const map = new Map<string, ProductSupplyConfigRawRow>();
  if (productoIds.length === 0) return map;

  const supabase = createSupabaseRouteClient();
  const unique = Array.from(new Set(productoIds.filter(Boolean)));

  for (let i = 0; i < unique.length; i += 150) {
    const chunk = unique.slice(i, i + 150);
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .in("producto_id", chunk);

    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      const r = row as ProductSupplyConfigRawRow;
      map.set(r.producto_id, r);
    }
  }

  return map;
}

export async function upsertProductSupplyConfigRow(
  payload: ProductSupplyConfigUpsertRaw
): Promise<ProductSupplyConfigRawRow> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(payload, { onConflict: "producto_id" })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as ProductSupplyConfigRawRow;
}

function mapDefaultsToInsertRaw(
  productoId: string,
  forecast: ProductForecastConfigUpsertRaw,
): ProductSupplyConfigUpsertRaw {
  return {
    producto_id: productoId,
    lead_time_produccion_dias: 30,
    lead_time_transporte_dias: 45,
    lead_time_aduana_dias: 7,
    stock_seguridad_dias: 45,
    frecuencia_reposicion_dias: 30,
    moq: 0,
    master_carton_qty: 0,
    puerto_origen: null,
    puerto_destino: null,
    proveedor_id: null,
    agente_id: null,
    forecast_method: forecast.forecast_method,
    forecast_mix_own_weight: forecast.forecast_mix_own_weight,
    forecast_mix_competitor_weight: forecast.forecast_mix_competitor_weight,
    competitor_capture_pct: forecast.competitor_capture_pct,
    stockout_correction_enabled: forecast.stockout_correction_enabled,
  };
}

/** Actualiza solo columnas de forecast sin tocar logística existente. */
export async function updateProductForecastConfigRow(
  productoId: string,
  forecast: ProductForecastConfigUpsertRaw,
): Promise<ProductSupplyConfigRawRow> {
  const existing = await findProductSupplyConfigByProductoId(productoId);
  if (!existing) {
    return upsertProductSupplyConfigRow(
      mapDefaultsToInsertRaw(productoId, forecast),
    );
  }

  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      ...forecast,
      updated_at: new Date().toISOString(),
    })
    .eq("producto_id", productoId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as ProductSupplyConfigRawRow;
}
