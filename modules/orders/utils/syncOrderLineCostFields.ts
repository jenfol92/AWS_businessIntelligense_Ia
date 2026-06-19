export function syncOrderLineCostFields(params: {
  monedaCompra: string;
  costeUnitarioMoneda?: number | null;
  costeUnitarioUsd?: number | null;
  costeUnitarioEur?: number | null;
}): {
  coste_unitario_moneda: number | null;
  coste_unitario_usd: number | null;
  coste_unitario_eur: number | null;
} {
  const moneda = (params.monedaCompra ?? "USD").trim().toUpperCase();
  const monedaVal = params.costeUnitarioMoneda ?? null;
  const usdVal = params.costeUnitarioUsd ?? null;

  if (moneda === "USD") {
    const monto = usdVal ?? monedaVal;
    return {
      coste_unitario_moneda: monto,
      coste_unitario_usd: monto,
      coste_unitario_eur: params.costeUnitarioEur ?? null,
    };
  }

  return {
    coste_unitario_moneda: monedaVal ?? usdVal,
    coste_unitario_usd: usdVal,
    coste_unitario_eur: params.costeUnitarioEur ?? null,
  };
}
