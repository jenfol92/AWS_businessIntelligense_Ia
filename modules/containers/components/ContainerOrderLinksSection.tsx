"use client";

import { Loader2, Trash2 } from "lucide-react";

import type { ContainerGeneralFormValues } from "@/modules/containers/hooks/useContainerGeneralForm";
import { useContainerOrderLinks } from "@/modules/containers/hooks/useContainerOrderLinks";
import type { OrdenDetalle } from "@/modules/containers/types/containerUiTypes";
import {
  containerValuesHaveAnyInheritedField,
  orderSourceHasInheritableData,
  type OrderContainerSource,
} from "@/modules/containers/utils/mapOrderToContainerFields";

export type ContainerOrderLinksSectionProps = {
  contenedorId: string;
  linkedOrders: OrdenDetalle[];
  formValues?: ContainerGeneralFormValues;
  onApplyFromOrder?: (
    order: OrderContainerSource,
    mode: "empty_only" | "force",
  ) => void;
  onLinksChanged: () => void;
};

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

function toOrderSource(order: OrdenDetalle | OrderContainerSource): OrderContainerSource {
  return {
    etd: order.etd ?? null,
    eta: order.eta ?? null,
    fob_puerto: order.fob_puerto ?? null,
    destino: order.destino ?? null,
    agente_contacto: "agente_contacto" in order ? order.agente_contacto ?? null : null,
    lead_time_produccion: "lead_time_produccion" in order ? order.lead_time_produccion ?? null : null,
    lead_time_transito: "lead_time_transito" in order ? order.lead_time_transito ?? null : null,
  };
}

export function ContainerOrderLinksSection({
  contenedorId,
  linkedOrders,
  formValues,
  onApplyFromOrder,
  onLinksChanged,
}: ContainerOrderLinksSectionProps) {
  const links = useContainerOrderLinks(contenedorId, linkedOrders);

  const selectedOrder = links.selectableOrders.find((order) => order.id === links.selectedOrderId);
  const referenceOrder = selectedOrder ?? (linkedOrders[0] ? toOrderSource(linkedOrders[0]) : null);
  const showFillButton = Boolean(
    referenceOrder
    && orderSourceHasInheritableData(referenceOrder)
    && onApplyFromOrder
    && (
      links.selectedOrderId.length > 0
      || linkedOrders.length > 0
    )
    && (
      !formValues
      || containerValuesHaveAnyInheritedField(formValues)
      || links.selectedOrderId.length > 0
    ),
  );

  async function handleLink() {
    const ok = await links.linkOrder();
    if (ok) onLinksChanged();
  }

  async function handleUnlink(ordenId: string) {
    const ok = await links.unlinkOrder(ordenId);
    if (ok) onLinksChanged();
  }

  function handleSelectOrder(orderId: string) {
    links.setSelectedOrderId(orderId);
    const order = links.selectableOrders.find((row) => row.id === orderId);
    if (order && onApplyFromOrder) {
      onApplyFromOrder(order, "empty_only");
    }
  }

  function handleFillFromOrder() {
    if (!referenceOrder || !onApplyFromOrder) return;
    onApplyFromOrder(referenceOrder, "force");
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
        Órdenes vinculadas
      </p>

      {linkedOrders.length === 0 ? (
        <p className="text-xs text-slate-500">Sin orden vinculada.</p>
      ) : (
        <ul className="space-y-2">
          {linkedOrders.map((order) => (
            <li
              key={order.id}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-800 truncate">
                    {order.numero_pedido_agente || order.numero_orden}
                  </p>
                  <p className="text-[10px] text-slate-500 truncate">
                    {order.destino ?? "Sin destino"} · €{Number(order.coste_total_eur ?? 0).toLocaleString("es-ES")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleUnlink(order.id)}
                  disabled={links.unlinkingId === order.id}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {links.unlinkingId === order.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  Quitar
                </button>
              </div>
              <p className="text-[10px] text-slate-400">
                Referencia orden: ETD {fmtDate(order.etd)} · ETA {fmtDate(order.eta)} ·{" "}
                {order.fob_puerto ?? "—"} → {order.destino ?? "—"}
                {order.agente_contacto ? ` · ${order.agente_contacto}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 p-3 space-y-2">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
          Añadir orden confirmada
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            value={links.selectedOrderId}
            onChange={(e) => handleSelectOrder(e.target.value)}
            disabled={links.loadingOrders || links.linking}
            className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">
              {links.loadingOrders ? "Cargando órdenes…" : "Seleccionar orden confirmada"}
            </option>
            {links.selectableOrders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.numero_orden}
                {order.fob_puerto || order.destino
                  ? ` · ${order.fob_puerto ?? "—"} → ${order.destino ?? "—"}`
                  : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void handleLink()}
            disabled={!links.selectedOrderId || links.linking}
            className="inline-flex items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {links.linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Vincular
          </button>
        </div>

        {selectedOrder ? (
          <p className="text-[10px] text-slate-500">
            Orden seleccionada: ETD {fmtDate(selectedOrder.etd)} · ETA {fmtDate(selectedOrder.eta)} ·{" "}
            {selectedOrder.fob_puerto ?? "—"} → {selectedOrder.destino ?? "—"}
            {selectedOrder.agente_contacto ? ` · ${selectedOrder.agente_contacto}` : ""}
          </p>
        ) : null}

        {showFillButton ? (
          <button
            type="button"
            onClick={handleFillFromOrder}
            className="text-[11px] font-medium text-blue-600 hover:text-blue-700 hover:underline"
          >
            Rellenar con datos de la orden
          </button>
        ) : null}
      </div>

      {links.error ? (
        <p className="text-xs text-red-600">{links.error}</p>
      ) : null}
    </div>
  );
}
