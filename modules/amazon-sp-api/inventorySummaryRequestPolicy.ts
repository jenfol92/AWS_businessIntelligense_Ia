export const DEFAULT_MAX_INVENTORY_SUMMARY_PAGES_PER_BATCH = 5;
export const DEFAULT_MAX_INVENTORY_SUMMARY_REQUESTS_PER_RUN = 150;
export const DEFAULT_MAX_INVENTORY_SUMMARY_RUNTIME_MS = 15 * 60_000;

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`INVALID_INVENTORY_SUMMARY_BUDGET:${value}`);
  }
  return parsed;
}

export function inventorySummaryMaxPagesPerBatch(value = process.env.AMAZON_INVENTORY_MAX_PAGES_PER_BATCH): number {
  return positiveInteger(value, DEFAULT_MAX_INVENTORY_SUMMARY_PAGES_PER_BATCH);
}

export function inventorySummaryMaxRequestsPerRun(value = process.env.AMAZON_INVENTORY_MAX_REQUESTS_PER_RUN): number {
  return positiveInteger(value, DEFAULT_MAX_INVENTORY_SUMMARY_REQUESTS_PER_RUN);
}

export function inventorySummaryMaxRuntimeMs(value = process.env.AMAZON_INVENTORY_MAX_RUNTIME_MS): number {
  return positiveInteger(value, DEFAULT_MAX_INVENTORY_SUMMARY_RUNTIME_MS);
}

/** Backwards-compatible estimate used by diagnostics and preflight reporting. */
export function inventorySummaryRequestBudget(
  marketplaceCount: number,
  batchCountOrPages = inventorySummaryMaxPagesPerBatch(),
): number {
  return Math.max(1, marketplaceCount) * Math.max(1, batchCountOrPages);
}

export function assertInventorySummaryRequestBudget(params: {
  amazonHttpCalls: number;
  requestBudget: number;
}): void {
  if (params.amazonHttpCalls >= params.requestBudget) {
    throw new Error(`FBA Inventory request budget exceeded (${params.requestBudget}).`);
  }
}

export function assertInventorySummaryPageBudget(params: {
  pageNumber: number;
  maxPagesPerBatch: number;
}): void {
  if (params.pageNumber > params.maxPagesPerBatch) {
    throw new Error(`FBA Inventory page budget exceeded (${params.maxPagesPerBatch}).`);
  }
}

export function assertInventorySummaryRuntimeBudget(params: {
  startedAtMs: number;
  nowMs?: number;
  maxRuntimeMs: number;
}): void {
  if ((params.nowMs ?? Date.now()) - params.startedAtMs >= params.maxRuntimeMs) {
    throw new Error(`FBA Inventory runtime budget exceeded (${params.maxRuntimeMs}ms).`);
  }
}
