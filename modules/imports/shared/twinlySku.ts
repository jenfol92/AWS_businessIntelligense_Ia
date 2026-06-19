const TWINLY_MSKU_PATTERN = /843661661\d{4}/;

/**
 * Extrae SKU Twinly desde MSKU de Amazon (Inventory Ledger, listings, etc.).
 * Ej.: f8436616610098, UK8436616610333, amzn.gr.8436616610074 → 8436616610098
 */
export function extractTwinlySkuFromMsku(msku: string): string | null {
  const match = String(msku ?? "").match(TWINLY_MSKU_PATTERN);
  return match?.[0] ?? null;
}

export function isTwinlyMsku(msku: string): boolean {
  return TWINLY_MSKU_PATTERN.test(String(msku ?? ""));
}
