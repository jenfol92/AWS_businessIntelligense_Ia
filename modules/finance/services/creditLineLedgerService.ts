import {
  createCreditLineDrawdownRpc,
  createCreditLineRepaymentRpc,
  createCreditLineRepaymentV2Rpc,
  fetchCashAccountById,
  fetchCashMovementById,
  fetchCreditLineById,
  fetchCreditLineMovementById,
  fetchRepaymentGroupById,
  type LedgerSupabaseClient,
} from "@/modules/finance/repositories/creditLineLedgerRepository";
import type {
  CreateCashMovementInput,
  CreateCashMovementResult,
  CreateCreditLineDrawdownInput,
  CreateCreditLineDrawdownResult,
  CreateCreditLineRepaymentInput,
  CreateCreditLineRepaymentResult,
  CreateCreditLineRepaymentV2Input,
  CreateCreditLineRepaymentV2Result,
  CreditLineRow,
  FindOrCreateOpenRepaymentGroupInput,
  RepaymentGroupRow,
} from "@/modules/finance/types/creditLineLedger.types";
import { CreditLineLedgerError } from "@/modules/finance/types/creditLineLedger.types";
import {
  isFinitePositiveMoney,
  isRealIsoDate,
  roundMoney,
} from "@/modules/finance/utils/financeInputValidation";

function assertPositiveAmount(amount: number): void {
  if (!isFinitePositiveMoney(amount)) {
    throw new CreditLineLedgerError(
      "El importe debe ser un numero finito mayor que 0.",
      "INVALID_AMOUNT",
    );
  }
}

function assertDate(value: string): void {
  if (!isRealIsoDate(value)) {
    throw new CreditLineLedgerError(
      "La fecha no es una fecha valida (YYYY-MM-DD).",
      "INVALID_DATE",
    );
  }
}

function requireCreditLine(line: CreditLineRow | null): CreditLineRow {
  if (!line) {
    throw new CreditLineLedgerError("Linea de credito no encontrada.", "NOT_FOUND");
  }
  return line;
}

function requireCashAccount(
  account: Awaited<ReturnType<typeof fetchCashAccountById>>,
): NonNullable<Awaited<ReturnType<typeof fetchCashAccountById>>> {
  if (!account) {
    throw new CreditLineLedgerError("Cuenta de caja no encontrada.", "NOT_FOUND");
  }
  return account;
}

const LEDGER_ERROR_CODES = [
  "INVALID_AMOUNT",
  "INVALID_DATE",
  "INVALID_CURRENCY",
  "NOT_FOUND",
  "MANUAL_DUE_DATE_REQUIRED",
  "MANUAL_DUE_DATE_NOT_ALLOWED",
  "INSUFFICIENT_CREDIT",
  "INSUFFICIENT_USED_AMOUNT",
  "INSUFFICIENT_CASH",
  "GROUP_MISMATCH",
  "GROUP_CLOSED",
  "CREDIT_LINE_INACTIVE",
  "CREDIT_LINE_DELETED",
  "MISSING_CASH_ACCOUNT",
  "MISSING_REPAYMENT_GROUP",
  "UNAUTHORIZED",
  "IDEMPOTENCY_PAYLOAD_MISMATCH",
  "CASH_ACCOUNT_INACTIVE",
  "ADMIN_OR_ACCOUNTING_REQUIRED",
  "REPAYMENT_DATE_OUT_OF_SEQUENCE",
] as const;

const V2_PUBLIC_MESSAGES: Partial<Record<(typeof LEDGER_ERROR_CODES)[number], string>> = {
  INVALID_AMOUNT: "Los importes de la devolucion no son validos.",
  INVALID_DATE: "La fecha efectiva no es valida.",
  INVALID_CURRENCY: "La cuenta debe estar denominada en EUR.",
  NOT_FOUND: "No se encontro el recurso financiero solicitado.",
  INSUFFICIENT_USED_AMOUNT: "El principal supera el saldo pendiente.",
  INSUFFICIENT_CASH: "La cuenta no tiene saldo suficiente.",
  GROUP_MISMATCH: "El vencimiento no pertenece a la linea de credito.",
  GROUP_CLOSED: "El vencimiento ya no admite devoluciones.",
  CASH_ACCOUNT_INACTIVE: "La cuenta de caja no esta activa.",
  IDEMPOTENCY_PAYLOAD_MISMATCH: "La clave de idempotencia pertenece a otro payload.",
  ADMIN_OR_ACCOUNTING_REQUIRED: "Finance access denied",
  REPAYMENT_DATE_OUT_OF_SEQUENCE: "La fecha efectiva es anterior a la secuencia financiera del vencimiento.",
};

function translateLedgerRpcError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const parsedMessage = (() => {
    try {
      const parsed = JSON.parse(message) as { message?: string };
      return parsed.message ?? message;
    } catch {
      return message;
    }
  })();

  const code = LEDGER_ERROR_CODES.find((item) => parsedMessage.includes(item));
  if (code) {
    throw new CreditLineLedgerError(parsedMessage, code);
  }

  throw error;
}

function translateRepaymentV2RpcError(error: unknown): never {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes("42501")) {
    throw new CreditLineLedgerError("Finance access denied", "ADMIN_OR_ACCOUNTING_REQUIRED");
  }
  const code = LEDGER_ERROR_CODES.find((item) => raw.includes(item));
  if (code && V2_PUBLIC_MESSAGES[code]) {
    throw new CreditLineLedgerError(V2_PUBLIC_MESSAGES[code]!, code);
  }
  throw new CreditLineLedgerError("No se pudo registrar la devolucion.", "INTERNAL_ERROR");
}

