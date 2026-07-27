import type { SupplierPaymentRow } from "./supplierPayments.types";

export type SupplierPaymentFundingSourceType = "cash_account" | "credit_line";

export type MarkSupplierPaymentPaidPayload = {
  orderId?: unknown;
  paidAt?: unknown;
  actualFxRate?: unknown;
  actualAmountEur?: unknown;
  bankReference?: unknown;
  bankFeeEur?: unknown;
  ffFeeEur?: unknown;
  notes?: unknown;
  sourceType?: unknown;
  cashAccountId?: unknown;
  creditLineId?: unknown;
  /** @deprecated Legacy descriptive label; ignored for accounting. */
  paymentSource?: unknown;
};

export type MarkSupplierPaymentPaidInput = {
  supplierPaymentId: string;
  orderId: string | null;
  paidAt: string;
  actualFxRate: number | null;
  actualAmountEur: number | null;
  bankReference: string | null;
  bankFeeEur: number | null;
  ffFeeEur: number | null;
  notes: string | null;
  sourceType: SupplierPaymentFundingSourceType;
  cashAccountId: string | null;
  creditLineId: string | null;
};

export type MarkSupplierPaymentPaidResult = SupplierPaymentRow & {
  bank_reference: string | null;
};

export type MarkAndFinanceSupplierPaymentResult = {
  payment: MarkSupplierPaymentPaidResult;
  source_type: SupplierPaymentFundingSourceType;
  cash_account_id: string | null;
  credit_line_id: string | null;
  cash_movement_id: string | null;
  credit_line_movement_id: string | null;
  repayment_group_id: string | null;
  supplier_amount_eur: number;
  bank_fee_eur: number;
  ff_fee_eur: number;
  funded_total_eur: number;
  batch_id: string;
  idempotent: boolean;
};

export type SupplierPaymentExecutionErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_PAID_AT"
  | "INVALID_ACTUAL_FX_RATE"
  | "INVALID_ACTUAL_AMOUNT_EUR"
  | "INVALID_BANK_FEE"
  | "INVALID_FF_FEE"
  | "INVALID_SOURCE_TYPE"
  | "MISSING_CASH_ACCOUNT"
  | "MISSING_CREDIT_LINE"
  | "MISSING_ACTUAL_VALUE"
  | "INCONSISTENT_ACTUAL_VALUES"
  | "SUPPLIER_PAYMENT_NOT_FOUND"
  | "PAYMENT_ORDER_MISMATCH"
  | "SUPPLIER_PAYMENT_ALREADY_PAID"
  | "INVALID_ORIGINAL_AMOUNT"
  | "INVALID_ORIGINAL_CURRENCY"
  | "INSUFFICIENT_CASH"
  | "INSUFFICIENT_CREDIT"
  | "CREDIT_LINE_INACTIVE"
  | "INVALID_CASH_ACCOUNT_CURRENCY"
  | "INVALID_PAYEE_TYPE"
  | "INVALID_IDEMPOTENCY_KEY"
  | "INVALID_AMOUNT"
  | "INVALID_ACTUAL_VALUES"
  | "INVALID_FEE"
  | "INVALID_ALLOCATIONS"
  | "INVALID_ALLOCATION_AMOUNT"
  | "ALLOCATION_SUM_MISMATCH"
  | "OBLIGATION_NOT_FOUND"
  | "ORDER_NOT_FOUND"
  | "CASH_ACCOUNT_NOT_FOUND"
  | "CREDIT_LINE_NOT_FOUND"
  | "INVALID_SOURCE"
  | "PARTIAL_PAYMENT_PLAN_MISMATCH"
  | "LEGACY_MANUAL_PAYMENT"
  | "MISSING_FUNDING_SOURCE"
  | "OBLIGATION_ALREADY_PAID"
  | "OVERALLOCATION"
  | "ORDER_NOT_CONFIRMED"
  | "AGENT_MISMATCH"
  | "CURRENCY_MISMATCH"
  | "UNAUTHORIZED";

export class SupplierPaymentExecutionError extends Error {
  constructor(
    message: string,
    public readonly code: SupplierPaymentExecutionErrorCode,
    public readonly status: number,
  ) {
    super(message);
    this.name = "SupplierPaymentExecutionError";
  }
}
