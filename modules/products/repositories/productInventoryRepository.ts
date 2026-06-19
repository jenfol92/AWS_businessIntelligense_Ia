// modules/products/repositories/productInventoryRepository.ts

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

// Tabla: inventario_paises.
// Stock por país y marketplace.
export async function findProductInventoryByProductId(productId: string) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("inventario_paises")
    .select(`
      id,
      producto_id,
      pais,
      marketplace_id,
      stock_fba,
      stock_fbm,
      stock_pais,
      updated_at
    `)
    .eq("producto_id", productId)
    .order("pais", { ascending: true });

  if (error) throw new Error(error.message);

  return data ?? [];
}

// Vista: v_stock_seguridad_sugerido.
// Devuelve cobertura, riesgo y unidades a pedir.
export async function findProductStockSuggestion(productId: string) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("v_stock_seguridad_sugerido")
    .select("*")
    .eq("producto_id", productId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data;
}