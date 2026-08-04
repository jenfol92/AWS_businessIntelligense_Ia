import type { CreateCreditLineRepaymentV2Input } from "@/modules/finance/types/creditLineLedger.types";
import { CreditLineLedgerError } from "@/modules/finance/types/creditLineLedger.types";
import { isRealIsoDate, isUuid } from "@/modules/finance/utils/financeInputValidation";

export type CreditLineRepaymentV2Payload = {
  repaymentGroupId?: unknown;
  cashAccountId?: unknown;
  principalPaidEur?: unknown;
  interestPaidEur?: unknown;
  feesPaidEur?: unknown;
  effectiveDate?: unknown;
  bankReference?: unknown;
  notes?: unknown;
  idempotencyKey?: unknown;
};

function money(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new CreditLineLedgerError(`${field} debe ser un numero JSON no negativo.`, "INVALID_AMOUNT");
  }
  const cents = value * 100;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(cents)) * 4;
  if (Math.abs(cents - Math.round(cents)) > tolerance) {
    throw new CreditLineLedgerError(`${field} no puede tener mas de dos decimales.`, "INVALID_AMOUNT");
  }
  return Math.round(cents) / 100;
}

function optionalText(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new CreditLineLedgerError(`${field} debe ser texto.`, "INVALID_AMOUNT");
  }
  return value.trim() || null;
}

function requiredText(value: unknown, field: string): string {
  const text = optionalText(value, field);
  if (!text) throw new CreditLineLedgerError(`${field} es obligatorio.`, "INVALID_AMOUNT");
  return text;
}

export function normalizeCreditLineRepaymentV2Input(
  creditLineId: unknown,
  payload: CreditLineRepaymentV2Payload,
): CreateCreditLineRepaymentV2Input {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new CreditLineLedgerError("El payload no es valido.", "INVALID_AMOUNT");
  }
  const allowedFields = new Set([
    "repaymentGroupId", "cashAccountId", "principalPaidEur", "interestPaidEur",
    "feesPaidEur", "effectiveDate", "bankReference", "notes", "idempotencyKey",
  ]);
  if (Object.keys(payload).some((field) => !allowedFields.has(field))) {
    throw new CreditLineLedgerError("El payload contiene campos no admitidos.", "INVALID_AMOUNT");
  }
  if (!isUuid(creditLineId) || !isUuid(payload.repaymentGroupId) || !isUuid(payload.cashAccountId)) {
    throw new CreditLineLedgerError("Los identificadores no son UUID validos.", "INVALID_AMOUNT");
  }
  if (!isRealIsoDate(payload.effectiveDate)) {
    throw new CreditLineLedgerError("effectiveDate no es una fecha valida.", "INVALID_DATE");
  }
  const principalPaidEur = money(payload.principalPaidEur, "principalPaidEur");
  const interestPaidEur = money(payload.interestPaidEur, "interestPaidEur");
  const feesPaidEur = money(payload.feesPaidEur, "feesPaidEur");
  if (principalPaidEur + interestPaidEur + feesPaidEur <= 0) {
    throw new CreditLineLedgerError("Al menos un componente debe ser mayor que cero.", "INVALID_AMOUNT");
  }
  return {
    creditLineId: creditLineId.trim(),
    repaymentGroupId: payload.repaymentGroupId.trim(),
    cashAccountId: payload.cashAccountId.trim(),
    principalPaidEur,
    interestPaidEur,
    feesPaidEur,
    effectiveDate: payload.effectiveDate,
    bankReference: optionalText(payload.bankReference, "bankReference"),
    notes: optionalText(payload.notes, "notes"),
    idempotencyKey: requiredText(payload.idempotencyKey, "idempotencyKey"),
  };
}
