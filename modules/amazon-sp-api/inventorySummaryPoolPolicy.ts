export const CONTINENTAL_MARKETPLACE_IDS = [
  "A1RKKUPIHCS9HS", // ES
  "A13V1IB3VIYZZH", // FR
  "A1PA6795UKMFR9", // DE
  "APJ6JRA9NG5V4", // IT
  "A1C3SOZRARQ6R3", // PL
  "A2NODRKZP88ZB9", // SE
] as const;

export const GB_MARKETPLACE_ID = "A1F83G8C2ARO7P";
export const PAN_EU_REFERENCE_MARKETPLACE_ID = CONTINENTAL_MARKETPLACE_IDS[0];
export const UK_REFERENCE_MARKETPLACE_ID = GB_MARKETPLACE_ID;

export const OPERATIONAL_INVENTORY_POOLS = [
  { operationalPool: "PAN_EU", observationMarketplaceId: PAN_EU_REFERENCE_MARKETPLACE_ID },
  { operationalPool: "UK", observationMarketplaceId: UK_REFERENCE_MARKETPLACE_ID },
] as const;

export type InventoryMarketplacePoolPlan =
  | { kind: "PAN_EU_REFERENCE_ONLY"; panEuRepresentative: string; marketplaceIds: readonly string[]; reason: string }
  | { kind: "PAN_EU_PLUS_UK_PREVIEW"; panEuRepresentative: string; ukRepresentative: string; marketplaceIds: readonly string[]; reason: string }
  | { kind: "MARKETPLACE_INDEPENDENT"; marketplaceIds: readonly string[]; reason: string }
  | { kind: "PAN_EU_PLUS_GB"; panEuRepresentative: string; marketplaceIds: readonly string[]; evidenceId: string };

/**
 * Canonical observation plan. This is safe for read-only acquisition/model
 * validation; atomic publication remains explicitly gated elsewhere.
 */
export const DEFAULT_INVENTORY_MARKETPLACE_POOL_PLAN: InventoryMarketplacePoolPlan = {
  kind: "PAN_EU_PLUS_UK_PREVIEW",
  panEuRepresentative: PAN_EU_REFERENCE_MARKETPLACE_ID,
  ukRepresentative: UK_REFERENCE_MARKETPLACE_ID,
  marketplaceIds: OPERATIONAL_INVENTORY_POOLS.map((pool) => pool.observationMarketplaceId),
  reason: "PAN_EU_AND_UK_OPERATIONAL_POOLS_PREVIEW_ONLY",
};

/** Current production publication scope. Do not add UK until authorized. */
export const PUBLISHED_INVENTORY_MARKETPLACE_POOL_PLAN: InventoryMarketplacePoolPlan = {
  kind: "PAN_EU_REFERENCE_ONLY",
  panEuRepresentative: PAN_EU_REFERENCE_MARKETPLACE_ID,
  marketplaceIds: [PAN_EU_REFERENCE_MARKETPLACE_ID],
  reason: "ES_REFERENCE_FOR_PAN_EU_OPERATIONAL_INVENTORY",
};

export function resolveOperationalInventoryMarketplaceIds(
  requestedMarketplaceIds?: readonly string[],
): string[] {
  const explicit = Array.from(new Set(
    (requestedMarketplaceIds ?? []).map((value) => value.trim()).filter(Boolean),
  ));
  return explicit.length > 0
    ? explicit
    : [...DEFAULT_INVENTORY_MARKETPLACE_POOL_PLAN.marketplaceIds];
}

export function resolvePublishedInventoryMarketplaceIds(
  requestedMarketplaceIds?: readonly string[],
): string[] {
  const explicit = Array.from(new Set(
    (requestedMarketplaceIds ?? []).map((value) => value.trim()).filter(Boolean),
  ));
  return explicit.length > 0
    ? explicit
    : [...PUBLISHED_INVENTORY_MARKETPLACE_POOL_PLAN.marketplaceIds];
}

export function inventorySummaryRequestCount(
  sellerSkuCount: number,
  plan: InventoryMarketplacePoolPlan = DEFAULT_INVENTORY_MARKETPLACE_POOL_PLAN,
  batchSize = 50,
): number {
  if (!Number.isInteger(sellerSkuCount) || sellerSkuCount < 0) throw new Error("INVALID_SELLER_SKU_COUNT");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) throw new Error("INVALID_BATCH_SIZE");
  const batches = Math.ceil(sellerSkuCount / batchSize);
  return batches * plan.marketplaceIds.length;
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
