// modules/products/repositories/productAmazonContentRepository.ts
//
// Tabla `producto_amazon_content` (FK `producto_marketplace_id`).
// Upsert: (producto_marketplace_id, language).

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export async function findAmazonContentsByProductoMarketplaceIds(
  productoMarketplaceIds: string[],
): Promise<Record<string, unknown>[]> {
  if (productoMarketplaceIds.length === 0) return [];

  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("producto_amazon_content")
    .select("*")
    .in("producto_marketplace_id", productoMarketplaceIds);

  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

export async function upsertAmazonContent(
  payload: Record<string, unknown>,
): Promise<void> {
  const supabase = createSupabaseRouteClient();
  const { error } = await supabase.from("producto_amazon_content").upsert(
    payload,
    { onConflict: "producto_marketplace_id,language" },
  );
  if (error) throw new Error(error.message);
}
