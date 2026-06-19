// modules/products/repositories/productTechnicalSheetRepository.ts

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

// Tabla: producto_ficha_tecnica.
// Datos técnicos/descriptivos. Medidas de caja legacy (*_caja_cm, peso_bruto_kg) solo lectura.
export async function findProductTechnicalSheetByProductId(productId: string) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("producto_ficha_tecnica")
    .select(`
      id,
      producto_id,
      modelo,
      peso_neto_kg,
      peso_bruto_kg,
      alto_caja_cm,
      ancho_caja_cm,
      largo_caja_cm,
      alto_abierto_cm,
      ancho_abierto_cm,
      fondo_abierto_cm,
      alto_plegado_cm,
      ancho_plegado_cm,
      fondo_plegado_cm,
      diametro_ruedas_cm,
      material_estructura,
      material_tapizado,
      material_ruedas,
      edad_minima_aplicable,
      edad_maxima_aplicable,
      created_at
    `)
    .eq("producto_id", productId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data;
}

// Crea o actualiza ficha técnica por producto_id.
export async function upsertProductTechnicalSheet(
  productId: string,
  payload: Record<string, unknown>
) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("producto_ficha_tecnica")
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