import { extractTwinlySkuFromSellerSku } from "../imports/shared/twinlySku.ts";

export type ConfirmedAmazonIdentity = {
  sellerSku: string;
  asin: string;
  productoId: string;
  skuLimpio: string;
};

/** Sales uses the existing identity owner with explicit evidence, never legacy cleaning. */
export type SalesIdentityEvidence = {
  productoId: string;
  sellerSku?: string | null;
  asin?: string | null;
  ean?: string | null;
  source: "PRODUCT_SKU" | "PRODUCT_ASIN" | "LEDGER" | "MASTER_EAN";
};
export type SalesIdentityResult = {
  productoId: string | null;
  status: "SAFE_BY_ASIN" | "SAFE_BY_SKU_EXACT" | "SAFE_BY_ALIAS" | "IDENTITY_CONFLICT" | "IDENTITY_AMBIGUOUS" | "UNRESOLVED";
  evidence: SalesIdentityEvidence[];
  version: "sales-v1";
};

export function resolveSalesAmazonIdentity(
  sellerSku: string, asinValue: string | null | undefined, evidence: readonly SalesIdentityEvidence[],
): SalesIdentityResult {
  const asin = String(asinValue ?? "").trim().toUpperCase();
  const validAsin = /^[A-Z0-9]{10}$/.test(asin);
  const asinEvidence = validAsin ? evidence.filter(e => e.source !== "MASTER_EAN" && e.asin?.trim().toUpperCase() === asin) : [];
  const skuEvidence = evidence.filter(e => e.source !== "MASTER_EAN" && e.sellerSku === sellerSku);
  const asinProducts = new Set(asinEvidence.map(e => e.productoId));
  const skuProducts = new Set(skuEvidence.map(e => e.productoId));
  const combined = [...asinEvidence, ...skuEvidence];
  const result = (status: SalesIdentityResult["status"], productoId: string | null = null, proof = combined): SalesIdentityResult => ({ status, productoId, evidence: proof, version: "sales-v1" });
  // All deterministic evidence has been collected before any assignment.
  if (asinProducts.size > 1) return result("IDENTITY_CONFLICT");
  if (asinProducts.size === 1) {
    const id = Array.from(asinProducts)[0];
    if (Array.from(skuProducts).some(other => other !== id)) return result("IDENTITY_CONFLICT");
    return result("SAFE_BY_ASIN", id);
  }
  if (skuProducts.size > 1) return result("IDENTITY_AMBIGUOUS");
  if (skuProducts.size === 1) {
    const id = Array.from(skuProducts)[0];
    return result(skuEvidence.some(e => e.source === "PRODUCT_SKU") ? "SAFE_BY_SKU_EXACT" : "SAFE_BY_ALIAS", id);
  }
  // Extracted EAN is diagnostic only, even when it has exactly one candidate.
  const digits = extractTwinlySkuFromSellerSku(sellerSku);
  const heuristic = digits ? evidence.filter(e => e.ean === digits || (e.source === "PRODUCT_SKU" && e.sellerSku === digits)) : [];
  return result(new Set(heuristic.map(e => e.productoId)).size > 1 ? "IDENTITY_AMBIGUOUS" : "UNRESOLVED", null, heuristic);
}

export type OperationalIdentityResolution = {
  productoId: string | null;
  skuLimpio: string | null;
  expectedAsin: string | null;
  status: "IDENTITY_RESOLVED_BY_ALIAS" | "IDENTITY_RESOLVED_BY_ASIN" | "IDENTITY_AMBIGUOUS" | "ASIN_IDENTITY_CONFLICT" | "UNRESOLVED";
  aliasStatus: "ALIAS_CANDIDATE_BY_ASIN" | null;
  resolutionSource: "OPERATIONAL_ALIAS_CONFIRMED" | "AMAZON_ASIN_UNIQUE" | null;
};

export function resolveOperationalAmazonIdentity(
  sellerSkuValue: string | null | undefined,
  asinValue: string | null | undefined,
  identities: readonly ConfirmedAmazonIdentity[],
): OperationalIdentityResolution {
  const sellerSku = String(sellerSkuValue ?? "").trim();
  const asin = String(asinValue ?? "").trim().toUpperCase();
  const aliases = identities.filter((identity) => identity.sellerSku === sellerSku);
  const aliasPairs = new Map(aliases.map((identity) => [`${identity.productoId}\u0000${identity.asin}`, identity]));
  if (aliases.length > 0) {
    if (aliasPairs.size !== 1) return { productoId: null, skuLimpio: null, expectedAsin: null, status: "IDENTITY_AMBIGUOUS", aliasStatus: null, resolutionSource: null };
    const identity = Array.from(aliasPairs.values())[0];
    if (asin && identity.asin !== asin) return { productoId: null, skuLimpio: identity.skuLimpio, expectedAsin: identity.asin, status: "ASIN_IDENTITY_CONFLICT", aliasStatus: null, resolutionSource: "OPERATIONAL_ALIAS_CONFIRMED" };
    return { productoId: identity.productoId, skuLimpio: identity.skuLimpio, expectedAsin: identity.asin, status: "IDENTITY_RESOLVED_BY_ALIAS", aliasStatus: null, resolutionSource: "OPERATIONAL_ALIAS_CONFIRMED" };
  }
  if (asin) {
    const asinProducts = new Map(identities.filter((identity) => identity.asin === asin).map((identity) => [identity.productoId, identity]));
    if (asinProducts.size === 1) {
      const identity = Array.from(asinProducts.values())[0];
      return { productoId: identity.productoId, skuLimpio: identity.skuLimpio, expectedAsin: asin, status: "IDENTITY_RESOLVED_BY_ASIN", aliasStatus: "ALIAS_CANDIDATE_BY_ASIN", resolutionSource: "AMAZON_ASIN_UNIQUE" };
    }
    if (asinProducts.size > 1) return { productoId: null, skuLimpio: null, expectedAsin: asin, status: "IDENTITY_AMBIGUOUS", aliasStatus: null, resolutionSource: null };
  }
  return { productoId: null, skuLimpio: null, expectedAsin: asin || null, status: "UNRESOLVED", aliasStatus: null, resolutionSource: null };
}
