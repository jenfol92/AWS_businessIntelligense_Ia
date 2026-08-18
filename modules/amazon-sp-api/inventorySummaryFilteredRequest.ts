import { spApiRequest, type SpApiResponseMetadata } from "./spApiClient";

export const INVENTORY_SUMMARY_MAX_CONCURRENT_REQUESTS = 1;
export const INVENTORY_SUMMARY_FALLBACK_RATE_LIMIT_PER_SECOND = 2;
export const INVENTORY_SUMMARY_MIN_REQUEST_START_INTERVAL_MS =
  Math.ceil(1_000 / INVENTORY_SUMMARY_FALLBACK_RATE_LIMIT_PER_SECOND);
export const MAX_INVENTORY_SUMMARY_SELLER_SKUS_PER_REQUEST = 50;
export const DEFAULT_INVENTORY_SUMMARY_SELLER_SKU_BATCH_SIZE = 50;

export type FilteredInventorySummaryResponse = {
  payload?: { inventorySummaries?: unknown[] };
  inventorySummaries?: unknown[];
  pagination?: { nextToken?: string };
};

export type FilteredInventorySummaryRequest = {
  marketplaceId: string;
  sellerSkus: string[];
  nextToken?: string;
  onResponseMetadata?: (metadata: SpApiResponseMetadata) => void;
};

export function inventorySummarySellerSkuBatchSize(value = process.env.INVENTORY_SUMMARY_SELLER_SKU_BATCH_SIZE): number {
  const parsed = Number(value);
  if (value == null || value === "") return DEFAULT_INVENTORY_SUMMARY_SELLER_SKU_BATCH_SIZE;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_INVENTORY_SUMMARY_SELLER_SKUS_PER_REQUEST) {
    throw new Error(`INVALID_INVENTORY_SUMMARY_BATCH_SIZE:${value}`);
  }
  return parsed;
}

export function normalizedConfirmedSellerSkus(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function splitSellerSkuBatches(values: readonly string[], batchSize = inventorySummarySellerSkuBatchSize()): string[][] {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_INVENTORY_SUMMARY_SELLER_SKUS_PER_REQUEST) {
    throw new Error(`INVALID_INVENTORY_SUMMARY_BATCH_SIZE:${batchSize}`);
  }
  const sellerSkus = normalizedConfirmedSellerSkus(values);
  return Array.from(
    { length: Math.ceil(sellerSkus.length / batchSize) },
    (_, index) => sellerSkus.slice(index * batchSize, (index + 1) * batchSize),
  );
}

export function buildFilteredInventorySummaryQuery(input: FilteredInventorySummaryRequest): Record<string, string | undefined> {
  const sellerSkus = normalizedConfirmedSellerSkus(input.sellerSkus);
  if (sellerSkus.length === 0) throw new Error("FILTERED_INVENTORY_REQUIRES_CONFIRMED_SELLER_SKUS");
  return {
    sellerSkus: sellerSkus.join(","),
    details: "true",
    granularityType: "Marketplace",
    granularityId: input.marketplaceId,
    marketplaceIds: input.marketplaceId,
    nextToken: input.nextToken,
  };
}

export async function requestFilteredInventorySummaries(
  input: FilteredInventorySummaryRequest,
  request = spApiRequest,
): Promise<FilteredInventorySummaryResponse> {
  return request<FilteredInventorySummaryResponse>({
    method: "GET",
    path: "/fba/inventory/v1/summaries",
    operation: "getInventorySummaries.filtered",
    query: buildFilteredInventorySummaryQuery(input),
    rateLimitRetry: { maxRetries: 0 },
    retryExpiredAccessToken: false,
    onResponseMetadata: input.onResponseMetadata,
  });
}

export class InventorySummaryRequestPacer {
  private tail: Promise<void> = Promise.resolve();
  private lastStartedAt: number | null = null;
  private currentIntervalMs: number;

  constructor(
    intervalMs = INVENTORY_SUMMARY_MIN_REQUEST_START_INTERVAL_MS,
    private readonly now = () => Date.now(),
    private readonly wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {
    this.currentIntervalMs = intervalMs;
  }

  observeRateLimit(rateLimit: string | null | undefined): void {
    const perSecond = Number(rateLimit);
    if (!Number.isFinite(perSecond) || perSecond <= 0) return;
    this.currentIntervalMs = Math.max(1, Math.ceil(1_000 / perSecond));
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    const scheduled = this.tail.then(async () => {
      if (this.lastStartedAt != null) {
        const remaining = this.currentIntervalMs - (this.now() - this.lastStartedAt);
        if (remaining > 0) await this.wait(remaining);
      }
      this.lastStartedAt = this.now();
      return operation();
    });
    this.tail = scheduled.then(() => undefined, () => undefined);
    return scheduled;
  }
}
