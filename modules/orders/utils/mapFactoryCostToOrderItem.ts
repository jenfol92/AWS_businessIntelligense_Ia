import type { LatestFactoryCost } from "@/modules/orders/repositories/orderProductCostsRepository";
import { computeOrderItemCostEur } from "@/modules/orders/utils/computeOrderItemCostEur";
import { isPositiveCostMonto } from "@/modules/products/utils/resolveEffectiveBaseCost";

export type MappedOrderItemCost = {
  coste_unitario_moneda: number | null;
  coste_unitario_eur: number | null;
  coste_unitario_usd: number | null;
  moneda_linea: string | null;
  missingHistoricalCost: boolean;
};

export function mapFactoryCostToOrderItem(params: {
  factoryCost: LatestFactoryCost | null | undefined;
  orderMoneda: string;
  orderTipoCambio: number | null;
  userCosteMoneda?: number | null;
  userCosteEur?: number | null;
  userCosteUsd?: number | null;
}): MappedOrderItemCost {
  const orderMoneda = (params.orderMoneda ?? "USD").trim().toUpperCase();

  if (isPositiveCostMonto(params.userCosteMoneda)) {
    const monto = Number(params.userCosteMoneda);
    const eur =
      params.userCosteEur != null && isPositiveCostMonto(params.userCosteEur)
        ? Number(params.userCosteEur)
        : computeOrderItemCostEur(monto, orderMoneda, params.orderTipoCambio);
    return {
      coste_unitario_moneda: monto,
      coste_unitario_eur: eur,
      coste_unitario_usd: orderMoneda === "USD" ? monto : params.userCosteUsd ?? null,
      moneda_linea: orderMoneda,
      missingHistoricalCost: false,
    };
  }

  const factory = params.factoryCost;
  if (!factory?.costo_fabrica_monto || factory.costo_fabrica_monto <= 0) {
    return {
      coste_unitario_moneda: null,
      coste_unitario_eur: null,
      coste_unitario_usd: null,
      moneda_linea: null,
      missingHistoricalCost: true,
    };
  }

  const monedaLinea = (factory.costo_fabrica_moneda ?? orderMoneda).toUpperCase();
  const monto = factory.costo_fabrica_monto;

  let eur: number | null = null;
  if (factory.costo_fabrica_eur != null && factory.costo_fabrica_eur > 0) {
    eur = Number(factory.costo_fabrica_eur.toFixed(4));
  } else if (monedaLinea === "EUR") {
    eur = Number(monto.toFixed(4));
  } else {
    const tipoCambio = factory.tipo_cambio_aplicado ?? params.orderTipoCambio;
    eur = computeOrderItemCostEur(monto, monedaLinea, tipoCambio);
  }

  return {
    coste_unitario_moneda: monto,
    coste_unitario_eur: eur,
    coste_unitario_usd: monedaLinea === "USD" ? monto : null,
    moneda_linea: monedaLinea,
    missingHistoricalCost: false,
  };
}
