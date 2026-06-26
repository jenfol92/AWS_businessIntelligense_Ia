const TWINLY_SKU_PATTERN = /843661661\d{4}/;

/**
 * Extrae el EAN Twinly limpio desde seller-sku/MSKU de Amazon.
 * Ej.: f8436616610098, UK8436616610333, amzn.gr.8436616610074 -> 8436616610098
 */
export function extractTwinlySkuFromSellerSku(sellerSku: string): string | null {
  const match = String(sellerSku ?? "").match(TWINLY_SKU_PATTERN);
  return match?.[0] ?? null;
}

export function extractTwinlySkuFromMsku(msku: string): string | null {
  return extractTwinlySkuFromSellerSku(msku);
}

export function isTwinlyMsku(msku: string): boolean {
  return extractTwinlySkuFromSellerSku(msku) != null;
}
