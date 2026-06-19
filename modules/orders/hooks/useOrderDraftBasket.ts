"use client";

import { useCallback, useMemo, useState } from "react";
import type { PreloadedItem } from "@/modules/orders/components/OrderFormModal";
import {
  CONTAINER_CBM_LIMIT,
  type DraftBasketItem,
} from "@/modules/orders/types/draftBasket.types";

export type OrderDraftBasketState = {
  items: DraftBasketItem[];
  count: number;
  totalUnits: number;
  totalCbm: number;
  totalCapital: number;
  primaryPort: string | null;
  primaryAgent: string | null;
  warnings: string[];
  isSelected: (productId: string) => boolean;
  add: (item: DraftBasketItem) => void;
  remove: (productId: string) => void;
  toggle: (item: DraftBasketItem) => void;
  addMany: (items: DraftBasketItem[]) => void;
  clear: () => void;
  toPreloadedItems: () => PreloadedItem[];
};

function computeWarnings(items: DraftBasketItem[]): string[] {
  const warnings: string[] = [];
  const ports = new Set(
    items.map((i) => i.port_display ?? i.fob_puerto).filter(Boolean),
  );
  const suppliers = new Set(items.map((i) => i.proveedor_id).filter(Boolean));
  const agents = new Set(
    items.map((i) => i.agente_contacto ?? i.agente_id).filter(Boolean),
  );

  if (ports.size > 1) warnings.push("Productos de distintos puertos");
  if (suppliers.size > 1) warnings.push("Productos de distintos proveedores");
  if (agents.size > 1) warnings.push("Productos de distintos agentes");

  const cbm = items.reduce((s, i) => {
    const lineCbm =
      i.cbm_total ??
      (i.cbm_unitario ?? 0) * (i.unidades_sugeridas ?? 1);
    return s + lineCbm;
  }, 0);

  if (cbm > CONTAINER_CBM_LIMIT) {
    warnings.push("CBM supera 65 m³: se podrá dividir al revisar");
  }

  return warnings;
}

export function useOrderDraftBasket(): OrderDraftBasketState {
  const [items, setItems] = useState<DraftBasketItem[]>([]);

  const isSelected = useCallback(
    (productId: string) => items.some((i) => i.producto_id === productId),
    [items],
  );

  const add = useCallback((item: DraftBasketItem) => {
    setItems((prev) => {
      if (prev.some((i) => i.producto_id === item.producto_id)) return prev;
      return [...prev, item];
    });
  }, []);

  const remove = useCallback((productId: string) => {
    setItems((prev) => prev.filter((i) => i.producto_id !== productId));
  }, []);

  const toggle = useCallback((item: DraftBasketItem) => {
    setItems((prev) => {
      const exists = prev.some((i) => i.producto_id === item.producto_id);
      if (exists) return prev.filter((i) => i.producto_id !== item.producto_id);
      return [...prev, item];
    });
  }, []);

  const addMany = useCallback((newItems: DraftBasketItem[]) => {
    setItems((prev) => {
      const map = new Map(prev.map((i) => [i.producto_id, i]));
      for (const item of newItems) {
        map.set(item.producto_id, item);
      }
      return Array.from(map.values());
    });
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const totals = useMemo(() => {
    let totalUnits = 0;
    let totalCbm = 0;
    let totalCapital = 0;
    for (const i of items) {
      const u = i.unidades_sugeridas ?? 1;
      totalUnits += u;
      totalCbm +=
        i.cbm_total ?? (i.cbm_unitario ?? 0) * u;
      totalCapital += i.capital_total ?? 0;
    }
    return { totalUnits, totalCbm, totalCapital };
  }, [items]);

  const primaryPort = useMemo(() => {
    const ports = items.map((i) => i.port_display ?? i.fob_puerto).filter(Boolean);
    if (ports.length === 0) return null;
    const unique = new Set(ports);
    return unique.size === 1 ? ports[0]! : null;
  }, [items]);

  const primaryAgent = useMemo(() => {
    const agents = items
      .map((i) => i.agente_contacto)
      .filter((a): a is string => Boolean(a));
    if (agents.length === 0) return null;
    const unique = new Set(agents);
    return unique.size === 1 ? agents[0]! : null;
  }, [items]);

  const warnings = useMemo(() => computeWarnings(items), [items]);

  const toPreloadedItems = useCallback((): PreloadedItem[] => {
    return items.map(({ capital_total, cbm_total, port_display, agent_display, supplier_display, ...rest }) => rest);
  }, [items]);

  return {
    items,
    count: items.length,
    totalUnits: totals.totalUnits,
    totalCbm: totals.totalCbm,
    totalCapital: totals.totalCapital,
    primaryPort,
    primaryAgent,
    warnings,
    isSelected,
    add,
    remove,
    toggle,
    addMany,
    clear,
    toPreloadedItems,
  };
}
