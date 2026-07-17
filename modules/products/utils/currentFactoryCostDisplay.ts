import type {
  ProductCostCurrency,
  ProductFactoryCostByCurrency,
} from "../types";

export type CurrentFactoryCostDisplayInput = {
  costoFabricaMonto: number;
  costoFabricaMoneda: ProductCostCurrency;
  factoryCostsByCurrency: Partial<
    Record<ProductCostCurrency, ProductFactoryCostByCurrency>
  >;
};

export type CurrentFactoryCostDisplay = {
  monto: number | null;
  moneda: ProductCostCurrency;
  label: string;
};

function positiveNumberOrNull(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

export function resolveCurrentFactoryCostDisplay(
  input: CurrentFactoryCostDisplayInput,
): CurrentFactoryCostDisplay {
  const selectedCurrency = input.costoFabricaMoneda;
  const editedAmount = positiveNumberOrNull(input.costoFabricaMonto);
  const storedAmount = positiveNumberOrNull(
    input.factoryCostsByCurrency[selectedCurrency]?.monto,
  );
  const amount = editedAmount ?? storedAmount;

  return {
    monto: amount,
    moneda: selectedCurrency,
    label:
      amount != null
        ? `${amount.toFixed(4).replace(/\.?0+$/, "")} ${selectedCurrency}`
        : "-",
  };
}
