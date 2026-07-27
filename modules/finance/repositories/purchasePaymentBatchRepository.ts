import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreatePurchasePaymentBatchInput,
  PurchasePaymentBatchResult,
  PurchasePaymentCandidate,
} from "../types/purchasePaymentBatch.types";

export async function findPurchasePaymentCandidates(
  query: string,
  supabase: SupabaseClient = createSupabaseRouteClient(),
): Promise<PurchasePaymentCandidate[]> {
  const { data, error } = await supabase.rpc("get_purchase_payment_candidates", {
    p_query: query.trim() || null,
  });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    supplierPaymentId: String(row.supplier_payment_id),
    orderId: String(row.order_id),
    orderNumber: String(row.numero_orden ?? ""),
    agentOrderNumber: row.numero_pedido_agente ? String(row.numero_pedido_agente) : null,
    agentId: String(row.agent_id),
    agentName: String(row.agent_name ?? ""),
    supplierId: row.supplier_id ? String(row.supplier_id) : null,
    supplierName: row.supplier_name ? String(row.supplier_name) : null,
    paymentType: String(row.payment_type),
    amountOriginal: Number(row.amount_original),
    originalCurrency: String(row.original_currency),
    allocatedAmountOriginal: Number(row.allocated_amount_original),
    pendingAmountOriginal: Number(row.pending_amount_original),
    dueDate: row.due_date ? String(row.due_date) : null,
    status: String(row.settlement_status) as PurchasePaymentCandidate["status"],
  }));
}

export async function createPurchasePaymentBatchRpc(
  input: CreatePurchasePaymentBatchInput,
  supabase: SupabaseClient = createSupabaseRouteClient(),
): Promise<PurchasePaymentBatchResult> {
  const { data, error } = await supabase.rpc("create_and_apply_purchase_payment_batch", {
    p_payload: {
      payee_type: input.payeeType,
      agent_id: input.agentId,
      entry_mode: input.entryMode,
      amount_original: input.amountOriginal,
      original_currency: input.originalCurrency,
      actual_fx_rate: input.actualFxRate,
      actual_amount_eur: input.actualAmountEur,
      bank_fee_eur: input.bankFeeEur,
      ff_fee_eur: input.ffFeeEur,
      paid_at: input.paidAt,
      bank_reference: input.bankReference,
      notes: input.notes,
      source_type: input.sourceType,
      cash_account_id: input.cashAccountId,
      credit_line_id: input.creditLineId,
      manual_due_date: input.manualDueDate,
      idempotency_key: input.idempotencyKey,
      allocations: input.allocations.map((row) => ({
        supplier_payment_id: row.supplierPaymentId,
        allocated_amount_original: row.amountOriginal,
      })),
    },
  });
  if (error) throw error;
  return data as PurchasePaymentBatchResult;
}

export async function findPurchasePaymentBatch(
  id: string,
  supabase: SupabaseClient = createSupabaseRouteClient(),
) {
  const { data, error } = await supabase.rpc("get_purchase_payment_batch_detail", {
    p_batch_id: id,
  });
  if (error) throw error;
  return data as PurchasePaymentBatchResult | null;
}
