import type { CanonicalFbmInventoryRow } from "./amazonFbmInventoryCanonical.ts";
import { FBM_REPORT_MARKETPLACE } from "./fbmReportsSnapshot.ts";

export type FbmSnapshotCommit = (args: Record<string, unknown>, signal: AbortSignal) => Promise<{ data: unknown; error: unknown }>;
export const commitFbmSnapshotRpc: FbmSnapshotCommit = async (args, signal) => {
  const { supabaseAdmin } = await import("../../server/supabase/adminClient.ts");
  return supabaseAdmin.rpc("commit_amazon_fbm_inventory_snapshot_run", args).abortSignal(signal);
};

/** The sole write boundary of Reports FBM. The existing RPC owns the DB transaction. */
export async function commitCompleteFbmReportSnapshot(runId: string, observedAt: string, expectedIdentityCount: number, rows: CanonicalFbmInventoryRow[], signal: AbortSignal, commit: FbmSnapshotCommit = commitFbmSnapshotRpc) {
  if (expectedIdentityCount <= 0 || rows.length !== expectedIdentityCount || new Set(rows.map(r => r.seller_sku)).size !== rows.length || new Set(rows.map(r => r.producto_id)).size !== rows.length) throw new Error("INCOMPLETE_SNAPSHOT");
  if (rows.some(r => r.marketplace_id !== FBM_REPORT_MARKETPLACE || r.observed_at !== observedAt || r.seller_sku !== r.sku_limpio || !Number.isSafeInteger(r.available_quantity) || r.available_quantity < 0)) throw new Error("INVALID_SNAPSHOT");
  signal.throwIfAborted();
  const { data, error } = await commit({ p_run_id: runId, p_observed_at: observedAt, p_marketplace_id: FBM_REPORT_MARKETPLACE, p_expected_identity_count: expectedIdentityCount, p_completed_identity_count: rows.length, p_capture_complete: true, p_rows: rows }, signal);
  if (error || data !== rows.length) throw new Error("COMMIT_NOT_CONFIRMED");
  return rows.length;
}
