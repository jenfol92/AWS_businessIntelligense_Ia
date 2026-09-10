import { randomUUID } from "node:crypto";
import { buildCanonicalFbmInventorySnapshot } from "./amazonFbmInventoryCanonical.ts";
import { getListingsItem } from "./listingsItemsClient.ts";
import { loadCanonicalFbmProductIdentities, type FbmProductIdentity } from "./fbmProductIdentityRepository.ts";

type IdentityLoader = () => Promise<FbmProductIdentity[]>;

export class FbmCaptureError extends Error {
  readonly sellerSku: string;
  readonly productoId: string;
  readonly marketplaceId: string;
  readonly cause: unknown;
  constructor(
    message: string,
    sellerSku: string,
    productoId: string,
    marketplaceId: string,
    cause: unknown,
  ) {
    super(message);
    this.name = "FbmCaptureError";
    this.sellerSku = sellerSku;
    this.productoId = productoId;
    this.marketplaceId = marketplaceId;
    this.cause = cause;
  }
}

export function assertFbmCaptureComplete(expectedIdentityCount: number, completedIdentityCount: number): void {
  if (!Number.isSafeInteger(expectedIdentityCount) || expectedIdentityCount <= 0) {
    throw new Error("FBM_EXPECTED_IDENTITY_COUNT_INVALID");
  }
  if (!Number.isSafeInteger(completedIdentityCount) || completedIdentityCount < 0) {
    throw new Error("FBM_COMPLETED_IDENTITY_COUNT_INVALID");
  }
  if (completedIdentityCount !== expectedIdentityCount) throw new Error("FBM_CAPTURE_INCOMPLETE");
}

export async function syncAmazonFbmInventoryCanonical(params: {
  marketplaceId: string;
  maxAmazonCalls?: number;
  persist?: boolean;
}, dependencies: {
  loadIdentities?: IdentityLoader;
  getItem?: typeof getListingsItem;
  commit?: (args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
} = {}) {
  const loadIdentities = dependencies.loadIdentities ?? loadCanonicalFbmProductIdentities;
  const identities = await loadIdentities();
  const sellerSkus = new Set<string>();
  for (const identity of identities) {
    if (sellerSkus.has(identity.sellerSku)) {
      throw new Error(`FBM_DUPLICATE_SELLER_SKU:${identity.sellerSku}`);
    }
    sellerSkus.add(identity.sellerSku);
  }
  const unique = identities;
  const expectedIdentityCount = unique.length;
  const maxAmazonCalls = params.maxAmazonCalls ?? expectedIdentityCount;
  if (unique.length > maxAmazonCalls) {
    throw new Error(`FBM_REQUEST_BUDGET_EXCEEDED:required=${unique.length}:max=${maxAmazonCalls}`);
  }

  const observations = [];
  for (const identity of unique) {
    try {
      observations.push(await (dependencies.getItem ?? getListingsItem)({
        sellerSku: identity.sellerSku,
        expectedAsin: undefined,
        marketplaceId: params.marketplaceId,
      }));
    } catch (error) {
      throw new FbmCaptureError(
        error instanceof Error ? error.message : String(error),
        identity.sellerSku,
        identity.productoId,
        params.marketplaceId,
        error,
      );
    }
  }
  const builtCanonical = buildCanonicalFbmInventorySnapshot(observations, identities);
  const observedAt = observations.map((row) => row.observedAt).sort().at(-1) ?? new Date().toISOString();
  const canonical = {
    ...builtCanonical,
    rows: builtCanonical.rows.map((row) => ({ ...row, observed_at: observedAt })),
  };
  const completedIdentityCount = observations.length;
  if (params.persist === false) {
    return { ...canonical, expectedIdentityCount, completedIdentityCount, canonicalRowCount: canonical.rows.length, amazonHttpCalls: observations.length, rowsUpserted: 0 };
  }
  const runId = randomUUID();
  assertFbmCaptureComplete(expectedIdentityCount, completedIdentityCount);
  const rpcArgs = {
    p_run_id: runId,
    p_observed_at: observedAt,
    p_marketplace_id: params.marketplaceId,
    p_expected_identity_count: expectedIdentityCount,
    p_completed_identity_count: completedIdentityCount,
    p_capture_complete: completedIdentityCount === expectedIdentityCount,
    p_rows: canonical.rows,
  };
  const commit = dependencies.commit ?? (async (args: Record<string, unknown>) => {
    const { supabaseAdmin } = await import("../../server/supabase/adminClient.ts");
    return supabaseAdmin.rpc("commit_amazon_fbm_inventory_snapshot_run", args);
  });
  const { data, error } = await commit(rpcArgs);
  if (error) throw new Error(error.message);
  return { ...canonical, expectedIdentityCount, completedIdentityCount, canonicalRowCount: canonical.rows.length, amazonHttpCalls: observations.length, rowsUpserted: Number(data ?? canonical.rows.length) };
}
