import {
  financeSupplierPaymentRpc,
  type SupplierPaymentFinanceSupabaseClient,
} from "@/modules/finance/repositories/supplierPaymentFinanceRepository";
import type {
  FinanceSupplierPaymentInput,
  FinanceSupplierPaymentResult,
  SupplierPaymentFinanceErrorCode,
  SupplierPaymentFinanceSourceType,
} from "@/modules/finance/types/supplierPaymentFinance.types";
import { SupplierPaymentFinanceError } from "@/modules/finance/types/supplierPaymentFinance.types";

const SOURCE_TYPES: SupplierPaymentFinanceSourceType[] = [
  "cash_account",
  "credit_line",
];

const MANUAL_FINANCING_NOT_ALLOWED_MESSAGE =
  "La financiación manual no está permitida para pagos proveedor. Selecciona una cuenta/caja o una línea de crédito.";

const SQL_ERROR_CODES: SupplierPaymentFinanceErrorCode[] = [
  "INVALID_SOURCE_TYPE",
  "SUPPLIER_PAYMENT_NOT_FOUND",
  "SUPPLIER_PAYMENT_NOT_PAID",
  "INVALID_AMOUNT",
  "INVALID_DATE",
  "MISSING_CASH_ACCOUNT",
  "MISSING_CREDIT_LINE",
  "INSUFFICIENT_CASH",
  "ALREADY_FINANCED",
  "MANUAL_DUE_DATE_REQUIRED",
  "INSUFFICIENT_CREDIT",
  "NOT_FOUND",
];

const ERROR_MESSAGES: Record<SupplierPaymentFinanceErrorCode, string> = {
  INVALID_SOURCE_TYPE: "La fuente de financiacion no es valida.",
  SUPPLIER_PAYMENT_NOT_FOUND: "Pago proveedor no encontrado.",
  SUPPLIER_PAYMENT_NOT_PAID: "Primero marca el pago proveedor como pagado.",
  INVALID_AMOUNT: "El importe del pago proveedor debe ser mayor que 0.",
  INVALID_DATE: "movementDate debe tener formato YYYY-MM-DD.",
  MISSING_CASH_ACCOUNT: "cashAccountId es obligatorio para financiar con caja.",
  MISSING_CREDIT_LINE: "creditLineId es obligatorio para financiar con linea.",
  INSUFFICIENT_CASH: "Saldo de caja insuficiente para financiar este pago.",
  ALREADY_FINANCED: "Este pago proveedor ya fue financiado anteriormente.",
  MANUAL_DUE_DATE_REQUIRED: "La linea requiere vencimiento manual.",
  INSUFFICIENT_CREDIT: "La linea de credito no tiene disponibilidad suficiente.",
  NOT_FOUND: "Recurso financiero no encontrado.",
};

const ERROR_STATUSES: Record<SupplierPaymentFinanceErrorCode, number> = {
  INVALID_SOURCE_TYPE: 400,
  SUPPLIER_PAYMENT_NOT_FOUND: 404,
  SUPPLIER_PAYMENT_NOT_PAID: 409,
  INVALID_AMOUNT: 400,
  INVALID_DATE: 400,
  MISSING_CASH_ACCOUNT: 400,
  MISSING_CREDIT_LINE: 400,
  INSUFFICIENT_CASH: 409,
  ALREADY_FINANCED: 409,
  MANUAL_DUE_DATE_REQUIRED: 409,
  INSUFFICIENT_CREDIT: 409,
  NOT_FOUND: 404,
};

export function isSupplierPaymentFinanceSourceType(
  value: unknown,
): value is SupplierPaymentFinanceSourceType {
  return typeof value === "string" && SOURCE_TYPES.includes(value as SupplierPaymentFinanceSourceType);
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function financeError(code: SupplierPaymentFinanceErrorCode): SupplierPaymentFinanceError {
  return new SupplierPaymentFinanceError(
    ERROR_MESSAGES[code],
    code,
    ERROR_STATUSES[code],
  );
}

function parseRpcMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw) as { message?: string };
    return parsed.message ?? raw;
  } catch {
    return raw;
  }
}

function translateRpcError(error: unknown): never {
  const message = parseRpcMessage(error);
  const code = SQL_ERROR_CODES.find((item) => message.includes(item));
  if (code) throw financeError(code);
  throw error;
}

export function normalizeFinanceSupplierPaymentInput(input: {
  supplierPaymentId: unknown;
  sourceType: unknown;
  movementDate: unknown;
  cashAccountId?: unknown;
  creditLineId?: unknown;
  notes?: unknown;
  idempotencyKey?: unknown;
}): FinanceSupplierPaymentInput {
  const supplierPaymentId = requiredString(input.supplierPaymentId);
  if (!supplierPaymentId) throw financeError("SUPPLIER_PAYMENT_NOT_FOUND");

  if (input.sourceType === "manual") {
    throw new SupplierPaymentFinanceError(
      MANUAL_FINANCING_NOT_ALLOWED_MESSAGE,
      "INVALID_SOURCE_TYPE",
      400,
    );
  }

  if (!isSupplierPaymentFinanceSourceType(input.sourceType)) {
    throw financeError("INVALID_SOURCE_TYPE");
  }

  if (!isIsoDate(input.movementDate)) {
    throw financeError("INVALID_DATE");
  }

  const cashAccountId = optionalString(input.cashAccountId);
  const creditLineId = optionalString(input.creditLineId);

  if (input.sourceType === "cash_account" && !cashAccountId) {
    throw financeError("MISSING_CASH_ACCOUNT");
  }

  if (input.sourceType === "credit_line" && !creditLineId) {
    throw financeError("MISSING_CREDIT_LINE");
  }

  return {
    supplierPaymentId,
    sourceType: input.sourceType,
    movementDate: input.movementDate,
    cashAccountId,
    creditLineId,
    notes: optionalString(input.notes),
    idempotencyKey: optionalString(input.idempotencyKey),
  };
}

export async function financeSupplierPayment(
  input: FinanceSupplierPaymentInput,
  supabase?: SupplierPaymentFinanceSupabaseClient,
): Promise<FinanceSupplierPaymentResult> {
  try {
    return await financeSupplierPaymentRpc(input, supabase);
  } catch (error) {
    translateRpcError(error);
  }
}

export function getSupplierPaymentFinanceErrorResponse(error: unknown): {
  status: number;
  message: string;
} | null {
  if (!(error instanceof SupplierPaymentFinanceError)) return null;
  return { status: error.status, message: error.message };
}
