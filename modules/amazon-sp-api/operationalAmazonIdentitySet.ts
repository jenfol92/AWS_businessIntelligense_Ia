export type ActiveProductIdentityInput = {
  productId: string;
  erpSku: string;
  productName: string | null;
};

export type DemonstratedAmazonIdentityInput = {
  productId: string | null;
  sellerSku: string | null;
  aliases?: string[] | null;
  asin?: string | null;
  fnsku?: string | null;
  source: "LEDGER" | "PERSISTED_MAPPING" | "PERSISTED_ALIAS";
  confidence?: "CONFIRMED" | "OBSERVED" | "AMBIGUOUS";
};

export type OperationalAmazonProductIdentity = {
  productId: string;
  erpSku: string;
  productName: string | null;
  asin: string | null;
  sellerSkus: string[];
  knownFnskus: string[];
  identitySources: string[];
  identityConfidence: "CONFIRMED" | "OBSERVED" | "AMBIGUOUS" | "MISSING";
  status: "CONFIRMED" | "AMAZON_IDENTITY_MISSING" | "AMAZON_IDENTITY_AMBIGUOUS";
};

export type OperationalAmazonIdentitySet = {
  products: OperationalAmazonProductIdentity[];
  querySellerSkus: string[];
  coverage: {
    activeErpProducts: number;
    productsWithAsin: number;
    productsWithConfirmedAmazonIdentity: number;
    productsWithoutConfirmedAmazonIdentity: number;
    confirmedActiveAsins: number;
    confirmedActiveSellerSkus: number;
    confirmedActiveFnskus: number;
  };
  conflicts: {
    sellerSkuToAsins: Array<{ sellerSku: string; asins: string[] }>;
    fnskuToAsins: Array<{ fnsku: string; asins: string[] }>;
  };
};

const clean = (value: string | null | undefined) => String(value ?? "").trim();

export function buildOperationalAmazonIdentitySet(
  activeProducts: readonly ActiveProductIdentityInput[],
  evidence: readonly DemonstratedAmazonIdentityInput[],
): OperationalAmazonIdentitySet {
  const byProduct = new Map<string, OperationalAmazonProductIdentity>();
  for (const product of activeProducts) {
    byProduct.set(product.productId, {
      ...product,
      asin: null,
      sellerSkus: [],
      knownFnskus: [],
      identitySources: [],
      identityConfidence: "MISSING",
      status: "AMAZON_IDENTITY_MISSING",
    });
  }

  const sellerSkuAsins = new Map<string, Set<string>>();
  const fnskuAsins = new Map<string, Set<string>>();
  for (const row of evidence) {
    const product = row.productId ? byProduct.get(row.productId) : undefined;
    const asin = clean(row.asin).toUpperCase();
    const sellerSkus = [row.sellerSku, ...(row.aliases ?? [])].map(clean).filter(Boolean);
    const fnsku = clean(row.fnsku).toUpperCase();
    if (asin && sellerSkus.length) sellerSkus.forEach((sku) => {
      const asins = sellerSkuAsins.get(sku) ?? new Set<string>();
      asins.add(asin);
      sellerSkuAsins.set(sku, asins);
    });
    if (asin && fnsku) {
      const asins = fnskuAsins.get(fnsku) ?? new Set<string>();
      asins.add(asin);
      fnskuAsins.set(fnsku, asins);
    }
    if (!product || !asin) continue;
    product.asin = product.asin && product.asin !== asin ? product.asin : asin;
    product.sellerSkus = Array.from(new Set([...product.sellerSkus, ...sellerSkus])).sort();
    if (fnsku) product.knownFnskus = Array.from(new Set([...product.knownFnskus, fnsku])).sort();
    product.identitySources = Array.from(new Set([...product.identitySources, row.source])).sort();
    const confidence = row.confidence ?? "OBSERVED";
    if (confidence === "AMBIGUOUS") product.identityConfidence = "AMBIGUOUS";
    else if (product.identityConfidence !== "AMBIGUOUS" && confidence === "CONFIRMED") product.identityConfidence = "CONFIRMED";
    else if (product.identityConfidence === "MISSING") product.identityConfidence = confidence;
    product.status = product.identityConfidence === "AMBIGUOUS" ? "AMAZON_IDENTITY_AMBIGUOUS" : "CONFIRMED";
  }

  const products = Array.from(byProduct.values());
  const activeAsins = new Set(products.map((product) => product.asin).filter(Boolean));
  const activeSellerSkus = new Set(products.flatMap((product) => product.sellerSkus));
  const activeFnskus = new Set(products.flatMap((product) => product.knownFnskus));
  return {
    products,
    querySellerSkus: Array.from(activeSellerSkus).sort(),
    coverage: {
      activeErpProducts: products.length,
      productsWithAsin: products.filter((product) => product.asin).length,
      productsWithConfirmedAmazonIdentity: products.filter((product) => product.status === "CONFIRMED").length,
      productsWithoutConfirmedAmazonIdentity: products.filter((product) => product.status !== "CONFIRMED").length,
      confirmedActiveAsins: activeAsins.size,
      confirmedActiveSellerSkus: activeSellerSkus.size,
      confirmedActiveFnskus: activeFnskus.size,
    },
    conflicts: {
      sellerSkuToAsins: Array.from(sellerSkuAsins.entries()).filter(([, asins]) => asins.size > 1).map(([sellerSku, asins]) => ({ sellerSku, asins: Array.from(asins).sort() })),
      fnskuToAsins: Array.from(fnskuAsins.entries()).filter(([, asins]) => asins.size > 1).map(([fnsku, asins]) => ({ fnsku, asins: Array.from(asins).sort() })),
    },
  };
}
