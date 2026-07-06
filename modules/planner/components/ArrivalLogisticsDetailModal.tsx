"use client";

import Link from "next/link";

import { arrivalLogisticsLabel } from "@/modules/planner/utils/arrivalLogisticsLabel";
import type { ArrivalOrder } from "@/modules/planner/types/arrivals.types";

function valueOrDash(value: string | null | undefined): string {
  return value?.trim() || "—";
}

function formatDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "—";
  const date = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  return date.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function tipoEnvioLabel(tipoEnvio: string | null | undefined): string {
  return tipoEnvio === "amazon_agl" ? "Amazon AGL" : "Envío propio";
}

export type ArrivalLogisticsDetailModalProps = {
  order: ArrivalOrder;
  locale: string;
  onClose: () => void;
  onOpenOrder: (orderId: string) => void;
};

export function ArrivalLogisticsDetailModal({
  order,
  locale,
  onClose,
  onOpenOrder,
}: ArrivalLogisticsDetailModalProps) {
  const amazon = order.amazonInbound;
  const logisticsLabel = arrivalLogisticsLabel(order);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {order.logisticsKind === "amazon_inbound"
                ? "Envío Amazon inbound"
                : order.logisticsKind === "contenedor_propio"
                  ? "Contenedor propio"
                  : "Detalle logístico"}
            </h2>
            <p className="mt-1 font-mono text-xs text-slate-500">
              {order.numeroPedidoAgente || order.numeroOrden || order.orderId}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500"
          >
            Cerrar
          </button>
        </div>

        {order.logisticsKind === "amazon_inbound" && amazon ? (
          <div className="mt-4 rounded-xl border border-orange-100 bg-orange-50/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">
              Logística Amazon inbound
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              {[
                { label: "Shipment ID", value: amazon.shipment_id },
                { label: "Shipment name", value: valueOrDash(amazon.shipment_name) },
                { label: "Ruta + transporte", value: logisticsLabel },
                { label: "Estado Amazon", value: valueOrDash(amazon.estado_amazon) },
                { label: "Centro destino", value: valueOrDash(amazon.destination_center) },
                {
                  label: "País destino",
                  value: valueOrDash(amazon.destination_country),
                },
                {
                  label: "ETA Amazon",
                  value: amazon.eta_estimada
                    ? formatDate(amazon.eta_estimada)
                    : "No hay ETA Amazon registrada",
                },
                { label: "Fecha salida", value: formatDate(amazon.fecha_salida) },
                {
                  label: "Fecha entrega real",
                  value: formatDate(amazon.fecha_entrega_real),
                },
              ].map((item) => (
                <div key={item.label}>
                  <p className="text-[10px] font-medium uppercase text-orange-500">{item.label}</p>
                  <p className="mt-0.5 text-slate-800">{item.value}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-orange-700/80">
              No se inventa ETA; se muestra ETA de orden si existe.
            </p>
          </div>
        ) : null}

        {order.logisticsKind === "contenedor_propio" ? (
          <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
              Contenedor propio
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              {[
                { label: "Identificador", value: valueOrDash(order.containerNumber) },
                { label: "Contenedor ID", value: valueOrDash(order.containerId) },
                { label: "Destino", value: valueOrDash(order.destination) },
                { label: "ETA", value: formatDate(order.etaVisible) },
              ].map((item) => (
                <div key={item.label}>
                  <p className="text-[10px] font-medium uppercase text-indigo-500">{item.label}</p>
                  <p className="mt-0.5 text-slate-800">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {order.logisticsKind === "none" ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Sin logística vinculada
            {order.tipoEnvio === "amazon_agl" ? (
              <p className="mt-2 text-xs text-slate-500">Amazon AGL pendiente vínculo</p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          {[
            { label: "Número orden", value: valueOrDash(order.numeroOrden) },
            { label: "Pedido agente", value: valueOrDash(order.numeroPedidoAgente) },
            { label: "Proveedor", value: valueOrDash(order.proveedor) },
            { label: "Tipo envío", value: tipoEnvioLabel(order.tipoEnvio) },
          ].map((item) => (
            <div key={item.label}>
              <p className="text-[10px] font-medium uppercase text-slate-400">{item.label}</p>
              <p className="mt-0.5 text-slate-800">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenOrder(order.orderId)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700"
          >
            Abrir pedido completo
          </button>
          {order.logisticsKind === "amazon_inbound" && amazon?.shipment_id ? (
            <Link
              href={`/${locale}/amazon/envios?shipmentId=${encodeURIComponent(amazon.shipment_id)}`}
              className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-medium text-orange-800"
            >
              Abrir Amazon Envíos
            </Link>
          ) : null}
          {order.logisticsKind === "contenedor_propio" && order.containerId ? (
            <Link
              href={`/${locale}/logistica?containerId=${encodeURIComponent(order.containerId)}`}
              className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-800"
            >
              Abrir logística
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
