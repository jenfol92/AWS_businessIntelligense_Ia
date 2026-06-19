// modules/products/repositories/productVariantsRepository.ts

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

// Las variantes están en la propia tabla productos:
// parent_id indica de qué producto padre cuelga.
export async function findProductParent(productId: string) {
  const supabase = createSupabaseRouteClient();

  const { data: product, error: productError } = await supabase
    .from("productos")
    .select("id, parent_id")
    .eq("id", productId)
    .single();

  if (productError) throw new Error(productError.message);

  if (!product?.parent_id) return null;

  const { data, error } = await supabase
    .from("productos")
    .select(`
      id,
      sku,
      nombre,
      estado
    `)
    .eq("id", product.parent_id)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data;
}

// Devuelve variantes hijas de un producto padre.
export async function findProductVariants(parentId: string) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("productos")
    .select(`
      id,
      sku,
      nombre,
      estado,
      parent_id,
      heredar_precio,
      producto_detalle (
        imagen_url,
        color
      )
    `)
    .eq("parent_id", parentId)
    .order("nombre", { ascending: true });

  if (error) throw new Error(error.message);

  return data ?? [];
}

// Devuelve hermanos de una variante.
export async function findProductSiblings(productId: string, parentId: string) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("productos")
    .select(`
      id,
      sku,
      nombre,
      estado,
      parent_id,
      heredar_precio,
      producto_detalle (
        imagen_url,
        color
      )
    `)
    .eq("parent_id", parentId)
    .neq("id", productId)
    .order("nombre", { ascending: true });

  if (error) throw new Error(error.message);

  return data ?? [];
}

// Asigna un producto como variante de otro.
export async function updateProductParent(
  productId: string,
  parentId: string | null,
  heredarPrecio?: boolean
) {
  const supabase = createSupabaseRouteClient();

  const payload: Record<string, unknown> = {
    parent_id: parentId,
  };

  if (heredarPrecio !== undefined) {
    payload.heredar_precio = heredarPrecio;
  }

  const { data, error } = await supabase
    .from("productos")
    .update(payload)
    .eq("id", productId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  return data;
}