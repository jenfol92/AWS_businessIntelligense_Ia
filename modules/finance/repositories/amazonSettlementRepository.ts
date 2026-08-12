import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { AmazonSettlementCandidate, AmazonSettlementReconciliation } from "../types/amazonSettlement.types";

function fail(error: { message: string; code?: string | null; details?: string | null } | null) {
  if (error) throw new Error(JSON.stringify(error));
}

export async function reconcileAmazonSettlementRpc(
  settlement: AmazonSettlementCandidate,
): Promise<AmazonSettlementReconciliation> {
  const client = createSupabaseRouteClient();
  const { data, error } = await client.rpc("finance_reconcile_amazon_settlement", {
    p_settlement_id: settlement.settlementId,
    p_marketplace: settlement.marketplace,
    p_currency: settlement.currency,
    p_amount: settlement.amount,
    p_cycle_start: settlement.cycleStart,
    p_cycle_end: settlement.cycleEnd,
    p_fund_transfer_at: settlement.fundTransferAt,
    p_fund_transfer_status: settlement.transferStatus,
    p_trace_id: settlement.traceId,
    p_processing_status: settlement.processingStatus,
    p_source_payload: { group: settlement.group, transactions: settlement.transactions },
  });
  fail(error);
  return data as AmazonSettlementReconciliation;
}

export async function getAmazonExpectedNetRatio(): Promise<number> {
  const client = createSupabaseRouteClient();
  const { data, error } = await client
    .from("finance_settings")
    .select("value")
    .eq("key", "amazon_expected_net_ratio")
    .maybeSingle();
  fail(error);
  const ratio = Number(data?.value ?? 0.75);
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new Error("INVALID_AMAZON_EXPECTED_NET_RATIO");
  return ratio;
}
