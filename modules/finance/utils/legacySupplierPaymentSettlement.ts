export type LegacySupplierPaymentSettlement = {
  id: string;
  paidAt: string | null;
  date: string | null;
  originalAmount: number;
  amountEur: number;
};

function positiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveLegacySupplierPaymentSettlement(
  payment: Record<string, unknown>,
  activeAllocationCount: number,
): LegacySupplierPaymentSettlement | null {
  if (activeAllocationCount > 0) return null;

  const paidAt = nonEmptyString(payment["paid_at"]);
  const isPaid = nonEmptyString(payment["status"]) === "pagado";
  const actualOriginal = positiveNumber(payment["actual_amount_original"]);
  const originalAmount =
    actualOriginal > 0 ? actualOriginal : paidAt || isPaid ? positiveNumber(payment["amount_original"]) : 0;
  const amountEur = positiveNumber(payment["actual_amount_eur"]);

  if (!(originalAmount > 0 || amountEur > 0 || paidAt || isPaid)) return null;

  return {
    id: `legacy-settlement:${String(payment["id"])}`,
    paidAt,
    date: paidAt ? paidAt.slice(0, 10) : null,
    originalAmount,
    amountEur,
  };
}
