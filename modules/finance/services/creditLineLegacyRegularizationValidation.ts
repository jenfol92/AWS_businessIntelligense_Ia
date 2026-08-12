import { CreditLineLedgerError } from "@/modules/finance/types/creditLineLedger.types";
import type { CreateCreditLineLegacyRegularizationInput } from "@/modules/finance/types/creditLineLedger.types";
import { isRealIsoDate, isUuid } from "@/modules/finance/utils/financeInputValidation";

export const MAX_DISPOSITIONS = 500;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
export const MAX_REFERENCE_LENGTH = 250;
export const MAX_NOTES_LENGTH = 2000;
export const MAX_MONEY_EXCLUSIVE = 1_000_000_000_000;

export type CreditLineLegacyRegularizationPayload = {
  dispositions?: unknown;
  idempotencyKey?: unknown;
};

function money(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= MAX_MONEY_EXCLUSIVE) {
    throw new CreditLineLedgerError("El principal debe ser un numero positivo.", "INVALID_AMOUNT");
  }
  const cents = value * 100;
  if (Math.abs(cents - Math.round(cents)) > Number.EPSILON * Math.max(1, Math.abs(cents)) * 4) {
    throw new CreditLineLedgerError("El principal admite como maximo dos decimales.", "INVALID_AMOUNT");
  }
  return Math.round(cents) / 100;
}

function optionalMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= MAX_MONEY_EXCLUSIVE) {
    throw new CreditLineLedgerError("Intereses y comisiones deben ser importes no negativos.", "INVALID_AMOUNT");
  }
  const cents = value * 100;
  if (Math.abs(cents - Math.round(cents)) > Number.EPSILON * Math.max(1, Math.abs(cents)) * 4) {
    throw new CreditLineLedgerError("Los importes admiten como maximo dos decimales.", "INVALID_AMOUNT");
  }
  return Math.round(cents) / 100;
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new CreditLineLedgerError("Texto no valido.", "INVALID_AMOUNT");
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new CreditLineLedgerError("Texto demasiado largo.", "INVALID_AMOUNT");
  return normalized || null;
}

export function normalizeCreditLineLegacyRegularizationInput(
  creditLineId: unknown,
  payload: CreditLineLegacyRegularizationPayload,
): CreateCreditLineLegacyRegularizationInput {
  if (!isUuid(creditLineId)) throw new CreditLineLedgerError("Linea no valida.", "INVALID_AMOUNT");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new CreditLineLedgerError("Payload no valido.", "INVALID_AMOUNT");
  }
  if (Object.keys(payload).some((key) => !["dispositions", "idempotencyKey"].includes(key))) {
    throw new CreditLineLedgerError("El payload contiene campos no admitidos.", "INVALID_AMOUNT");
  }
  if (!Array.isArray(payload.dispositions) || payload.dispositions.length === 0 || payload.dispositions.length > MAX_DISPOSITIONS) {
    throw new CreditLineLedgerError("Debe existir al menos una disposicion.", "INVALID_AMOUNT");
  }
  if (typeof payload.idempotencyKey !== "string" || !payload.idempotencyKey.trim() || payload.idempotencyKey.trim().length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new CreditLineLedgerError("La clave de idempotencia es obligatoria.", "INVALID_AMOUNT");
  }
  const dispositions = payload.dispositions.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new CreditLineLedgerError("Disposicion no valida.", "INVALID_AMOUNT");
    }
    const item = raw as Record<string, unknown>;
    const allowed = ["principalEur", "dispositionDate", "contractualDueDate", "expectedInterestEur", "expectedFeesEur", "reference", "notes"];
    if (Object.keys(item).some((key) => !allowed.includes(key))) {
      throw new CreditLineLedgerError("La disposicion contiene campos no admitidos.", "INVALID_AMOUNT");
    }
    const dispositionDate = item.dispositionDate == null || item.dispositionDate === "" ? null : String(item.dispositionDate);
    if ((dispositionDate !== null && !isRealIsoDate(dispositionDate)) || !isRealIsoDate(item.contractualDueDate)) {
      throw new CreditLineLedgerError("Las fechas de la disposicion no son validas.", "INVALID_DATE");
    }
    if (dispositionDate !== null && item.contractualDueDate < dispositionDate) {
      throw new CreditLineLedgerError("El vencimiento no puede preceder a la disposicion.", "INVALID_DATE");
    }
    const today = new Date().toISOString().slice(0, 10);
    if (dispositionDate !== null && dispositionDate > today) {
      throw new CreditLineLedgerError("La fecha de disposicion no puede ser futura.", "INVALID_DATE");
    }
    return {
      principalEur: money(item.principalEur),
      dispositionDate,
      contractualDueDate: item.contractualDueDate,
      expectedInterestEur: optionalMoney(item.expectedInterestEur),
      expectedFeesEur: optionalMoney(item.expectedFeesEur),
      reference: optionalText(item.reference, MAX_REFERENCE_LENGTH),
      notes: optionalText(item.notes, MAX_NOTES_LENGTH),
    };
  });
  return { creditLineId: creditLineId.trim(), dispositions, idempotencyKey: payload.idempotencyKey.trim() };
}
