import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getLatestFactoryCostByProductIds,
  type LatestFactoryCost,
} from "@/modules/orders/repositories/orderProductCostsRepository";
import { getProductBaseCostByProductIds } from "@/modules/products/repositories/productCostsRepository";

/**
 * Último coste de fábrica por producto (producto_costos) con fallback al padre.
 */
export async function resolveFactoryCostsForProducts(
  productIds: string[],
  supabase?: SupabaseClient,
): Promise<Map<string, LatestFactoryCost>> {
  const map = await getLatestFactoryCostByProductIds(productIds, supabase);
  const missing = productIds.filter((pid) => {
    const row = map.get(pid);
    return !row?.costo_fabrica_monto || row.costo_fabrica_monto <= 0;
  });

  if (missing.length === 0) return map;

  const baseCosts = await getProductBaseCostByProductIds(missing);
  for (const pid of missing) {
    if (map.get(pid)?.costo_fabrica_monto) continue;
    const base = baseCosts.get(pid);
    if (!base?.monto || base.monto <= 0) continue;
    map.set(pid, {
      producto_id: pid,
      costo_fabrica_monto: base.monto,
      costo_fabrica_moneda: base.moneda,
      tipo_cambio_aplicado: null,
      costo_fabrica_eur: null,
      fecha: null,
      contenedor_id: null,
    });
  }

  return map;
}
