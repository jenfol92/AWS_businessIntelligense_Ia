// modules/products/repositories/productFinanceRepository.ts

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

// Tabla: producto_finanzas.
// Aquí va el precio objetivo y categoría fiscal asociada.
export async function findProductFinanceByProductId(productId: string) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("producto_finanzas")
    .select(`
      id,
      producto_id,
      precio_venta_objetivo,
      tax_category_id,
      created_at
    `)
    .eq("producto_id", productId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data;
}

// Crea o actualiza finanzas por producto_id.
export async function upsertProductFinance(
  productId: string,
  payload: Record<string, unknown>
) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("producto_finanzas")
    .upsert(
      {
        producto_id: productId,
        ...payload,
      },
      { onConflict: "producto_id" }
    )
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  return data;
}