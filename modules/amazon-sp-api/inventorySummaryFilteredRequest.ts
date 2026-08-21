import { spApiRequest, type SpApiResponseMetadata } from "./spApiClient";

export const INVENTORY_SUMMARY_MAX_CONCURRENT_REQUESTS = 1;
export const INVENTORY_SUMMARY_FALLBACK_RATE_LIMIT_PER_SECOND = 2;
export const INVENTORY_SUMMARY_MIN_REQUEST_START_INTERVAL_MS =
  Math.ceil(1_000 / INVENTORY_SUMMARY_FALLBACK_RATE_LIMIT_PER_SECOND);
export const MAX_INVENTORY_SUMMARY_SELLER_SKUS_PER_REQUEST = 50;
export const DEFAULT_INVENTORY_SUMMARY_SELLER_SKU_BATCH_SIZE = 50;
export const MAX_THROTTLE_RESUMES_PER_BATCH = 1;
export const MAX_WAIT_PER_INVENTORY_SUMMARY_429_MS = 60_000;
export const INVENTORY_SUMMARY_THROTTLE_SAFETY_INTERVALS = 4;
export const INVENTORY_SUMMARY_THROTTLE_JITTER_MAX_MS = 250;

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

export type InventorySummaryThrottleResumeEvent = {
  resumeNumber: number;
  delayMs: number;
  delaySource: "retry-after" | "observed-rate-limit" | "fallback-rate-limit";
};

type InventorySummaryThrottleResumeOptions = {
  request: (attempt: number) => Promise<FilteredInventorySummaryResponse>;
  observedRateLimit: () => string | null | undefined;
  startedAtMs: number;
  maxTotalDurationMs: number;
  maxResumes?: number;
  maxWaitMs?: number;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  random?: () => number;
  onThrottleResume?: (event: InventorySummaryThrottleResumeEvent) => void | Promise<void>;
};

function header(details: unknown, name: string): string | null {
  const headers = (details as { headers?: Record<string, unknown> } | null)?.headers;
  if (!headers) return null;
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return value == null ? null : String(value);
}

function retryAfterDelayMs(raw: string | null, nowMs: number): number | null {
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - nowMs) : null;
}

export function resolveInventorySummaryThrottleDelay(params: {
  errorDetails: unknown;
  observedRateLimit: string | null | undefined;
  nowMs: number;
  random?: () => number;
}): { delayMs: number; minimumDelayMs: number; source: InventorySummaryThrottleResumeEvent["delaySource"] } {
  const fromRetryAfter = retryAfterDelayMs(header(params.errorDetails, "retry-after"), params.nowMs);
  const jitter = Math.floor(Math.max(0, Math.min(1, (params.random ?? Math.random)())) * (INVENTORY_SUMMARY_THROTTLE_JITTER_MAX_MS + 1));
  if (fromRetryAfter != null) {
    return { delayMs: fromRetryAfter + jitter, minimumDelayMs: fromRetryAfter, source: "retry-after" };
  }
  const parsedRate = Number(params.observedRateLimit);
  const rate = Number.isFinite(parsedRate) && parsedRate > 0
    ? parsedRate
    : INVENTORY_SUMMARY_FALLBACK_RATE_LIMIT_PER_SECOND;
  const minimumDelayMs = Math.ceil(1_000 / rate) * INVENTORY_SUMMARY_THROTTLE_SAFETY_INTERVALS;
  return {
    delayMs: minimumDelayMs + jitter,
    minimumDelayMs,
    source: Number.isFinite(parsedRate) && parsedRate > 0 ? "observed-rate-limit" : "fallback-rate-limit",
  };
}

function isRateLimited(error: unknown): error is { code: string; status?: number; details?: unknown } {
  const value = error as { code?: unknown; status?: unknown } | null;
  return value?.code === "rate_limited" || value?.status === 429;
}

export async function requestInventorySummaryBatchWithThrottleResume(
  options: InventorySummaryThrottleResumeOptions,
): Promise<FilteredInventorySummaryResponse> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxResumes = options.maxResumes ?? MAX_THROTTLE_RESUMES_PER_BATCH;
  const maxWaitMs = options.maxWaitMs ?? MAX_WAIT_PER_INVENTORY_SUMMARY_429_MS;
  let resumes = 0;
  for (;;) {
    try {
      return await options.request(resumes);
    } catch (error) {
      if (!isRateLimited(error) || resumes >= maxResumes) throw error;
      const resolved = resolveInventorySummaryThrottleDelay({
        errorDetails: error.details,
        observedRateLimit: options.observedRateLimit(),
        nowMs: now(),
        random: options.random,
      });
      if (resolved.minimumDelayMs > maxWaitMs) {
        throw new Error(`INVENTORY_SUMMARY_429_WAIT_EXCEEDS_LIMIT:${resolved.minimumDelayMs}/${maxWaitMs}`);
      }
      const delayMs = Math.min(resolved.delayMs, maxWaitMs);
      if (now() - options.startedAtMs + delayMs >= options.maxTotalDurationMs) {
        throw new Error(`FBA Inventory runtime budget exceeded (${options.maxTotalDurationMs}ms).`);
      }
      resumes += 1;
      await options.onThrottleResume?.({
        resumeNumber: resumes,
        delayMs,
        delaySource: resolved.source,
      });
      await wait(delayMs);
    }
  }
}

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
