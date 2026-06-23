import { useEffect, useMemo, useState } from "react";
import { fetchOrderLeadTimeSuggestions } from "@/modules/orders/api/orderClient";
import type { OrderLeadTimeSuggestion } from "@/modules/orders/types/orderLeadTimeSuggestion.types";

type LeadTimeSuggestionItem = {
  producto_id: string;
  proveedor_id: string | null;
};

export type OrderLeadTimeSuggestionMax = {
  lead_time_produccion: number | null;
  lead_time_transito: number | null;
};

function maxNullable(values: Array<number | null | undefined>): number | null {
  const numbers = values.filter((value): value is number => value != null);
  if (numbers.length === 0) return null;
  return Math.max(...numbers);
}

export function useOrderLeadTimeSuggestions(
  items: LeadTimeSuggestionItem[],
): OrderLeadTimeSuggestionMax {
  const [suggestions, setSuggestions] = useState<OrderLeadTimeSuggestion[]>([]);
  const itemsKey = useMemo(
    () =>
      items
        .map((item) => `${item.producto_id}:${item.proveedor_id ?? ""}`)
        .sort()
        .join("|"),
    [items],
  );

  useEffect(() => {
    let cancelled = false;
    const requestItems = items
      .filter((item) => item.producto_id)
      .map((item) => ({
        producto_id: item.producto_id,
        proveedor_id: item.proveedor_id,
      }));

    if (requestItems.length === 0) {
      setSuggestions([]);
      return;
    }

    fetchOrderLeadTimeSuggestions(requestItems)
      .then((rows) => {
        if (!cancelled) setSuggestions(rows);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [itemsKey, items]);

  return {
    lead_time_produccion: maxNullable(
      suggestions.map((suggestion) => suggestion.lead_time_produccion),
    ),
    lead_time_transito: maxNullable(
      suggestions.map((suggestion) => suggestion.lead_time_transito),
    ),
  };
}
