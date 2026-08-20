export type ConfirmedAmazonIdentity = {
  sellerSku: string;
  asin: string;
  productoId: string;
  skuLimpio: string;
};

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
