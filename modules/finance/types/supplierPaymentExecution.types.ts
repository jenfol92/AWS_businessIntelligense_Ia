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
  amount_eur: number;
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
  | "LEGACY_MANUAL_PAYMENT"
  | "MISSING_FUNDING_SOURCE";

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
