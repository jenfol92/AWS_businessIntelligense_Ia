import type {
  CreatePurchasePaymentBatchInput,
  CreatePurchasePaymentBatchPayload,
  PurchasePaymentAllocationInput,
  PurchasePaymentEntryMode,
  PurchasePaymentSourceType,
} from "../types/purchasePaymentBatch.types";

export class PurchasePaymentBatchError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    message: string,
    code: string,
    status: number,
  ) {
    super(message);
    this.name = "PurchasePaymentBatchError";
    this.code = code;
    this.status = status;
  }
}

const fail = (code: string, message: string, status = 400): never => {
  throw new PurchasePaymentBatchError(message, code, status);
};

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) fail("INVALID_REQUEST", `${label} es obligatorio.`);
  return (value as string).trim();
}

function positive(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) fail("INVALID_REQUEST", `${label} debe ser mayor que 0.`);
  return number;
}

function nonNegative(value: unknown, label: string): number {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) fail("INVALID_REQUEST", `${label} no puede ser negativo.`);
  return number;
}

function optionalPositive(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  return positive(value, label);
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function allocations(value: unknown): PurchasePaymentAllocationInput[] {
  if (!Array.isArray(value) || value.length === 0) fail("INVALID_ALLOCATIONS", "Selecciona al menos una obligación.");
  const seen = new Set<string>();
  return (value as unknown[]).map((row) => {
    if (!row || typeof row !== "object") fail("INVALID_ALLOCATIONS", "Allocation inválida.");
    const record = row as Record<string, unknown>;
    const supplierPaymentId = text(record.supplierPaymentId, "supplierPaymentId");
    if (seen.has(supplierPaymentId)) fail("DUPLICATE_ALLOCATION", "Una obligación no puede repetirse.");
    seen.add(supplierPaymentId);
    return { supplierPaymentId, amountOriginal: positive(record.amountOriginal, "amountOriginal") };
  });
}

export function normalizePurchasePaymentBatchPayload(
  payload: CreatePurchasePaymentBatchPayload,
): CreatePurchasePaymentBatchInput {
  if (payload.payeeType !== "agent") fail("INVALID_PAYEE_TYPE", "Esta versión solo permite pagar a un agente.");
  const entryMode = payload.entryMode;
  if (entryMode !== "free_amount" && entryMode !== "selected_payments") {
    fail("INVALID_ENTRY_MODE", "entryMode debe ser free_amount o selected_payments.");
  }
  const sourceType = payload.sourceType;
  if (sourceType === "manual") fail("INVALID_SOURCE_TYPE", "La fuente manual no está permitida.");
  if (sourceType !== "cash_account" && sourceType !== "credit_line") {
    fail("INVALID_SOURCE_TYPE", "Selecciona una cuenta propia o una línea de crédito.");
  }
  const cashAccountId = optionalText(payload.cashAccountId);
  const creditLineId = optionalText(payload.creditLineId);
  if (sourceType === "cash_account" && (!cashAccountId || creditLineId)) {
    fail("INVALID_SOURCE", "La cuenta propia es obligatoria y la línea debe quedar vacía.");
  }
  if (sourceType === "credit_line" && (!creditLineId || cashAccountId)) {
    fail("INVALID_SOURCE", "La línea de crédito es obligatoria y la cuenta debe quedar vacía.");
  }
  const paidAt = text(payload.paidAt, "paidAt");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) fail("INVALID_PAID_AT", "paidAt debe tener formato YYYY-MM-DD.");
  const actualFxRate = optionalPositive(payload.actualFxRate, "actualFxRate");
  const actualAmountEur = optionalPositive(payload.actualAmountEur, "actualAmountEur");
  const originalCurrency = text(payload.originalCurrency, "originalCurrency").toUpperCase();
  if (originalCurrency !== "EUR" && actualFxRate === null && actualAmountEur === null) {
    fail("MISSING_ACTUAL_VALUE", "Introduce el tipo de cambio real o el importe EUR real.");
  }
  return {
    payeeType: "agent",
    agentId: text(payload.agentId, "agentId"),
    entryMode: entryMode as PurchasePaymentEntryMode,
    amountOriginal: positive(payload.amountOriginal, "amountOriginal"),
    originalCurrency,
    actualFxRate,
    actualAmountEur,
    bankFeeEur: nonNegative(payload.bankFeeEur, "bankFeeEur"),
    ffFeeEur: nonNegative(payload.ffFeeEur, "ffFeeEur"),
    paidAt: `${paidAt}T00:00:00.000Z`,
    bankReference: optionalText(payload.bankReference),
    notes: optionalText(payload.notes),
    sourceType: sourceType as PurchasePaymentSourceType,
    cashAccountId,
    creditLineId,
    idempotencyKey: text(payload.idempotencyKey, "idempotencyKey"),
    allocations: allocations(payload.allocations),
  };
}

export function purchasePaymentBatchErrorResponse(error: unknown) {
  if (error instanceof PurchasePaymentBatchError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = message.match(/([A-Z][A-Z0-9_]+):/)?.[1];
  if (!code) return null;
  const expectedStatus: Record<string, number> = {
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
    LEGACY_MANUAL_PAYMENT: 409,
    PARTIAL_PAYMENT_PLAN_MISMATCH: 409,
  };
  const status = expectedStatus[code]
    ?? (/ALREADY|MISMATCH|INSUFFICIENT|OVERALLOC|IDEMPOT/.test(code) ? 409 : 422);
  return { status, code, message: message.replace(`${code}:`, "").trim() };
}
