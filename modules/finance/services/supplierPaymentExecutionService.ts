import { markAndFinanceSupplierPaymentRpc } from "../repositories/supplierPaymentExecutionRepository";
import {
  SupplierPaymentExecutionError,
  type MarkAndFinanceSupplierPaymentResult,
  type MarkSupplierPaymentPaidInput,
  type MarkSupplierPaymentPaidPayload,
  type SupplierPaymentExecutionErrorCode,
  type SupplierPaymentFundingSourceType,
} from "../types/supplierPaymentExecution.types";

const FUNDING_SOURCE_TYPES: SupplierPaymentFundingSourceType[] = [
  "cash_account",
  "credit_line",
];

const ERROR_STATUS: Record<SupplierPaymentExecutionErrorCode, number> = {
  INVALID_REQUEST: 422,
  INVALID_PAID_AT: 422,
  INVALID_ACTUAL_FX_RATE: 422,
  INVALID_ACTUAL_AMOUNT_EUR: 422,
  INVALID_BANK_FEE: 422,
  INVALID_FF_FEE: 422,
  INVALID_SOURCE_TYPE: 422,
  MISSING_CASH_ACCOUNT: 422,
  MISSING_CREDIT_LINE: 422,
  MISSING_ACTUAL_VALUE: 422,
  INCONSISTENT_ACTUAL_VALUES: 422,
  SUPPLIER_PAYMENT_NOT_FOUND: 404,
  PAYMENT_ORDER_MISMATCH: 409,
  SUPPLIER_PAYMENT_ALREADY_PAID: 409,
  INVALID_ORIGINAL_AMOUNT: 422,
  INVALID_ORIGINAL_CURRENCY: 422,
  INSUFFICIENT_CASH: 409,
  INSUFFICIENT_CREDIT: 409,
  CREDIT_LINE_INACTIVE: 409,
  INVALID_CASH_ACCOUNT_CURRENCY: 422,
  INVALID_PAYEE_TYPE: 422,
  INVALID_IDEMPOTENCY_KEY: 422,
  INVALID_AMOUNT: 422,
  INVALID_ACTUAL_VALUES: 422,
  INVALID_FEE: 422,
  INVALID_ALLOCATIONS: 422,
  INVALID_ALLOCATION_AMOUNT: 422,
  ALLOCATION_SUM_MISMATCH: 422,
  OBLIGATION_NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  CASH_ACCOUNT_NOT_FOUND: 404,
  CREDIT_LINE_NOT_FOUND: 404,
  INVALID_SOURCE: 422,
  PARTIAL_PAYMENT_PLAN_MISMATCH: 409,
  INVALID_UUID: 422,
  INVALID_PLAN_CURRENCY: 422,
  MANUAL_DUE_DATE_REQUIRED: 422,
  INVALID_DATE: 422,
  IDEMPOTENCY_PAYLOAD_MISMATCH: 409,
  DUPLICATE_ALLOCATION: 422,
  LEGACY_MANUAL_PAYMENT: 409,
  MISSING_FUNDING_SOURCE: 422,
  OBLIGATION_ALREADY_PAID: 409,
  OVERALLOCATION: 409,
  ORDER_NOT_CONFIRMED: 409,
  AGENT_MISMATCH: 409,
  CURRENCY_MISMATCH: 409,
  UNAUTHORIZED: 403,
};

function executionError(
  code: SupplierPaymentExecutionErrorCode,
  message: string,
): SupplierPaymentExecutionError {
  return new SupplierPaymentExecutionError(message, code, ERROR_STATUS[code]);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function optionalPositiveNumber(
  value: unknown,
  code: "INVALID_ACTUAL_FX_RATE" | "INVALID_ACTUAL_AMOUNT_EUR",
  label: string,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw executionError(code, `${label} debe ser un número finito mayor que 0.`);
  }
  return parsed;
}

function optionalNonNegativeNumber(
  value: unknown,
  code: "INVALID_BANK_FEE" | "INVALID_FF_FEE",
  label: string,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw executionError(code, `${label} debe ser un número finito mayor o igual que 0.`);
  }
  return parsed;
}

function normalizePaidAt(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw executionError("INVALID_PAID_AT", "paidAt debe tener formato YYYY-MM-DD.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw executionError("INVALID_PAID_AT", "paidAt no es una fecha válida.");
  }
  return date.toISOString();
}

