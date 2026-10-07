import { supabaseAdmin } from "@/server/supabase/adminClient";
import {
  buildOperationalAmazonIdentitySet,
  type ActiveProductIdentityInput,
  type DemonstratedAmazonIdentityInput,
} from "./operationalAmazonIdentitySet";
import { readKeysetPages } from "./readKeysetPages";
import type { SalesIdentityEvidence } from "./amazonInventoryIdentityResolver";

const PAGE_SIZE = 1_000;

/** Sales needs all ERP products (including discontinued) and unfiltered conflicts.
 * Never reads amazon_envios or uses inferred EAN as a persisted alias. */
export async function loadSalesIdentityEvidence(signal?: AbortSignal): Promise<SalesIdentityEvidence[]> {
  const [products, ledger, logistics] = await Promise.all([
    readKeysetPages<{ id: string; sku: string; asin: string | null }>(async (cursor, limit) => {
      let q = supabaseAdmin.from("productos").select("id,sku,asin").order("id").limit(limit);
      if (cursor) q = q.gt("id", cursor);
      if (signal) q = q.abortSignal(signal);
      const { data, error } = await q; if (error) throw new Error(error.message);
      return data ?? [];
    }, { pageSize: PAGE_SIZE, cursorOf: row => row.id }),
    loadLedgerIdentityEvidence(signal),
    readKeysetPages<{ producto_id: string; ean_upc: string | null }>(async (cursor, limit) => {
      let q = supabaseAdmin.from("producto_logistica").select("producto_id,ean_upc").order("producto_id").limit(limit);
      if (cursor) q = q.gt("producto_id", cursor);
      if (signal) q = q.abortSignal(signal);
      const { data, error } = await q; if (error) throw new Error(error.message);
      return data ?? [];
    }, { pageSize: PAGE_SIZE, cursorOf: row => row.producto_id }),
  ]);
  return buildSalesIdentityEvidence(products, ledger, logistics);
}

export function buildSalesIdentityEvidence(
  products: readonly { id: string; sku: string; asin?: string | null }[],
  ledger: readonly { producto_id: string | null; asin: string | null; sku_original: string | null; msku_aliases: string[] | null }[],
  logistics: readonly { producto_id: string; ean_upc: string | null }[],
): SalesIdentityEvidence[] {
  const validProducts = new Set(products.map(p => p.id));
  const evidence: SalesIdentityEvidence[] = [];
  for (const p of products) {
    if (p.sku) evidence.push({ productoId: p.id, sellerSku: p.sku, source: "PRODUCT_SKU" });
    if (p.asin) evidence.push({ productoId: p.id, asin: p.asin, source: "PRODUCT_ASIN" });
  }
  for (const row of ledger) {
    if (!row.producto_id || !validProducts.has(row.producto_id)) continue;
    for (const sku of Array.from(new Set([row.sku_original, ...(row.msku_aliases ?? [])]))) {
      // ASIN links are kept even without SKU/FNSKU; never hide conflicting products.
      evidence.push({ productoId: row.producto_id, sellerSku: sku || null, asin: row.asin, source: "LEDGER" });
    }
  }
  for (const row of logistics) if (validProducts.has(row.producto_id)) evidence.push({ productoId: row.producto_id, ean: row.ean_upc, source: "MASTER_EAN" });
  return Array.from(new Map(evidence.map(e => [JSON.stringify(e), e])).values());
}

/**
 * Reads the existing Ledger evidence only. This is deliberately a reader,
 * not another identity store or Amazon caller.
 */
export async function loadConfirmedOperationalAmazonSellerSkus(): Promise<string[]> {
  const identities = await loadConfirmedOperationalAmazonIdentities();
  return Array.from(new Set(identities.map((identity) => identity.sellerSku))).sort();
}

export type ConfirmedOperationalAmazonIdentity = {
  sellerSku: string;
  asin: string;
  productoId: string;
  skuLimpio: string;
  fnsku: string;
  confidence: "CONFIRMED";
};

