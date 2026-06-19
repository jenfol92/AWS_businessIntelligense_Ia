/**
 * Coste unitario EUR congelado en orden_items a partir del tipo de cambio de la orden.
 */
export function computeOrderItemCostEur(
  unitMoneda: number | null | undefined,
  monedaCompra: string | null | undefined,
  tipoCambioMonedaEur: number | null | undefined,
): number | null {
  if (unitMoneda == null || !Number.isFinite(Number(unitMoneda))) {
    return null;
  }
  const unit = Number(unitMoneda);
  const moneda = (monedaCompra ?? "USD").trim().toUpperCase();
  if (moneda === "EUR") {
    return Number(unit.toFixed(4));
  }
  const tc = Number(tipoCambioMonedaEur);
  if (!Number.isFinite(tc) || tc <= 0) {
    return null;
  }
  return Number((unit * tc).toFixed(4));
}