export async function createCreditLineRepaymentV2(
  input: CreateCreditLineRepaymentV2Input,
  supabase?: LedgerSupabaseClient,
): Promise<CreateCreditLineRepaymentV2Result> {
  try {
    const result = await createCreditLineRepaymentV2Rpc(input, supabase);
    return {
      repaymentId: result.repayment_id,
      creditLineId: result.credit_line_id,
      repaymentGroupId: result.repayment_group_id,
      principalPaidEur: Number(result.principal_paid_eur),
      interestPaidEur: Number(result.interest_paid_eur),
      feesPaidEur: Number(result.fees_paid_eur),
      totalCashOutEur: Number(result.total_cash_out_eur),
      principalOutstandingEur: Number(result.principal_outstanding_eur),
      creditUsedEur: Number(result.credit_used_eur),
      creditAvailableEur: Number(result.credit_available_eur),
      cashBalanceEur: Number(result.cash_balance_eur),
      status: result.status,
    };
  } catch (error) {
    if (error instanceof CreditLineLedgerError) throw error;
    translateRepaymentV2RpcError(error);
  }
}

/**
 * Legacy helper. Operative flows must use finance_create_credit_line_drawdown RPC.
 * Direct DML is revoked for authenticated.
 */
export async function findOrCreateOpenRepaymentGroup(
  _input: FindOrCreateOpenRepaymentGroupInput & { manualDueDate?: string | null },
  _supabase?: LedgerSupabaseClient,
): Promise<RepaymentGroupRow> {
  throw new CreditLineLedgerError(
    "findOrCreateOpenRepaymentGroup esta bloqueado. Usa finance_create_credit_line_drawdown.",
    "DIRECT_DML_FORBIDDEN",
  );
}

export async function createCreditLineDrawdown(
  input: CreateCreditLineDrawdownInput,
  supabase?: LedgerSupabaseClient,
): Promise<CreateCreditLineDrawdownResult> {
  assertPositiveAmount(input.amount);
  assertDate(input.movementDate);
  if (input.manualDueDate) assertDate(input.manualDueDate);

  try {
    const rpcResult = await createCreditLineDrawdownRpc(
      {
        ...input,
        amount: roundMoney(input.amount),
      },
      supabase,
    );
    const [movement, repaymentGroup, creditLine] = await Promise.all([
      fetchCreditLineMovementById(rpcResult.movement_id, supabase),
      fetchRepaymentGroupById(rpcResult.repayment_group_id, supabase),
      fetchCreditLineById(rpcResult.credit_line_id, supabase),
    ]);

    if (!movement) {
      throw new CreditLineLedgerError("Movimiento de linea no encontrado.", "NOT_FOUND");
    }
    if (!repaymentGroup) {
      throw new CreditLineLedgerError("Grupo de vencimiento no encontrado.", "NOT_FOUND");
    }

    return {
      movement,
      repaymentGroup,
      creditLine: requireCreditLine(creditLine),
      idempotent: rpcResult.idempotent,
    };
  } catch (error) {
    translateLedgerRpcError(error);
  }
}

/**
 * Legacy helper. Cash movements must be created inside atomic RPCs.
 */
export async function createCashMovement(
  _input: CreateCashMovementInput,
  _supabase?: LedgerSupabaseClient,
): Promise<CreateCashMovementResult> {
  throw new CreditLineLedgerError(
    "createCashMovement esta bloqueado. Usa RPCs atomicas (repayment/batch/mark-paid).",
    "DIRECT_DML_FORBIDDEN",
  );
}

export async function createCreditLineRepayment(
  input: CreateCreditLineRepaymentInput,
  supabase?: LedgerSupabaseClient,
): Promise<CreateCreditLineRepaymentResult> {
  // Legacy compatibility helper only. User-facing repayment routes must use V2.
  assertPositiveAmount(input.amount);
  assertDate(input.movementDate);

  if (!input.repaymentGroupId) {
    throw new CreditLineLedgerError(
      "repaymentGroupId es obligatorio.",
      "MISSING_REPAYMENT_GROUP",
    );
  }

  const cashAccount = requireCashAccount(
    await fetchCashAccountById(input.cashAccountId, supabase),
  );
  if (cashAccount.currency.trim().toUpperCase() !== "EUR") {
    throw new CreditLineLedgerError(
      "La cuenta de caja debe ser EUR.",
      "INVALID_CURRENCY",
    );
  }

  try {
    const rpcResult = await createCreditLineRepaymentRpc(
      {
        ...input,
        amount: roundMoney(input.amount),
      },
      supabase,
    );
    const [movement, cashMovement, repaymentGroup, creditLine, cashAccountAfter] =
      await Promise.all([
        fetchCreditLineMovementById(rpcResult.movement_id, supabase),
        fetchCashMovementById(rpcResult.cash_movement_id, supabase),
        fetchRepaymentGroupById(rpcResult.repayment_group_id ?? input.repaymentGroupId, supabase),
        fetchCreditLineById(rpcResult.credit_line_id, supabase),
        fetchCashAccountById(rpcResult.cash_account_id, supabase),
      ]);

    if (!movement) {
      throw new CreditLineLedgerError("Movimiento de linea no encontrado.", "NOT_FOUND");
    }
    if (!cashMovement) {
      throw new CreditLineLedgerError("Movimiento de caja no encontrado.", "NOT_FOUND");
    }

    return {
      movement,
      cashMovement,
      repaymentGroup,
      creditLine: requireCreditLine(creditLine),
      cashAccount: requireCashAccount(cashAccountAfter),
      idempotent: rpcResult.idempotent,
    };
  } catch (error) {
    translateLedgerRpcError(error);
  }
}
