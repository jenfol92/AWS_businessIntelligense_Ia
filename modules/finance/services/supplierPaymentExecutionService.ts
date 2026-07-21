import { markSupplierPaymentPaidRpc } from "../repositories/supplierPaymentExecutionRepository";
import {
  SupplierPaymentExecutionError,
  type MarkSupplierPaymentPaidInput,
  type MarkSupplierPaymentPaidPayload,
  type MarkSupplierPaymentPaidResult,
  type SupplierPaymentExecutionErrorCode,
} from "../types/supplierPaymentExecution.types";

const PAYMENT_SOURCES = ["cash", "caja_rural", "la_caixa", "bbva"] as const;

const ERROR_STATUS: Record<SupplierPaymentExecutionErrorCode, number> = {
  INVALID_REQUEST: 400,
  INVALID_PAID_AT: 400,
  INVALID_ACTUAL_FX_RATE: 400,
  INVALID_ACTUAL_AMOUNT_EUR: 400,
  INVALID_BANK_FEE: 400,
  INVALID_FF_FEE: 400,
  INVALID_PAYMENT_SOURCE: 400,
  MISSING_ACTUAL_VALUE: 400,
  INCONSISTENT_ACTUAL_VALUES: 422,
  SUPPLIER_PAYMENT_NOT_FOUND: 404,
  PAYMENT_ORDER_MISMATCH: 409,
  SUPPLIER_PAYMENT_ALREADY_PAID: 409,
  INVALID_ORIGINAL_AMOUNT: 422,
  INVALID_ORIGINAL_CURRENCY: 422,
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

  const paymentSource = optionalString(payload.paymentSource);
  if (
    paymentSource != null &&
    !PAYMENT_SOURCES.includes(paymentSource as (typeof PAYMENT_SOURCES)[number])
  ) {
    throw executionError("INVALID_PAYMENT_SOURCE", "La fuente de pago no es válida.");
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
    paymentSource: paymentSource as MarkSupplierPaymentPaidInput["paymentSource"],
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
  ) => Promise<MarkSupplierPaymentPaidResult> = markSupplierPaymentPaidRpc,
): Promise<MarkSupplierPaymentPaidResult> {
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
