export const CONTINENTAL_MARKETPLACE_IDS = [
  "A1RKKUPIHCS9HS", // ES
  "A13V1IB3VIYZZH", // FR
  "A1PA6795UKMFR9", // DE
  "APJ6JRA9NG5V4", // IT
  "A1C3SOZRARQ6R3", // PL
  "A2NODRKZP88ZB9", // SE
] as const;

export const GB_MARKETPLACE_ID = "A1F83G8C2ARO7P";

export type InventoryMarketplacePoolPlan =
  | { kind: "MARKETPLACE_INDEPENDENT"; marketplaceIds: readonly string[]; reason: string }
  | { kind: "PAN_EU_PLUS_GB"; panEuRepresentative: string; marketplaceIds: readonly string[]; evidenceId: string };

/**
 * Safe default: every continental marketplace remains independent until a
 * recorded ES-vs-DE equivalence evidence row is explicitly approved.
 */
export const DEFAULT_INVENTORY_MARKETPLACE_POOL_PLAN: InventoryMarketplacePoolPlan = {
  kind: "MARKETPLACE_INDEPENDENT",
  marketplaceIds: [...CONTINENTAL_MARKETPLACE_IDS, GB_MARKETPLACE_ID],
  reason: "PAN_EU_EQUIVALENCE_NOT_APPROVED",
};

export function inventorySummaryRequestCount(
  sellerSkuCount: number,
  plan: InventoryMarketplacePoolPlan = DEFAULT_INVENTORY_MARKETPLACE_POOL_PLAN,
  batchSize = 50,
): number {
  if (!Number.isInteger(sellerSkuCount) || sellerSkuCount < 0) throw new Error("INVALID_SELLER_SKU_COUNT");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) throw new Error("INVALID_BATCH_SIZE");
  const batches = Math.ceil(sellerSkuCount / batchSize);
  return batches * (plan.kind === "PAN_EU_PLUS_GB" ? 2 : plan.marketplaceIds.length);
}

export function approvePanEuEquivalence(params: {
  evidenceId: string;
  representativeMarketplaceId: string;
  comparisonMarketplaceId: string;
  exactSellerSkuSet: readonly string[];
  equalOperationalSignatures: boolean;
  noUnexpectedPagination: boolean;
}): InventoryMarketplacePoolPlan {
  if (!params.evidenceId.trim() || !params.representativeMarketplaceId.trim() || !params.comparisonMarketplaceId.trim()) {
    throw new Error("PAN_EU_EVIDENCE_ID_REQUIRED");
  }
  if (params.exactSellerSkuSet.length === 0 || !params.equalOperationalSignatures || !params.noUnexpectedPagination) {
    throw new Error("PAN_EU_EQUIVALENCE_NOT_PROVEN");
  }
  return {
    kind: "PAN_EU_PLUS_GB",
    panEuRepresentative: params.representativeMarketplaceId,
    marketplaceIds: [params.representativeMarketplaceId, GB_MARKETPLACE_ID],
    evidenceId: params.evidenceId,
  };
}
