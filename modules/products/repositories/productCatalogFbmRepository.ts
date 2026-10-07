import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export type PublishedCatalogFbmStock = {
  quantity: number | null; observedAt: string | null;
  status: "PUBLISHED" | "NO_SNAPSHOT" | "UNAVAILABLE";
};
export const noPublishedFbm = (): PublishedCatalogFbmStock => ({ quantity: null, observedAt: null, status: "NO_SNAPSHOT" });

/** One batched, session-scoped read for the displayed page. Never reads jobs or calls Amazon. */
export async function findPublishedCatalogFbm(productIds: string[]): Promise<Map<string, PublishedCatalogFbmStock>> {
  const ids = Array.from(new Set(productIds));
  const result = new Map(ids.map(id => [id, noPublishedFbm()]));
  if (!ids.length) return result;
  try {
    const { data, error } = await createSupabaseRouteClient().from("v_latest_amazon_fbm_inventory_by_product")
      .select("producto_id,stock_fbm,observed_at").eq("marketplace_id", "A1RKKUPIHCS9HS").in("producto_id", ids).limit(ids.length + 1);
    if (error) throw new Error("FBM_CANONICAL_READ_FAILED");
    const seen = new Set<string>();
    for (const row of data ?? []) {
      const quantity = row.stock_fbm === null ? NaN : Number(row.stock_fbm);
      if (!result.has(row.producto_id) || seen.has(row.producto_id) || !Number.isSafeInteger(quantity) || quantity < 0 ||
        !row.observed_at || !Number.isFinite(Date.parse(row.observed_at))) throw new Error("FBM_CANONICAL_INVALID");
      seen.add(row.producto_id);
      result.set(row.producto_id, { quantity, observedAt: row.observed_at, status: "PUBLISHED" });
    }
    return result;
  } catch {
    return new Map(ids.map(id => [id, { quantity: null, observedAt: null, status: "UNAVAILABLE" }]));
  }
}