export async function loadConfirmedOperationalAmazonIdentities(): Promise<ConfirmedOperationalAmazonIdentity[]> {
  const [{ data: products, error: productsError }, ledgerRows] = await Promise.all([
    supabaseAdmin.from("productos").select("id,sku,nombre").eq("estado", "activo"),
    loadLedgerIdentityEvidence(),
  ]);
  if (productsError) throw new Error(productsError.message);

  const activeProducts: ActiveProductIdentityInput[] = (products ?? []).map((row) => ({
    productId: String(row.id ?? ""),
    erpSku: String(row.sku ?? ""),
    productName: row.nombre == null ? null : String(row.nombre),
  })).filter((row) => row.productId && row.erpSku);

  const sellerSkuAsins = new Map<string, Set<string>>();
  for (const row of ledgerRows) {
    const asin = String(row.asin ?? "").trim().toUpperCase();
    if (!asin) continue;
    for (const sellerSku of [row.sku_original, ...(row.msku_aliases ?? [])]) {
      const normalized = String(sellerSku ?? "").trim();
      if (!normalized) continue;
      const asins = sellerSkuAsins.get(normalized) ?? new Set<string>();
      asins.add(asin);
      sellerSkuAsins.set(normalized, asins);
    }
  }

  const evidence: DemonstratedAmazonIdentityInput[] = [];
  for (const row of ledgerRows) {
    const asin = String(row.asin ?? "").trim().toUpperCase();
    const fnsku = String(row.fnsku ?? "").trim().toUpperCase();
    const sellerSku = String(row.sku_original ?? "").trim();
    if (!row.producto_id || !asin || !fnsku || !sellerSku) continue;
    const aliases = row.msku_aliases ?? [];
    const ambiguous = [sellerSku, ...aliases]
      .some((alias) => (sellerSkuAsins.get(String(alias).trim())?.size ?? 0) > 1);
    evidence.push({
      productId: String(row.producto_id),
      sellerSku,
      aliases,
      asin,
      fnsku,
      source: "LEDGER",
      confidence: ambiguous ? "AMBIGUOUS" : "CONFIRMED",
    });
  }

  const identitySet = buildOperationalAmazonIdentitySet(activeProducts, evidence);
  const confirmedProducts = new Set(identitySet.products
    .filter((product) => product.status === "CONFIRMED" && product.identityConfidence === "CONFIRMED")
    .map((product) => product.productId));
  const skuByProduct = new Map(activeProducts.map((product) => [product.productId, product.erpSku]));
  const result = new Map<string, ConfirmedOperationalAmazonIdentity>();
  for (const row of ledgerRows) {
    const productoId = String(row.producto_id ?? "").trim();
    const asin = String(row.asin ?? "").trim().toUpperCase();
    const fnsku = String(row.fnsku ?? "").trim().toUpperCase();
    const skuLimpio = skuByProduct.get(productoId) ?? "";
    if (!confirmedProducts.has(productoId) || !asin || !fnsku || !skuLimpio) continue;
    for (const value of [row.sku_original, ...(row.msku_aliases ?? [])]) {
      const sellerSku = String(value ?? "").trim();
      if (!sellerSku) continue;
      const key = `${sellerSku}\u0000${asin}\u0000${productoId}`;
      result.set(key, { sellerSku, asin, productoId, skuLimpio, fnsku, confidence: "CONFIRMED" });
    }
  }
  return Array.from(result.values()).sort((a, b) => a.sellerSku.localeCompare(b.sellerSku));
}

type LedgerIdentityRow = {
  id: string;
  producto_id: string | null;
  sku_original: string | null;
  msku_aliases: string[] | null;
  asin: string | null;
  fnsku: string | null;
};

async function loadLedgerIdentityEvidence(signal?: AbortSignal): Promise<LedgerIdentityRow[]> {
  return readKeysetPages<LedgerIdentityRow>(async (afterId, limit) => {
    let query = supabaseAdmin
      .from("amazon_fba_inventory_ledger_daily")
      .select("id,producto_id,sku_original,msku_aliases,asin,fnsku")
      .order("id", { ascending: true })
      .limit(limit);
    if (afterId !== null) query = query.gt("id", afterId);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []) as LedgerIdentityRow[];
  }, { pageSize: PAGE_SIZE, cursorOf: row => row.id });
}
