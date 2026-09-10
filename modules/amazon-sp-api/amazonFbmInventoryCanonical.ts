import type { FbmProductIdentity } from "./fbmProductIdentityRepository.ts";
import type { ListingsItemDiagnostic } from "./listingsItemsClient";

export type CanonicalFbmInventoryRow = {
  producto_id: string;
  sku_limpio: string;
  seller_sku: string;
  asin: string | null;
  marketplace_id: string;
  available_quantity: number;
  observed_at: string;
};

export type FbmInventoryObservation = Pick<
  ListingsItemDiagnostic,
  "sellerSku" | "marketplaceId" | "asin" | "observedAt" | "mfnQuantity"
>;

export function buildCanonicalFbmInventorySnapshot(
  observations: readonly FbmInventoryObservation[],
  identities: readonly FbmProductIdentity[],
): { rows: CanonicalFbmInventoryRow[]; ignoredNonFbm: number } {
  const identityBySellerSku = new Map<string, FbmProductIdentity>();
  for (const identity of identities) {
    const previous = identityBySellerSku.get(identity.sellerSku);
    if (previous && previous.productoId !== identity.productoId) {
      throw new Error(`FBM_IDENTITY_AMBIGUOUS:${identity.sellerSku}`);
    }
    identityBySellerSku.set(identity.sellerSku, identity);
  }

  const rows: CanonicalFbmInventoryRow[] = [];
  let ignoredNonFbm = 0;
  for (const observation of observations) {
    if (observation.mfnQuantity == null) {
      ignoredNonFbm += 1;
      continue;
    }
    const identity = identityBySellerSku.get(observation.sellerSku);
    if (!identity) throw new Error(`FBM_IDENTITY_UNRESOLVED:${observation.sellerSku}`);
    const observedAsin = String(observation.asin ?? "").trim().toUpperCase() || null;
    const quantity = Number(observation.mfnQuantity);
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      throw new Error(`FBM_QUANTITY_INVALID:${observation.sellerSku}`);
    }
    rows.push({
      producto_id: identity.productoId,
      sku_limpio: identity.skuLimpio,
      seller_sku: observation.sellerSku,
      asin: observedAsin,
      marketplace_id: observation.marketplaceId,
      available_quantity: quantity,
      observed_at: observation.observedAt,
    });
  }

  rows.sort((a, b) =>
    a.producto_id.localeCompare(b.producto_id) ||
    a.marketplace_id.localeCompare(b.marketplace_id) ||
    a.seller_sku.localeCompare(b.seller_sku),
  );
  return { rows, ignoredNonFbm };
}
