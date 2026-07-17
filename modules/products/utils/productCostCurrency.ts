export const VALID_PRODUCT_COST_CURRENCIES = ["USD", "EUR", "GBP", "CNY"] as const;

export type ValidProductCostCurrency =
  (typeof VALID_PRODUCT_COST_CURRENCIES)[number];

export function assertProductCostCurrency(
  value: unknown,
): ValidProductCostCurrency {
  const currency = String(value ?? "").trim().toUpperCase();
  if (
    currency === "USD" ||
    currency === "EUR" ||
    currency === "GBP" ||
    currency === "CNY"
  ) {
    return currency;
  }

  throw new Error(
    `Moneda de coste no valida: ${currency || "(vacia)"}. Valores permitidos: USD, EUR, GBP, CNY.`,
  );
}
