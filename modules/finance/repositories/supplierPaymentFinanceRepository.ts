import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FinanceSupplierPaymentInput,
  FinanceSupplierPaymentResult,
} from "@/modules/finance/types/supplierPaymentFinance.types";

type SupabaseErrorLike = {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

export type SupplierPaymentFinanceSupabaseClient = SupabaseClient;

export function createSupplierPaymentFinanceSupabaseClient(): SupplierPaymentFinanceSupabaseClient {
  return createSupabaseRouteClient();
}

function formatSupabaseError(error: SupabaseErrorLike): string {
  return JSON.stringify({
    message: error.message,
    details: error.details ?? null,
    hint: error.hint ?? null,
    code: error.code ?? null,
  });
}

export async function financeSupplierPaymentRpc(
  input: FinanceSupplierPaymentInput,
  supabase: SupplierPaymentFinanceSupabaseClient =
    createSupplierPaymentFinanceSupabaseClient(),
): Promise<FinanceSupplierPaymentResult> {
  const { data, error } = await supabase.rpc("finance_finance_supplier_payment", {
    p_supplier_payment_id: input.supplierPaymentId,
    p_source_type: input.sourceType,
    p_movement_date: input.movementDate,
    p_cash_account_id: input.cashAccountId ?? null,
    p_credit_line_id: input.creditLineId ?? null,
    p_notes: input.notes ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });

  if (error) throw new Error(formatSupabaseError(error));
  return data as FinanceSupplierPaymentResult;
}
