// modules/products/repositories/productMarketplacesRepository.ts
//
// Tabla `producto_marketplaces`.
// Upsert: restricción única (producto_id, marketplace_id).

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export async function findProductMarketplaces(
  productId: string,
): Promise<Record<string, unknown>[]> {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("producto_marketplaces")
    .select("*")
    .eq("producto_id", productId);

  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

export async function upsertProductMarketplace(
  payload: Record<string, unknown>,
): Promise<{ id: string }> {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("producto_marketplaces")
    .upsert(payload, { onConflict: "producto_id,marketplace_id" })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Upsert producto_marketplaces sin id");
  return { id: String(data.id) };
}

export async function deleteProductMarketplaceByProductAndMarketplace(
  productoId: string,
  marketplaceId: string,
): Promise<void> {
  const supabase = createSupabaseRouteClient();
  const { error } = await supabase
    .from("producto_marketplaces")
    .delete()
    .eq("producto_id", productoId)
    .eq("marketplace_id", marketplaceId);

  if (error) throw new Error(error.message);
}
