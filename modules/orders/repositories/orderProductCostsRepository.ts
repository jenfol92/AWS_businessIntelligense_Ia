import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export type LatestFactoryCost = {
  producto_id: string;
  costo_fabrica_monto: number | null;
  costo_fabrica_moneda: string | null;
  tipo_cambio_aplicado: number | null;
  costo_fabrica_eur: number | null;
  fecha: string | null;
  contenedor_id: string | null;
};

function normalizeRow(row: Record<string, unknown>): LatestFactoryCost {
  const monto = row.costo_fabrica_monto;
  return {
    producto_id: String(row.producto_id),
    costo_fabrica_monto:
      monto != null && Number(monto) > 0 ? Number(monto) : null,
    costo_fabrica_moneda: row.costo_fabrica_moneda
      ? String(row.costo_fabrica_moneda).toUpperCase()
      : null,
    tipo_cambio_aplicado:
      row.tipo_cambio_aplicado != null && Number.isFinite(Number(row.tipo_cambio_aplicado))
        ? Number(row.tipo_cambio_aplicado)
        : null,
    costo_fabrica_eur:
      row.costo_fabrica_eur != null && Number(row.costo_fabrica_eur) > 0
        ? Number(row.costo_fabrica_eur)
        : null,
    fecha: row.fecha ? String(row.fecha).slice(0, 10) : null,
    contenedor_id: row.contenedor_id ? String(row.contenedor_id) : null,
  };
}

/**
 * Último coste de fábrica por producto desde producto_costos (fecha desc).
 */
export async function getLatestFactoryCostByProductIds(
  productIds: string[],
  supabase: SupabaseClient = createSupabaseRouteClient(),
): Promise<Map<string, LatestFactoryCost>> {
  const map = new Map<string, LatestFactoryCost>();
  if (productIds.length === 0) return map;

  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));

  const { data, error } = await supabase
    .from("producto_costos")
    .select(
      "producto_id, costo_fabrica_monto, costo_fabrica_moneda, tipo_cambio_aplicado, costo_fabrica_eur, fecha, contenedor_id",
    )
    .in("producto_id", uniqueIds)
    .order("fecha", { ascending: false });

  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const pid = String(row.producto_id);
    if (map.has(pid)) continue;
    map.set(pid, normalizeRow(row));
  }

  return map;
}
