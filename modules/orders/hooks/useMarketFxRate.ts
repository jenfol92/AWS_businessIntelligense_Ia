"use client";

import { useEffect, useState } from "react";

export type MarketFxRateState = {
  /** Moneda a la que corresponde este estado (evita aplicar un tipo obsoleto). */
  currency: string | null;
  /** 1 EUR = foreignPerEur unidades de la moneda. null si no hay dato. */
  foreignPerEur: number | null;
  referenceDate: string | null;
  loading: boolean;
  error: string | null;
};

const EMPTY: MarketFxRateState = { currency: null, foreignPerEur: null, referenceDate: null, loading: false, error: null };

/** Tipo de referencia del BCE para la moneda de compra (solo lectura, sin persistir). */
export function useMarketFxRate(currency: string | null | undefined): MarketFxRateState {
  const [state, setState] = useState<MarketFxRateState>(EMPTY);

  useEffect(() => {
    const code = currency?.trim().toUpperCase() || null;
    const base = { ...EMPTY, currency: code };
    if (!code) { setState(EMPTY); return; }
    if (code === "EUR") { setState({ ...base, foreignPerEur: 1 }); return; }

    const controller = new AbortController();
    setState({ ...base, loading: true });
    fetch(`/api/orders/fx-rate?currency=${encodeURIComponent(code)}`, { cache: "no-store", signal: controller.signal })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setState({ ...base, foreignPerEur: Number(j.rate.foreignPerEur), referenceDate: j.rate.referenceDate ?? null });
        else setState({ ...base, error: j.error ?? "Tipo de cambio no disponible" });
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") setState({ ...base, error: "Tipo de cambio no disponible" });
      });
    return () => controller.abort();
  }, [currency]);

  return state;
}
