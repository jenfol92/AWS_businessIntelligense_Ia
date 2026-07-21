export type SupplierPaymentFinanceSourceType =
  | "cash_account"
  | "credit_line";

export type SupplierPaymentFinancePayload = {
  sourceType?: unknown;
  movementDate?: unknown;
  cashAccountId?: unknown;
  creditLineId?: unknown;
  notes?: unknown;
  idempotencyKey?: unknown;
};

export type FinanceSupplierPaymentInput = {
  supplierPaymentId: string;
  sourceType: SupplierPaymentFinanceSourceType;
  movementDate: string;
  cashAccountId?: string | null;
  creditLineId?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
};

export type FinanceSupplierPaymentResult = {
  supplier_payment_id: string;
  source_type: SupplierPaymentFinanceSourceType;
  cash_account_id: string | null;
  credit_line_id: string | null;
  cash_movement_id: string | null;
  credit_line_movement_id: string | null;
  repayment_group_id: string | null;
  amount_eur: number;
  idempotent: boolean;
};

export type SupplierPaymentFinanceErrorCode =
  | "INVALID_SOURCE_TYPE"
  | "SUPPLIER_PAYMENT_NOT_FOUND"
  | "SUPPLIER_PAYMENT_NOT_PAID"
  | "INVALID_AMOUNT"
  | "UNVERIFIED_ACTUAL_AMOUNT"
  | "INVALID_DATE"
  | "MISSING_CASH_ACCOUNT"
  | "MISSING_CREDIT_LINE"
  | "INSUFFICIENT_CASH"
  | "ALREADY_FINANCED"
  | "MANUAL_DUE_DATE_REQUIRED"
  | "INSUFFICIENT_CREDIT"
  | "NOT_FOUND";

export class SupplierPaymentFinanceError extends Error {
  constructor(
    message: string,
    public readonly code: SupplierPaymentFinanceErrorCode,
    public readonly status: number,
  ) {
    super(message);
    this.name = "SupplierPaymentFinanceError";
  }
}
