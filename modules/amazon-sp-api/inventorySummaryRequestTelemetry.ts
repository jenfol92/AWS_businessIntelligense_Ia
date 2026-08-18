import { supabaseAdmin } from "@/server/supabase/adminClient";

export type InventorySummaryRequestTelemetry = {
  attemptId: string; requestSequence: number; startedAt: string; finishedAt: string; durationMs: number;
  marketplaceId: string; operationalPool: "EU" | "UK" | "UNKNOWN"; batchNumber: number;
  sellerSkuCount: number; sellerSkusHash: string; pageNumber: number; httpStatus: number | null;
  amazonRequestId: string | null; observedRateLimit: string | null; retryAfter: string | null;
  nextTokenPresent: boolean | null; resultCount: number | null; outcome: "SUCCESS" | "FAILED" | "RATE_LIMITED" | "UNEXPECTED_FILTERED_PAGINATION";
};

export async function persistInventorySummaryRequestTelemetry(row: InventorySummaryRequestTelemetry): Promise<void> {
  const { error } = await supabaseAdmin.from("amazon_inventory_summary_request_telemetry").insert({
    attempt_id: row.attemptId, request_sequence: row.requestSequence, started_at: row.startedAt,
    finished_at: row.finishedAt, duration_ms: row.durationMs, marketplace_id: row.marketplaceId,
    operational_pool: row.operationalPool, batch_number: row.batchNumber, seller_sku_count: row.sellerSkuCount,
    seller_skus_hash: row.sellerSkusHash, page_number: row.pageNumber, http_status: row.httpStatus,
    amazon_request_id: row.amazonRequestId, observed_rate_limit: row.observedRateLimit, retry_after: row.retryAfter,
    next_token_present: row.nextTokenPresent, result_count: row.resultCount, outcome: row.outcome,
  });
  if (error) throw new Error(`INVENTORY_REQUEST_TELEMETRY_PERSIST_FAILED:${error.message}`);
}
