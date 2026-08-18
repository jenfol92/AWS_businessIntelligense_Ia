import { supabaseAdmin } from "@/server/supabase/adminClient";
import {
  buildOperationalAmazonIdentitySet,
  type ActiveProductIdentityInput,
  type DemonstratedAmazonIdentityInput,
} from "./operationalAmazonIdentitySet";

const PAGE_SIZE = 1_000;

/**
 * Reads the existing Ledger evidence only. This is deliberately a reader,
 * not another identity store or Amazon caller.
 */
export async function loadConfirmedOperationalAmazonSellerSkus(): Promise<string[]> {
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
  return identitySet.products
    .filter((product) => product.status === "CONFIRMED" && product.identityConfidence === "CONFIRMED")
    .flatMap((product) => product.sellerSkus)
    .sort();
}

type LedgerIdentityRow = {
  id: string;
  producto_id: string | null;
  sku_original: string | null;
  msku_aliases: string[] | null;
  asin: string | null;
  fnsku: string | null;
};

async function loadLedgerIdentityEvidence(): Promise<LedgerIdentityRow[]> {
  const rows: LedgerIdentityRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("amazon_fba_inventory_ledger_daily")
      .select("id,producto_id,sku_original,msku_aliases,asin,fnsku")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as LedgerIdentityRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}
