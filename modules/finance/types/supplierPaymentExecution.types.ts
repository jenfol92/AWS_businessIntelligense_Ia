import type { SupplierPaymentRow } from "./supplierPayments.types";

export type MarkSupplierPaymentPaidPayload = {
  orderId?: unknown;
  paidAt?: unknown;
  actualFxRate?: unknown;
  actualAmountEur?: unknown;
  bankReference?: unknown;
  paymentSource?: unknown;
  bankFeeEur?: unknown;
  ffFeeEur?: unknown;
  notes?: unknown;
};

export type MarkSupplierPaymentPaidInput = {
  supplierPaymentId: string;
  orderId: string | null;
  paidAt: string;
  actualFxRate: number | null;
  actualAmountEur: number | null;
  bankReference: string | null;
  paymentSource: "cash" | "caja_rural" | "la_caixa" | "bbva" | null;
  bankFeeEur: number | null;
  ffFeeEur: number | null;
  notes: string | null;
};

export type MarkSupplierPaymentPaidResult = SupplierPaymentRow & {
  bank_reference: string | null;
};

export type SupplierPaymentExecutionErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_PAID_AT"
  | "INVALID_ACTUAL_FX_RATE"
  | "INVALID_ACTUAL_AMOUNT_EUR"
  | "INVALID_BANK_FEE"
  | "INVALID_FF_FEE"
  | "INVALID_PAYMENT_SOURCE"
  | "MISSING_ACTUAL_VALUE"
  | "INCONSISTENT_ACTUAL_VALUES"
  | "SUPPLIER_PAYMENT_NOT_FOUND"
  | "PAYMENT_ORDER_MISMATCH"
  | "SUPPLIER_PAYMENT_ALREADY_PAID"
  | "INVALID_ORIGINAL_AMOUNT"
  | "INVALID_ORIGINAL_CURRENCY";

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
