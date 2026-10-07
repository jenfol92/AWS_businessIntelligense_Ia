export type FbmProductIdentity = {
  productoId: string;
  sellerSku: string;
  skuLimpio: string;
  asin: null;
  fnsku: null;
  confidence: "CONFIRMED";
};

/** Builds FBM identities from the product master only. */
export function buildFbmProductIdentities(
  products: readonly { id: unknown; sku: unknown; asin?: unknown; estado?: unknown }[],
): FbmProductIdentity[] {
  const seenSkus = new Map<string, string>();
  const result: FbmProductIdentity[] = [];
  for (const product of products) {
    if (product.estado !== "activo") continue;
    const productoId = String(product.id ?? "").trim();
    const sellerSku = typeof product.sku === "string" ? product.sku : "";
    const asin = String(product.asin ?? "").trim();
    if (!productoId || !sellerSku.trim() || sellerSku !== sellerSku.trim() || /[\x00-\x1f\x7f]/.test(sellerSku) || !/^[A-Z0-9]{10}$/.test(asin)) continue;
    const previous = seenSkus.get(sellerSku);
    if (previous) {
      throw new Error(`FBM_DUPLICATE_PRODUCT_SKU:${sellerSku}`);
    }
    seenSkus.set(sellerSku, productoId);
    result.push({ productoId, sellerSku, skuLimpio: sellerSku, asin: null, fnsku: null, confidence: "CONFIRMED" });
  }
  return result.sort((a, b) => a.productoId.localeCompare(b.productoId));
}

export async function loadCanonicalFbmProductIdentities(signal?: AbortSignal): Promise<FbmProductIdentity[]> {
  const { supabaseAdmin } = await import("../../server/supabase/adminClient.ts");
  const products = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    if (offset >= 100_000) throw new Error("FBM_PRODUCT_READ_LIMIT");
    signal?.throwIfAborted();
    const query = supabaseAdmin.from("productos").select("id,sku,asin,estado")
      .eq("estado", "activo").order("id").range(offset, offset + pageSize - 1);
    const { data, error } = await (signal ? query.abortSignal(signal) : query);
    if (error) throw new Error(error.message);
    products.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return buildFbmProductIdentities(products);
}

/** Read excluded records too, to prove why an expected identity disappeared. */
export async function loadFbmIdentityProducts(signal?: AbortSignal) {
  const { supabaseAdmin } = await import("../../server/supabase/adminClient.ts");
  const products: { id: string; sku: string | null; asin: string | null; estado: string | null }[] = [];
  for (let offset = 0; ; offset += 500) {
    if (offset >= 100_000) throw new Error("FBM_PRODUCT_READ_LIMIT");
    signal?.throwIfAborted();
    const query = supabaseAdmin.from("productos").select("id,sku,asin,estado").order("id").range(offset, offset + 499);
    const { data, error } = await (signal ? query.abortSignal(signal) : query);
    if (error) throw new Error("FBM_PRODUCT_READ_FAILED");
    products.push(...(data ?? []));
    if (!data || data.length < 500) break;
  }
  return products;
}
