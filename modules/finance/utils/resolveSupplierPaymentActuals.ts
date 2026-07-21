export type SupplierPaymentActualInput = {
  amountOriginal: number;
  currencyOriginal: string;
  actualFxRate?: number | null;
  actualAmountEur?: number | null;
  toleranceEur?: number;
};

export type SupplierPaymentActualValues = {
  actualFxRate: number;
  actualAmountEur: number;
};

function positiveFinite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function roundEur(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolveSupplierPaymentActuals(
  input: SupplierPaymentActualInput,
): SupplierPaymentActualValues {
  if (!positiveFinite(input.amountOriginal)) {
    throw new Error("INVALID_ORIGINAL_AMOUNT");
  }

  const currency = input.currencyOriginal.trim().toUpperCase();
  if (!currency) throw new Error("INVALID_ORIGINAL_CURRENCY");

  if (
    input.actualFxRate != null &&
    !positiveFinite(input.actualFxRate)
  ) {
    throw new Error("INVALID_ACTUAL_FX_RATE");
  }
  if (
    input.actualAmountEur != null &&
    !positiveFinite(input.actualAmountEur)
  ) {
    throw new Error("INVALID_ACTUAL_AMOUNT_EUR");
  }

  if (currency === "EUR") {
    if (input.actualFxRate != null && input.actualFxRate !== 1) {
      throw new Error("INCONSISTENT_ACTUAL_VALUES");
    }
    const amount = roundEur(input.amountOriginal);
    if (
      input.actualAmountEur != null &&
      Math.abs(roundEur(input.actualAmountEur) - amount) >
        (input.toleranceEur ?? 0.01)
    ) {
      throw new Error("INCONSISTENT_ACTUAL_VALUES");
    }
    return { actualFxRate: 1, actualAmountEur: amount };
  }

  if (input.actualFxRate == null && input.actualAmountEur == null) {
    throw new Error("MISSING_ACTUAL_VALUE");
  }

  if (input.actualFxRate != null && input.actualAmountEur != null) {
    const expected = roundEur(input.amountOriginal * input.actualFxRate);
    const provided = roundEur(input.actualAmountEur);
    if (Math.abs(expected - provided) > (input.toleranceEur ?? 0.01)) {
      throw new Error("INCONSISTENT_ACTUAL_VALUES");
    }
    return {
      actualFxRate: input.actualFxRate,
      actualAmountEur: provided,
    };
  }

  if (input.actualFxRate != null) {
    return {
      actualFxRate: input.actualFxRate,
      actualAmountEur: roundEur(input.amountOriginal * input.actualFxRate),
    };
  }

  const actualAmountEur = roundEur(input.actualAmountEur as number);
  return {
    actualFxRate: actualAmountEur / input.amountOriginal,
    actualAmountEur,
  };
}
