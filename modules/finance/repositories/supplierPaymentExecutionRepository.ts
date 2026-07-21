import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  MarkSupplierPaymentPaidInput,
  MarkSupplierPaymentPaidResult,
} from "../types/supplierPaymentExecution.types";

export type SupplierPaymentExecutionClient = SupabaseClient;

function formatSupabaseError(error: {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}): string {
  return JSON.stringify({
    message: error.message,
    details: error.details ?? null,
    hint: error.hint ?? null,
    code: error.code ?? null,
  });
}

export async function markSupplierPaymentPaidRpc(
  input: MarkSupplierPaymentPaidInput,
  supabase: SupplierPaymentExecutionClient = createSupabaseRouteClient(),
): Promise<MarkSupplierPaymentPaidResult> {
  const { data, error } = await supabase.rpc("mark_supplier_payment_paid", {
    p_supplier_payment_id: input.supplierPaymentId,
    p_order_id: input.orderId,
    p_paid_at: input.paidAt,
    p_actual_fx_rate: input.actualFxRate,
    p_actual_amount_eur: input.actualAmountEur,
    p_bank_reference: input.bankReference,
    p_payment_source: input.paymentSource,
    p_bank_fee_eur: input.bankFeeEur,
    p_ff_fee_eur: input.ffFeeEur,
    p_notes: input.notes,
  });

  if (error) throw new Error(formatSupabaseError(error));
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("SUPPLIER_PAYMENT_NOT_FOUND: empty RPC response");
  return row as MarkSupplierPaymentPaidResult;
}
