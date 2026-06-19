"use client";

import { useState } from "react";
import { ShoppingCart, Trash2, X } from "lucide-react";
import OrderFormModal from "@/modules/orders/components/OrderFormModal";
import type { OrderDraftBasketState } from "@/modules/orders/hooks/useOrderDraftBasket";
import { CONTAINER_CBM_LIMIT } from "@/modules/orders/types/draftBasket.types";

function formatEur(n: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
}

function formatNum(n: number, d = 1): string {
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
}

export type OrderDraftBasketProps = {
  basket: OrderDraftBasketState;
  onDraftSaved?: () => void;
  /** Espacio inferior para no tapar contenido (px). */
  bottomSpacerClassName?: string;
};

/**
 * Barra fija “orden en preparación”. Solo abre OrderFormModal al pulsar Revisar orden.
 */
export default function OrderDraftBasket({
  basket,
  onDraftSaved,
  bottomSpacerClassName = "h-24",
}: OrderDraftBasketProps) {
  const [showForm, setShowForm] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  if (basket.count === 0) {
    return null;
  }

  function handleSaved() {
    basket.clear();
    setShowForm(false);
    setMobileOpen(false);
    onDraftSaved?.();
  }

  const bar = (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 w-full">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900">
          Orden en preparación · {basket.count} producto{basket.count !== 1 ? "s" : ""}
        </p>
        <p className="text-xs text-slate-600 mt-0.5">
          {formatNum(basket.totalUnits, 0)} uds · {formatNum(basket.totalCbm, 2)} m³
          {basket.totalCapital > 0 ? ` · ${formatEur(basket.totalCapital)}` : ""}
          {basket.primaryPort ? ` · ${basket.primaryPort}` : ""}
        </p>
        {basket.warnings.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {basket.warnings.map((w) => (
              <li
                key={w}
                className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-200"
              >
                {w}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => basket.clear()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
        >
          <Trash2 className="h-4 w-4" />
          <span className="hidden sm:inline">Vaciar</span>
        </button>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 shadow-sm"
        >
          <ShoppingCart className="h-4 w-4" />
          Revisar orden
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className={bottomSpacerClassName} aria-hidden />

      {/* Desktop: barra fija */}
      <div className="hidden sm:block fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
        <div className="max-w-[1600px] mx-auto px-4 py-3">{bar}</div>
      </div>

      {/* Móvil: chip + drawer */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40">
        {!mobileOpen ? (
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="w-full flex items-center justify-between px-4 py-3 bg-blue-600 text-white text-sm font-semibold shadow-lg"
          >
            <span>
              {basket.count} en preparación · {formatNum(basket.totalCbm, 1)} m³
            </span>
            <span>Revisar →</span>
          </button>
        ) : (
          <div className="bg-white border-t border-slate-200 shadow-2xl px-4 py-4 max-h-[70vh] overflow-y-auto">
            <div className="flex justify-end mb-2">
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="Cerrar">
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            {bar}
            <ul className="mt-3 space-y-1 text-xs text-slate-600">
              {basket.items.map((i) => (
                <li key={i.producto_id} className="flex justify-between gap-2">
                  <span className="truncate">{i.nombre}</span>
                  <button
                    type="button"
                    className="text-rose-600 shrink-0"
                    onClick={() => basket.remove(i.producto_id)}
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {showForm && (
        <OrderFormModal
          initialOrden={null}
          initialItems={basket.toPreloadedItems()}
          onClose={() => setShowForm(false)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