export function normalizeMarkSupplierPaymentPaidInput(
  supplierPaymentId: unknown,
  payload: MarkSupplierPaymentPaidPayload,
): MarkSupplierPaymentPaidInput {
  const id = optionalString(supplierPaymentId);
  if (!id) {
    throw executionError("INVALID_REQUEST", "El identificador del pago es obligatorio.");
  }
  if (!UUID_PATTERN.test(id)) {
    throw executionError("INVALID_UUID", "supplierPaymentId debe ser un UUID valido.");
  }

  if (payload.sourceType === "manual") {
    throw executionError(
      "INVALID_SOURCE_TYPE",
      "La financiación manual no está permitida. Selecciona caja/cuenta o línea de crédito.",
    );
  }

  if (
    typeof payload.sourceType !== "string" ||
    !FUNDING_SOURCE_TYPES.includes(payload.sourceType as SupplierPaymentFundingSourceType)
  ) {
    throw executionError(
      "INVALID_SOURCE_TYPE",
      "sourceType debe ser cash_account o credit_line.",
    );
  }

  const sourceType = payload.sourceType as SupplierPaymentFundingSourceType;
  const cashAccountId = optionalString(payload.cashAccountId);
  const creditLineId = optionalString(payload.creditLineId);
  if (cashAccountId && !UUID_PATTERN.test(cashAccountId)) {
    throw executionError("INVALID_UUID", "cashAccountId debe ser un UUID valido.");
  }
  if (creditLineId && !UUID_PATTERN.test(creditLineId)) {
    throw executionError("INVALID_UUID", "creditLineId debe ser un UUID valido.");
  }

  if (sourceType === "cash_account") {
    if (!cashAccountId || creditLineId) {
      throw executionError(
        "MISSING_CASH_ACCOUNT",
        "cashAccountId es obligatorio y creditLineId debe quedar vacío.",
      );
    }
  }

  if (sourceType === "credit_line") {
    if (!creditLineId || cashAccountId) {
      throw executionError(
        "MISSING_CREDIT_LINE",
        "creditLineId es obligatorio y cashAccountId debe quedar vacío.",
      );
    }
  }

  return {
    supplierPaymentId: id,
    orderId: optionalString(payload.orderId),
    paidAt: normalizePaidAt(payload.paidAt),
    actualFxRate: optionalPositiveNumber(
      payload.actualFxRate,
      "INVALID_ACTUAL_FX_RATE",
      "actualFxRate",
    ),
    actualAmountEur: optionalPositiveNumber(
      payload.actualAmountEur,
      "INVALID_ACTUAL_AMOUNT_EUR",
      "actualAmountEur",
    ),
    bankReference: optionalString(payload.bankReference),
    bankFeeEur: optionalNonNegativeNumber(
      payload.bankFeeEur,
      "INVALID_BANK_FEE",
      "bankFeeEur",
    ),
    ffFeeEur: optionalNonNegativeNumber(
      payload.ffFeeEur,
      "INVALID_FF_FEE",
      "ffFeeEur",
    ),
    notes: optionalString(payload.notes),
    sourceType,
    cashAccountId,
    creditLineId,
    manualDueDate: (() => {
      const value = optionalString(payload.manualDueDate);
      if (!value) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw executionError("INVALID_DATE", "manualDueDate debe tener formato YYYY-MM-DD.");
      }
      const date = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw executionError("INVALID_DATE", "manualDueDate no es una fecha valida.");
      }
      return value;
    })(),
  };
}

function rpcMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    return (JSON.parse(raw) as { message?: string }).message ?? raw;
  } catch {
    return raw;
  }
}

export function translateSupplierPaymentExecutionError(error: unknown): never {
  if (error instanceof SupplierPaymentExecutionError) throw error;
  const message = rpcMessage(error);
  const code = (Object.keys(ERROR_STATUS) as SupplierPaymentExecutionErrorCode[])
    .find((candidate) => message.includes(candidate));
  if (code) throw executionError(code, message.replace(`${code}:`, "").trim());
  throw error;
}

export async function markSupplierPaymentPaid(
  input: MarkSupplierPaymentPaidInput,
  execute: (
    value: MarkSupplierPaymentPaidInput,
  ) => Promise<MarkAndFinanceSupplierPaymentResult> = markAndFinanceSupplierPaymentRpc,
): Promise<MarkAndFinanceSupplierPaymentResult> {
  try {
    return await execute(input);
  } catch (error) {
    translateSupplierPaymentExecutionError(error);
  }
}

export function getSupplierPaymentExecutionErrorResponse(error: unknown): {
  status: number;
  code: string;
  message: string;
} | null {
  if (!(error instanceof SupplierPaymentExecutionError)) return null;
  return { status: error.status, code: error.code, message: error.message };
}
