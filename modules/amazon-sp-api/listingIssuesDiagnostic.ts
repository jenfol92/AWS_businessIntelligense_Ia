import type { SupabaseClient } from "@supabase/supabase-js";
import { getListingIssues } from "./listingsItemsClient.ts";

/** Read-only diagnostic of one configured product/marketplace relationship. */
export async function diagnoseProductListingIssues(
  input: { productoId: string; marketplaceId: string },
  dependencies: {
    db: SupabaseClient;
    loadProductMarketplaces: (id: string) => Promise<Record<string, unknown>[]>;
    observe?: typeof getListingIssues;
  },
) {
  const fail = (error: string) => ({ ok: false as const, error, amazonRequests: 0 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.productoId) ||
      !/^[A-Z0-9]{1,20}$/.test(input.marketplaceId)) return fail("INVALID_DIAGNOSTIC_PARAMETERS");
  const { db } = dependencies;
  const productResult = await db.from("productos").select("id,sku,asin").eq("id", input.productoId).maybeSingle();
  if (productResult.error) return fail("PRODUCT_READ_FAILED");
  if (!productResult.data) return fail("PRODUCT_NOT_FOUND");
  const product = productResult.data;
  const marketplaces = await dependencies.loadProductMarketplaces(input.productoId);
  const matching = marketplaces.filter((row) => row.marketplace_id === input.marketplaceId);
  if (matching.length === 0) return fail("PRODUCT_MARKETPLACE_NOT_ASSIGNED");
  if (matching.length !== 1 || matching[0].producto_id !== input.productoId) return fail("PRODUCT_MARKETPLACE_IDENTITY_AMBIGUOUS");
  const relationship = matching[0];
  const sku = relationship.external_sku;
  if (typeof sku !== "string" || !sku.trim()) return fail("EXTERNAL_SKU_MISSING");
  if (sku !== sku.trim() || /[\x00-\x1f\x7f]/.test(sku)) return fail("EXTERNAL_SKU_INVALID");
  const asin = relationship.external_asin;
  if (asin != null && asin !== "" && (typeof asin !== "string" || !/^[A-Z0-9]{10}$/.test(asin))) {
    return fail("EXTERNAL_ASIN_INVALID");
  }
  const marketplaceResult = await db.from("amazon_marketplaces")
    .select("id,code,name,pais_id").eq("id", relationship.marketplace_id).maybeSingle();
  if (marketplaceResult.error) return fail("MARKETPLACE_READ_FAILED");
  const marketplace = marketplaceResult.data;
  if (!marketplace) return fail("MARKETPLACE_UNKNOWN");
  if (!marketplace.pais_id) return fail("MARKETPLACE_COUNTRY_MISSING");
  const countryResult = await db.from("paises").select("id,code,name").eq("id", marketplace.pais_id).maybeSingle();
  if (countryResult.error) return fail("MARKETPLACE_COUNTRY_READ_FAILED");
  if (!countryResult.data?.code) return fail("MARKETPLACE_COUNTRY_MISSING");

  const warnings: string[] = [];
  if (product.sku !== sku) warnings.push("ERP_SKU_DIFFERS_FROM_EXTERNAL_SKU");
  if (product.asin && asin && product.asin !== asin) warnings.push("ERP_ASIN_DIFFERS_FROM_EXTERNAL_ASIN");
  if (!asin) warnings.push("EXTERNAL_ASIN_MISSING");
  // Bounded supporting evidence only: never choose/repair a seller SKU from ledger.
  const ledgerResult = await db.from("amazon_fba_inventory_ledger_daily")
    .select("sku_original,msku_aliases,asin").eq("producto_id", input.productoId).order("id").limit(51);
  const evidence = (ledgerResult.data ?? []).slice(0, 50).map((row) => ({
    sku: row.sku_original,
    aliases: row.msku_aliases,
    asin: row.asin,
  }));
  if (ledgerResult.error) warnings.push("LEDGER_EVIDENCE_UNAVAILABLE");
  if ((ledgerResult.data?.length ?? 0) > 50) warnings.push("LEDGER_EVIDENCE_TRUNCATED");
  if (evidence.some((row) => asin && row.asin && row.asin !== asin)) warnings.push("LEDGER_ASIN_DISCREPANCY");
  if (evidence.length && !evidence.some((row) => row.sku === sku ||
      (Array.isArray(row.aliases) && row.aliases.includes(sku)))) warnings.push("EXTERNAL_SKU_NOT_IN_LEDGER_SAMPLE");

  const amazonObservation = await (dependencies.observe ?? getListingIssues)({
    sellerSku: sku,
    marketplaceId: marketplace.id,
    signal: AbortSignal.timeout(20_000),
    oneShot: true,
  });
  return {
    ok: amazonObservation.status === "SUCCESS",
    product: { productoId: product.id, sku, asin: asin || null, erpSku: product.sku, erpAsin: product.asin },
    identitySource: "producto_marketplaces.external_sku" as const,
    // includedData=issues does not verify the configured ASIN. Do not imply otherwise.
    asinVerifiedByAmazon: false,
    marketplace: { id: marketplace.id, code: marketplace.code, name: marketplace.name, country: countryResult.data.code },
    warnings,
    ledgerEvidence: { rows: evidence, scope: "PRODUCT_SAMPLE_ONLY", complete: !ledgerResult.error && (ledgerResult.data?.length ?? 0) <= 50 },
    amazonObservation,
  };
}
