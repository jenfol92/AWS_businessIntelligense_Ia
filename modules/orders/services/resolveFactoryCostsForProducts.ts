import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getLatestConfirmedFactoryCostByProductRefs,
  getLatestFactoryCostByProductIds,
  type LatestFactoryCost,
  type ProductSupplierCostRef,
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

/**
 * Coste de fabrica para busqueda de productos en ordenes:
 * 1. ultimo orden_items confirmado/recibido por producto + proveedor
 * 2. ultimo orden_items confirmado/recibido por producto
 * 3. producto_costos/base como fallback
 */
export async function resolveFactoryCostsForProductSearch(
  refs: ProductSupplierCostRef[],
  supabase?: SupabaseClient,
  currency?: string | null,
): Promise<Map<string, LatestFactoryCost>> {
  const result = new Map<string, LatestFactoryCost>();
  const uniqueRefs = Array.from(
    new Map(
      refs
        .filter((ref) => Boolean(ref.producto_id))
        .map((ref) => [
          `${ref.producto_id}:${ref.proveedor_id ?? ""}`,
          {
            producto_id: ref.producto_id,
            proveedor_id: ref.proveedor_id ?? null,
          },
        ]),
    ).values(),
  );

  if (uniqueRefs.length === 0) return result;

  const historical = await getLatestConfirmedFactoryCostByProductRefs(uniqueRefs, supabase, currency);
  for (const ref of uniqueRefs) {
    const key = `${ref.producto_id}:${ref.proveedor_id ?? ""}`;
    const cost = historical.get(key);
    if (cost) result.set(key, cost);
  }

  const missingProductIds = Array.from(
    new Set(
      uniqueRefs
        .filter((ref) => !result.has(`${ref.producto_id}:${ref.proveedor_id ?? ""}`))
        .map((ref) => ref.producto_id),
    ),
  );

  if (missingProductIds.length === 0) return result;

  const fallback = await resolveFactoryCostsForProducts(missingProductIds, supabase);
  for (const ref of uniqueRefs) {
    const key = `${ref.producto_id}:${ref.proveedor_id ?? ""}`;
    if (result.has(key)) continue;
    const cost = fallback.get(ref.producto_id);
    if (cost) result.set(key, cost);
  }

  return result;
}
