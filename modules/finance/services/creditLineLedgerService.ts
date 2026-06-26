import {
  createCreditLineDrawdownRpc,
  createCreditLineRepaymentRpc,
  fetchCashAccountById,
  fetchCashMovementById,
  fetchCreditLineById,
  fetchCreditLineMovementById,
  fetchRepaymentGroupById,
  findOpenRepaymentGroupForDate,
  insertCashMovement,
  insertRepaymentGroup,
  updateCashAccountBalance,
  type LedgerSupabaseClient,
} from "@/modules/finance/repositories/creditLineLedgerRepository";
import type {
  CashAccountRow,
  CreateCashMovementInput,
  CreateCashMovementResult,
  CreateCreditLineDrawdownInput,
  CreateCreditLineDrawdownResult,
  CreateCreditLineRepaymentInput,
  CreateCreditLineRepaymentResult,
  CreditLineRow,
  FindOrCreateOpenRepaymentGroupInput,
  RepaymentGroupRow,
} from "@/modules/finance/types/creditLineLedger.types";
import { CreditLineLedgerError } from "@/modules/finance/types/creditLineLedger.types";

const EPSILON = 0.000001;

function assertPositiveAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new CreditLineLedgerError("El importe debe ser mayor que 0.", "INVALID_AMOUNT");
  }
}

function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CreditLineLedgerError("La fecha debe tener formato YYYY-MM-DD.", "INVALID_DATE");
  }
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function roundMoney(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function requireCreditLine(line: CreditLineRow | null): CreditLineRow {
  if (!line) {
    throw new CreditLineLedgerError("Linea de credito no encontrada.", "NOT_FOUND");
  }
  return line;
}

function requireCashAccount(account: CashAccountRow | null): CashAccountRow {
  if (!account) {
    throw new CreditLineLedgerError("Cuenta de caja no encontrada.", "NOT_FOUND");
  }
  return account;
}

const LEDGER_ERROR_CODES = [
  "INVALID_AMOUNT",
  "INVALID_DATE",
  "NOT_FOUND",
  "MANUAL_DUE_DATE_REQUIRED",
  "INSUFFICIENT_CREDIT",
  "INSUFFICIENT_USED_AMOUNT",
  "INSUFFICIENT_CASH",
  "GROUP_MISMATCH",
] as const;

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

export async function findOrCreateOpenRepaymentGroup(
  input: FindOrCreateOpenRepaymentGroupInput,
  supabase?: LedgerSupabaseClient,
): Promise<RepaymentGroupRow> {
  assertDate(input.movementDate);

  const creditLine = requireCreditLine(
    await fetchCreditLineById(input.creditLineId, supabase),
  );

  if (creditLine.cycle_days == null) {
    throw new CreditLineLedgerError(
      "La linea requiere vencimiento manual porque no tiene cycle_days.",
      "MANUAL_DUE_DATE_REQUIRED",
    );
  }

  const existingGroup = await findOpenRepaymentGroupForDate(
    {
      creditLineId: input.creditLineId,
      movementDate: input.movementDate,
    },
    supabase,
  );
  if (existingGroup) return existingGroup;

  const periodEnd = addDays(input.movementDate, creditLine.cycle_days);
  return insertRepaymentGroup(
    {
      creditLineId: input.creditLineId,
      periodStart: input.movementDate,
      periodEnd,
      dueDate: periodEnd,
    },
    supabase,
  );
}

export async function createCreditLineDrawdown(
  input: CreateCreditLineDrawdownInput,
  supabase?: LedgerSupabaseClient,
): Promise<CreateCreditLineDrawdownResult> {
  assertPositiveAmount(input.amount);
  assertDate(input.movementDate);

  try {
    const rpcResult = await createCreditLineDrawdownRpc(input, supabase);
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

export async function createCashMovement(
  input: CreateCashMovementInput,
  supabase?: LedgerSupabaseClient,
): Promise<CreateCashMovementResult> {
  assertPositiveAmount(input.amount);
  assertDate(input.movementDate);

  const cashAccountBefore = requireCashAccount(
    await fetchCashAccountById(input.cashAccountId, supabase),
  );
  const balanceDelta = input.direction === "in" ? input.amount : -input.amount;
  const nextBalance = roundMoney(cashAccountBefore.balance + balanceDelta);

  if (input.direction === "out" && nextBalance < -EPSILON) {
    throw new CreditLineLedgerError(
      "La cuenta de caja no tiene saldo suficiente.",
      "INSUFFICIENT_CASH",
    );
  }

  const cashMovement = await insertCashMovement(
    {
      cashAccountId: input.cashAccountId,
      movementType: input.movementType,
      direction: input.direction,
      amount: input.amount,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      movementDate: input.movementDate,
      notes: input.notes ?? null,
    },
    supabase,
  );

  const cashAccount = await updateCashAccountBalance(
    {
      cashAccountId: input.cashAccountId,
      balance: Math.max(0, nextBalance),
    },
    supabase,
  );

  return { cashMovement, cashAccount };
}

export async function createCreditLineRepayment(
  input: CreateCreditLineRepaymentInput,
  supabase?: LedgerSupabaseClient,
): Promise<CreateCreditLineRepaymentResult> {
  assertPositiveAmount(input.amount);
  assertDate(input.movementDate);

  try {
    const rpcResult = await createCreditLineRepaymentRpc(input, supabase);
    const [movement, cashMovement, repaymentGroup, creditLine, cashAccount] =
      await Promise.all([
        fetchCreditLineMovementById(rpcResult.movement_id, supabase),
        fetchCashMovementById(rpcResult.cash_movement_id, supabase),
        rpcResult.repayment_group_id
          ? fetchRepaymentGroupById(rpcResult.repayment_group_id, supabase)
          : Promise.resolve(null),
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
      cashAccount: requireCashAccount(cashAccount),
      idempotent: rpcResult.idempotent,
    };
  } catch (error) {
    translateLedgerRpcError(error);
  }
}
