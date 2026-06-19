/** Monedas admitidas para coste de fábrica (`producto_costos.costo_fabrica_moneda`). */
export const PRODUCT_COST_CURRENCIES = ["USD", "EUR", "GBP", "CNY"] as const;

export type ProductCostCurrency = (typeof PRODUCT_COST_CURRENCIES)[number];

/** Tipo de cambio por defecto: 1 unidad de moneda → EUR. */
export function defaultExchangeRateToEur(moneda: ProductCostCurrency): number {
  if (moneda === "EUR") return 1;
  return 0;
}

/** Calcula coste en EUR a partir de monto y tipo de cambio. */
export function computeCostoFabricaEur(
  monto: number,
  moneda: ProductCostCurrency,
  tipoCambio: number,
): number {
  if (!Number.isFinite(monto) || monto <= 0) return 0;
  if (moneda === "EUR") return monto;
  const tc = Number.isFinite(tipoCambio) && tipoCambio > 0 ? tipoCambio : 0;
  return tc > 0 ? monto * tc : 0;
}
