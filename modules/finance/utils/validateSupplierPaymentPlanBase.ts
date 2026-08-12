export type SupplierPaymentPlanBaseInput = {
  orderId: string;
  originalCurrency: string;
  baseOriginal: number;
  depositPercent: number;
  plannedFxForeignPerEur?: number | null;
};

export function validateSupplierPaymentPlanBase(
  input: SupplierPaymentPlanBaseInput,
): void {
  if (!Number.isFinite(input.baseOriginal) || input.baseOriginal <= 0) {
    throw new Error(
      `No se pueden sincronizar los pagos de la orden ${input.orderId}: el importe comercial original en ${input.originalCurrency} no es válido.`,
    );
  }
  if (
    !Number.isFinite(input.depositPercent) ||
    input.depositPercent < 0 ||
    input.depositPercent > 100
  ) {
    throw new Error(
      `No se pueden sincronizar los pagos de la orden ${input.orderId}: el depósito en ${input.originalCurrency} debe estar entre 0 y 100.`,
    );
  }
}

export type SupplierPaymentPlanAmounts = {
  deposit: { amountOriginal: number; amountEur: number; plannedFxForeignPerEur: number } | null;
  balance: { amountOriginal: number; amountEur: number; plannedFxForeignPerEur: number } | null;
};

export function buildSupplierPaymentPlanAmounts(
  input: SupplierPaymentPlanBaseInput,
): SupplierPaymentPlanAmounts {
  validateSupplierPaymentPlanBase(input);
  const balancePercent = 100 - input.depositPercent;
  const currency=input.originalCurrency.trim().toUpperCase();
  const fx=currency === "EUR" ? 1 : Number(input.plannedFxForeignPerEur);
  if (!Number.isFinite(fx) || fx <= 0) throw new Error("MISSING_PLANNED_FX_FOREIGN_PER_EUR");
  const baseEur=input.baseOriginal/fx;

  return {
    deposit:
      input.depositPercent > 0
        ? {
            amountOriginal: input.baseOriginal * (input.depositPercent / 100),
            amountEur: baseEur * (input.depositPercent / 100),
            plannedFxForeignPerEur: fx,
          }
        : null,
    balance:
      balancePercent > 0
        ? {
            amountOriginal: input.baseOriginal * (balancePercent / 100),
            amountEur: baseEur * (balancePercent / 100),
            plannedFxForeignPerEur: fx,
          }
        : null,
  };
}
