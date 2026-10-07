/**
 * Modulo   : orders
 * Archivo  : modules/orders/services/marketFxRate.ts
 * Que hace : Traduce la tabla diaria del BCE a la convención de la orden
 *            (planned_fx_foreign_per_eur: 1 EUR = X moneda_compra).
 * No debe  : Llamar a red ni persistir; es una función pura.
 */

import type { EcbFxTable } from "../../finance/services/ecbFxService.ts";

export const SUPPORTED_ORDER_CURRENCIES = ["USD", "EUR", "GBP", "CNY"] as const;

export type MarketFxRate = {
  currency: string;
  /** 1 EUR = foreignPerEur unidades de `currency`. */
  foreignPerEur: number;
  referenceDate: string;
  source: "ECB";
};

export function normalizeOrderCurrency(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return (SUPPORTED_ORDER_CURRENCIES as readonly string[]).includes(code) ? code : null;
}

export function marketFxFromEcbTable(table: EcbFxTable, currency: string): MarketFxRate | null {
  const rate = table.rates[currency];
  if (!rate || !(rate.eurPerForeignUnit > 0)) return null;
  // El BCE publica X moneda por EUR; el servicio lo guarda invertido. Revertimos sin
  // arrastrar ruido de coma flotante más allá de la precisión de la columna (8 dec).
  const foreignPerEur = Number((1 / rate.eurPerForeignUnit).toFixed(6));
  return { currency, foreignPerEur, referenceDate: rate.referenceDate, source: "ECB" };
}
