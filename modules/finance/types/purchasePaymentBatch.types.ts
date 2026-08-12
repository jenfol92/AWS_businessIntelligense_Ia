import type { FinanceCashAccount, FinanceCreditLine } from "./planning.types";

export type PurchasePaymentEntryMode = "free_amount" | "selected_payments";
export type PurchasePaymentSourceType = "cash_account" | "credit_line";

export type PurchasePaymentCandidate = {
  supplierPaymentId: string;
  orderId: string;
  orderNumber: string;
  agentOrderNumber: string | null;
  agentId: string;
  agentName: string;
  supplierId: string | null;
  supplierName: string | null;
  paymentType: string;
  amountOriginal: number;
  originalCurrency: string;
  allocatedAmountOriginal: number;
  pendingAmountOriginal: number;
  dueDate: string | null;
  status: "pendiente" | "parcial" | "vencido";
};
export type PurchasePaymentAllocationInput = {
  supplierPaymentId: string;
  amountOriginal: number;
};

export type CreatePurchasePaymentBatchPayload = {
  payeeType?: unknown;
  agentId?: unknown;
  entryMode?: unknown;
  amountOriginal?: unknown;
  originalCurrency?: unknown;
  actualFxRate?: unknown;
  actualFxForeignPerEur?: unknown;
  actualAmountEur?: unknown;
  bankFeeEur?: unknown;
  ffFeeEur?: unknown;
  paidAt?: unknown;
  bankReference?: unknown;
  notes?: unknown;
  sourceType?: unknown;
  cashAccountId?: unknown;
  creditLineId?: unknown;
  manualDueDate?: unknown;
  idempotencyKey?: unknown;
  allocations?: unknown;
};

export type CreatePurchasePaymentBatchInput = {
  payeeType: "agent";
  agentId: string;
  entryMode: PurchasePaymentEntryMode;
  amountOriginal: number;
  originalCurrency: string;
  actualFxRate: number | null;
  actualFxForeignPerEur: number | null;
  actualAmountEur: number | null;
  bankFeeEur: number;
  ffFeeEur: number;
  paidAt: string;
  bankReference: string | null;
  notes: string | null;
  sourceType: PurchasePaymentSourceType;
  cashAccountId: string | null;
  creditLineId: string | null;
  /** Obligatorio cuando la linea seleccionada no tiene cycle_days. */
  manualDueDate: string | null;
  idempotencyKey: string;
  allocations: PurchasePaymentAllocationInput[];
};

export type PurchasePaymentBatchResult = {
  batch: Record<string, unknown>;
  allocations: Record<string, unknown>[];
  movement: Record<string, unknown> | null;
  obligations: Record<string, unknown>[];
  idempotent?: boolean;
};

export type PurchasePaymentCandidateResponse = {
  ok: true;
  candidates: PurchasePaymentCandidate[];
  cashAccounts: FinanceCashAccount[];
  creditLines: FinanceCreditLine[];
};
