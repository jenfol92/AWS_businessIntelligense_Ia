// modules/products/repositories/productCoreRepository.ts

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

// Tabla principal: productos.
// Aquí solo van datos núcleo del producto.
export async function findProductCoreById(productId: string) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("productos")
    .select(`
      id,
      sku,
      nombre,
      asin,
      arancel_porcentaje,
      stock_seguridad_minimo,
      proveedor_id,
      created_at,
      updated_at,
      last_ordered_at,
      discontinued_at,
      estado,
      stock_defectuoso_total,
      tax_category_id,
      especificaciones,
      lote_producto_actual,
      parent_id,
      heredar_precio
    `)
    .eq("id", productId)
    .single();

  if (error) throw new Error(error.message);

  return data;
}

// Lista base de productos, útil para selects, buscadores o relaciones.
export async function findProductCoreList(params?: {
  q?: string;
  limit?: number;
}) {
  const supabase = createSupabaseRouteClient();

  let query = supabase
    .from("productos")
    .select(`
      id,
      sku,
      nombre,
      asin,
      estado,
      proveedor_id,
      parent_id,
      heredar_precio,
      updated_at
    `)
    .order("updated_at", { ascending: false })
    .limit(params?.limit ?? 200);

  if (params?.q) {
    query = query.or(
      `sku.ilike.%${params.q}%,nombre.ilike.%${params.q}%,asin.ilike.%${params.q}%`
    );
  }

  const { data, error } = await query;

  if (error) throw new Error(error.message);

  return data ?? [];
}

// Crea solo la fila principal en productos.
export async function insertProductCore(payload: Record<string, unknown>) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("productos")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  return data;
}

// Actualiza solo la tabla productos.
export async function updateProductCoreById(
  productId: string,
  payload: Record<string, unknown>
) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("productos")
    .update(payload)
    .eq("id", productId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  return data;
}

// Elimina la fila principal.
// Ojo: úsalo solo si tienes controladas las relaciones o cascadas.
export async function deleteProductCoreById(productId: string) {
  const supabase = createSupabaseRouteClient();

  const { error } = await supabase
    .from("productos")
    .delete()
    .eq("id", productId);

  if (error) throw new Error(error.message);

  return true;
}