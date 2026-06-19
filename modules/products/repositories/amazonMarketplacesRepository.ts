// modules/products/repositories/amazonMarketplacesRepository.ts
//
// Catálogo `amazon_marketplaces`.

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export async function findAmazonMarketplaces(): Promise<
  Record<string, unknown>[]
> {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("amazon_marketplaces")
    .select("id, code, name, currency, language_code, region")
    .order("code", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}
