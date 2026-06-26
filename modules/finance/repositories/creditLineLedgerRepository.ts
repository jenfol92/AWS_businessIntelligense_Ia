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
  input: {
    creditLineId: string;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
  },
  supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<RepaymentGroupRow> {
  const { data, error } = await supabase
    .from("finance_credit_line_repayment_groups")
    .insert({
      credit_line_id: input.creditLineId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      due_date: input.dueDate,
      amount: 0,
      paid_amount: 0,
      remaining_amount: 0,
      status: "open",
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  throwIfError(error);
  return data as RepaymentGroupRow;
}

export async function createCreditLineDrawdownRpc(
  input: {
    creditLineId: string;
    amount: number;
    movementDate: string;
    sourceType: "supplier_payment" | "manual";
    sourceId?: string | null;
    description: string;
    idempotencyKey?: string | null;
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
    repaymentGroupId?: string | null;
    sourceType: "repayment_group" | "manual_repayment";
    sourceId?: string | null;
    notes?: string | null;
    idempotencyKey?: string | null;
  },
  supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CreditLineRepaymentRpcResponse> {
  const { data, error } = await supabase.rpc("finance_create_credit_line_repayment", {
    p_credit_line_id: input.creditLineId,
    p_amount: input.amount,
    p_movement_date: input.movementDate,
    p_cash_account_id: input.cashAccountId,
    p_repayment_group_id: input.repaymentGroupId ?? null,
    p_source_type: input.sourceType,
    p_source_id: input.sourceId ?? null,
    p_notes: input.notes ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });

  throwIfError(error);
  return data as CreditLineRepaymentRpcResponse;
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
  input: {
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
  supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CreditLineMovementRow> {
  const { data, error } = await supabase
    .from("finance_credit_line_movements")
    .insert({
      credit_line_id: input.creditLineId,
      movement_type: input.movementType,
      description: input.description,
      due_date: input.dueDate ?? null,
      paid_at: input.paidAt ?? null,
      amount: input.amount,
      status: input.status,
      source_type: input.sourceType ?? null,
      source_id: input.sourceId ?? null,
      movement_date: input.movementDate,
      repayment_group_id: input.repaymentGroupId ?? null,
      idempotency_key: input.idempotencyKey ?? null,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  throwIfError(error);
  return data as CreditLineMovementRow;
}

export async function updateCreditLineMovementCashMovement(
  input: {
    movementId: string;
    cashMovementId: string;
  },
  supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CreditLineMovementRow> {
  const { data, error } = await supabase
    .from("finance_credit_line_movements")
    .update({
      cash_movement_id: input.cashMovementId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.movementId)
    .select("*")
    .single();

  throwIfError(error);
  return data as CreditLineMovementRow;
}

export async function updateRepaymentGroupAmounts(
  input: {
    groupId: string;
    amount: number;
    paidAmount: number;
    remainingAmount: number;
    status: RepaymentGroupStatus;
    paidAt?: string | null;
  },
  supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<RepaymentGroupRow> {
  const { data, error } = await supabase
    .from("finance_credit_line_repayment_groups")
    .update({
      amount: input.amount,
      paid_amount: input.paidAmount,
      remaining_amount: input.remainingAmount,
      status: input.status,
      paid_at: input.paidAt ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.groupId)
    .select("*")
    .single();

  throwIfError(error);
  return data as RepaymentGroupRow;
}

export async function updateCreditLineBalances(
  input: {
    creditLineId: string;
    usedAmount: number;
    availableAmount: number;
  },
  supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CreditLineRow> {
  const { data, error } = await supabase
    .from("finance_credit_lines")
    .update({
      used_amount: input.usedAmount,
      available_amount: input.availableAmount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.creditLineId)
    .select("id, bank_name, line_name, credit_limit, available_amount, used_amount, cycle_days, status")
    .single();

  throwIfError(error);
  return data as CreditLineRow;
}

export async function insertCashMovement(
  input: {
    cashAccountId: string;
    movementType: CashMovementType;
    direction: CashMovementDirection;
    amount: number;
    sourceType?: string | null;
    sourceId?: string | null;
    movementDate: string;
    notes?: string | null;
  },
  supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CashMovementRow> {
  const { data, error } = await supabase
    .from("finance_cash_movements")
    .insert({
      cash_account_id: input.cashAccountId,
      movement_type: input.movementType,
      direction: input.direction,
      amount: input.amount,
      source_type: input.sourceType ?? null,
      source_id: input.sourceId ?? null,
      movement_date: input.movementDate,
      notes: input.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  throwIfError(error);
  return data as CashMovementRow;
}

export async function updateCashAccountBalance(
  input: {
    cashAccountId: string;
    balance: number;
  },
  supabase: LedgerSupabaseClient = createLedgerSupabaseClient(),
): Promise<CashAccountRow> {
  const { data, error } = await supabase
    .from("finance_cash_accounts")
    .update({
      balance: input.balance,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.cashAccountId)
    .select("id, name, balance, currency")
    .single();

  throwIfError(error);
  return data as CashAccountRow;
}
