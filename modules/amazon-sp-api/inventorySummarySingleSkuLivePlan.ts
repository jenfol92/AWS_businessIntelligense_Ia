import { INVENTORY_DIAGNOSTIC_MARKETPLACES } from "./fbaInventorySingleSkuDiagnostic";

export const INVENTORY_SUMMARY_SINGLE_SKU_LIVE_PLAN = {
  marketplace: "ES" as const,
  marketplaceId: INVENTORY_DIAGNOSTIC_MARKETPLACES.ES,
  sellerSku: "f8436616610104",
  sellerSkuBatchSize: 1,
  maxAmazonRequests: 1,
  maxRetries: 0,
  pacingMs: 1_000,
  paginationMode: "diagnostic-stop" as const,
  publishSnapshot: false,
};

export function buildSingleSkuEsDiagnosticInput() {
  return { ...INVENTORY_SUMMARY_SINGLE_SKU_LIVE_PLAN };
}
