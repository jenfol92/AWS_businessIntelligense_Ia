import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CashAccountRow,
  CashMovementDirection,
  CashMovementRow,
  CashMovementType,
  CreditLineDrawdownRpcResponse,
  CreditLineMovementRow,
  CreditLineMovementType,
  CreditLineRepaymentRpcResponse,
  CreditLineRepaymentV2RpcResponse,
  CreateCreditLineRepaymentV2Input,
  CreditLineRow,
  RepaymentGroupRow,
  RepaymentGroupStatus,
} from "@/modules/finance/types/creditLineLedger.types";

type SupabaseErrorLike = {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

export type LedgerSupabaseClient = SupabaseClient;

export function createLedgerSupabaseClient(): LedgerSupabaseClient {
  return createSupabaseRouteClient();
}

export function formatLedgerSupabaseError(error: SupabaseErrorLike): string {
  return JSON.stringify({
    message: error.message,
    details: error.details ?? null,
    hint: error.hint ?? null,
    code: error.code ?? null,
  });
}

function throwIfError(error: SupabaseErrorLike | null): void {
  if (error) throw new Error(formatLedgerSupabaseError(error));
}

export async function fetchCreditLineById(
  creditLineId: string,
  supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CreditLineRow | null> {
  const { data, error } = await supabase
    .from("finance_credit_lines")
    .select("id, bank_name, line_name, credit_limit, available_amount, used_amount, cycle_days, status")
    .eq("id", creditLineId)
    .maybeSingle();

  throwIfError(error);
  return (data as CreditLineRow | null) ?? null;
}

export async function fetchCashAccountById(
  cashAccountId: string,
  supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CashAccountRow | null> {
  const { data, error } = await supabase
    .from("finance_cash_accounts")
    .select("id, name, balance, currency")
    .eq("id", cashAccountId)
    .maybeSingle();

  throwIfError(error);
  return (data as CashAccountRow | null) ?? null;
}

export async function fetchCashMovementById(
  cashMovementId: string,
  supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CashMovementRow | null> {
  const { data, error } = await supabase
    .from("finance_cash_movements")
    .select("*")
    .eq("id", cashMovementId)
    .maybeSingle();

  throwIfError(error);
  return (data as CashMovementRow | null) ?? null;
}

export async function fetchCreditLineMovementById(
  movementId: string,
  supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CreditLineMovementRow | null> {
  const { data, error } = await supabase
    .from("finance_credit_line_movements")
    .select("*")
    .eq("id", movementId)
    .maybeSingle();

  throwIfError(error);
  return (data as CreditLineMovementRow | null) ?? null;
}

export async function findOpenRepaymentGroupForDate(
  input: {
    creditLineId: string;
    movementDate: string;
  },
  supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<RepaymentGroupRow | null> {
  const { data, error } = await supabase
    .from("finance_credit_line_repayment_groups")
    .select("*")
    .eq("credit_line_id", input.creditLineId)
    .in("status", ["open", "partially_paid"])
    .lte("period_start", input.movementDate)
    .gte("period_end", input.movementDate)
    .order("period_start", { ascending: true })
    .limit(1)
    .maybeSingle();

  throwIfError(error);
  return (data as RepaymentGroupRow | null) ?? null;
}

export async function fetchRepaymentGroupById(
  repaymentGroupId: string,
  supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<RepaymentGroupRow | null> {
  const { data, error } = await supabase
    .from("finance_credit_line_repayment_groups")
    .select("*")
    .eq("id", repaymentGroupId)
    .maybeSingle();

  throwIfError(error);
  return (data as RepaymentGroupRow | null) ?? null;
}

export async function insertRepaymentGroup(
  _input: {
    creditLineId: string;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
  },
  _supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<RepaymentGroupRow> {
  throw new Error(
    "DIRECT_DML_FORBIDDEN: insertRepaymentGroup blocked; use finance_create_credit_line_drawdown",
  );
}

export async function createCreditLineDrawdownRpc(
  input: {
    creditLineId: string;
    amount: number;
    movementDate: string;
    sourceType: "supplier_payment" | "manual" | "purchase_payment_batch";
    sourceId?: string | null;
    description: string;
    idempotencyKey?: string | null;
    manualDueDate?: string | null;
  },
  supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CreditLineDrawdownRpcResponse> {
  const { data, error } = await supabase.rpc("finance_create_credit_line_drawdown", {
    p_credit_line_id: input.creditLineId,
    p_amount: input.amount,
    p_movement_date: input.movementDate,
    p_source_type: input.sourceType,
    p_source_id: input.sourceId ?? null,
    p_description: input.description,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_manual_due_date: input.manualDueDate ?? null,
  });

  throwIfError(error);
  return data as CreditLineDrawdownRpcResponse;
}

export async function createCreditLineRepaymentRpc(
  input: {
    creditLineId: string;
    amount: number;
    movementDate: string;
    cashAccountId: string;
    repaymentGroupId: string;
    sourceType: "repayment_group" | "manual_repayment";
    sourceId?: string | null;
    notes?: string | null;
    bankReference?: string | null;
    idempotencyKey?: string | null;
  },
  supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CreditLineRepaymentRpcResponse> {
  // Legacy compatibility helper only. User-facing repayment routes must use V2.
  const { data, error } = await supabase.rpc("finance_create_credit_line_repayment", {
    p_credit_line_id: input.creditLineId,
    p_amount: input.amount,
    p_movement_date: input.movementDate,
    p_cash_account_id: input.cashAccountId,
    p_repayment_group_id: input.repaymentGroupId,
    p_source_type: input.sourceType,
    p_source_id: input.sourceId ?? null,
    p_notes: input.notes ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_bank_reference: input.bankReference ?? null,
  });

  throwIfError(error);
  return data as CreditLineRepaymentRpcResponse;
}

export async function createCreditLineRepaymentV2Rpc(
  input: CreateCreditLineRepaymentV2Input,
  supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CreditLineRepaymentV2RpcResponse> {
  const { data, error } = await supabase.rpc("finance_create_credit_line_repayment_v2", {
    p_credit_line_id: input.creditLineId,
    p_repayment_group_id: input.repaymentGroupId,
    p_cash_account_id: input.cashAccountId,
    p_principal_paid_eur: input.principalPaidEur,
    p_interest_paid_eur: input.interestPaidEur,
    p_fees_paid_eur: input.feesPaidEur,
    p_effective_date: input.effectiveDate,
    p_bank_reference: input.bankReference,
    p_notes: input.notes,
    p_idempotency_key: input.idempotencyKey,
  });

  throwIfError(error);
  return data as CreditLineRepaymentV2RpcResponse;
}

export async function findExistingCreditLineMovement(
  input: {
    creditLineId: string;
    movementType: CreditLineMovementType;
    sourceType?: string | null;
    sourceId?: string | null;
    idempotencyKey?: string | null;
  },
  supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CreditLineMovementRow | null> {
  if (input.idempotencyKey) {
    const { data, error } = await supabase
      .from("finance_credit_line_movements")
      .select("*")
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();

    throwIfError(error);
    if (data) return data as CreditLineMovementRow;
  }

  if (input.sourceType && input.sourceId) {
    const { data, error } = await supabase
      .from("finance_credit_line_movements")
      .select("*")
      .eq("credit_line_id", input.creditLineId)
      .eq("movement_type", input.movementType)
      .eq("source_type", input.sourceType)
      .eq("source_id", input.sourceId)
      .maybeSingle();

    throwIfError(error);
    return (data as CreditLineMovementRow | null) ?? null;
  }

  return null;
}

export async function insertCreditLineMovement(
  _input: {
    creditLineId: string;
    movementType: CreditLineMovementType;
    description: string;
    dueDate?: string | null;
    paidAt?: string | null;
    amount: number;
    status: string;
    sourceType?: string | null;
    sourceId?: string | null;
    movementDate: string;
    repaymentGroupId?: string | null;
    idempotencyKey?: string | null;
  },
  _supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CreditLineMovementRow> {
  throw new Error(
    "DIRECT_DML_FORBIDDEN: insertCreditLineMovement blocked; use finance_create_credit_line_* RPCs",
  );
}

export async function updateCreditLineMovementCashMovement(
  _input: {
    movementId: string;
    cashMovementId: string;
  },
  _supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CreditLineMovementRow> {
  throw new Error(
    "DIRECT_DML_FORBIDDEN: updateCreditLineMovementCashMovement blocked; use atomic RPCs",
  );
}

export async function updateRepaymentGroupAmounts(
  _input: {
    groupId: string;
    amount: number;
    paidAmount: number;
    remainingAmount: number;
    status: RepaymentGroupStatus;
    paidAt?: string | null;
  },
  _supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<RepaymentGroupRow> {
  throw new Error(
    "DIRECT_DML_FORBIDDEN: updateRepaymentGroupAmounts blocked; use atomic RPCs",
  );
}

export async function updateCreditLineBalances(
  _input: {
    creditLineId: string;
    usedAmount: number;
    availableAmount: number;
  },
  _supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CreditLineRow> {
  throw new Error(
    "DIRECT_DML_FORBIDDEN: updateCreditLineBalances blocked; use atomic RPCs",
  );
}

export async function insertCashMovement(
  _input: {
    cashAccountId: string;
    movementType: CashMovementType;
    direction: CashMovementDirection;
    amount: number;
    sourceType?: string | null;
    sourceId?: string | null;
    movementDate: string;
    notes?: string | null;
  },
  _supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CashMovementRow> {
  throw new Error(
    "DIRECT_DML_FORBIDDEN: insertCashMovement blocked; use atomic RPCs",
  );
}

export async function updateCashAccountBalance(
  _input: {
    cashAccountId: string;
    balance: number;
  },
  _supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CashAccountRow> {
  throw new Error(
    "DIRECT_DML_FORBIDDEN: updateCashAccountBalance blocked; use atomic RPCs",
  );
}
