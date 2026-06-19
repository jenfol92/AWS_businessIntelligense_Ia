// modules/products/repositories/productDetailRepository.ts

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

// Tabla: producto_detalle.
// Aquí van datos descriptivos, imagen, categoría, marca, color...
// Nota: `categoria_id` requiere columna en Supabase; si no existe, quitar del select o crear migración.
export async function findProductDetailByProductId(productId: string) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("producto_detalle")
    .select(`
      id,
      producto_id,
      descripcion_tecnica,
      imagen_url,
      categoria_id,
      marca,
      color,
      created_at,
      categoria:categorias(
        id,
        nombre
      )
  
    `)
    .eq("producto_id", productId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data;
}

// Crea o actualiza detalle por producto_id.
export async function upsertProductDetail(
  productId: string,
  payload: Record<string, unknown>
) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("producto_detalle")
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