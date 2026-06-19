export type ProductBaseCostSource = "own" | "parent" | "none";

export type ProductBaseCost = {
  monto: number | null;
  moneda: string | null;
  source: ProductBaseCostSource;
  parentProductId?: string | null;
};

export function isPositiveCostMonto(monto: unknown): boolean {
  const n = Number(monto);
  return Number.isFinite(n) && n > 0;
}

/**
 * Coste base efectivo: propio > padre > pendiente.
 * No usa heredar_precio.
 */
export function resolveEffectiveBaseCost(
  ownMonto: number | null | undefined,
  ownMoneda: string | null | undefined,
  parentCost: ProductBaseCost | null | undefined,
  parentId: string | null | undefined,
): ProductBaseCost {
  if (isPositiveCostMonto(ownMonto)) {
    return {
      monto: Number(ownMonto),
      moneda: ownMoneda ? String(ownMoneda).toUpperCase() : null,
      source: "own",
      parentProductId: parentId ?? null,
    };
  }

  if (parentCost && isPositiveCostMonto(parentCost.monto)) {
    return {
      monto: parentCost.monto,
      moneda: parentCost.moneda,
      source: "parent",
      parentProductId: parentId ?? parentCost.parentProductId ?? null,
    };
  }

  return {
    monto: null,
    moneda: null,
    source: "none",
    parentProductId: parentId ?? null,
  };
}
