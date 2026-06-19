import Link from "next/link";
import { ExternalLink, Package } from "lucide-react";

import type { OrderLinkedContainer } from "@/modules/orders/types/orderList.types";
import { ESTADOS_LOGISTICOS_OPCIONES } from "@/modules/containers/constants/estadoContenedor";

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

function resolveEstadoLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return ESTADOS_LOGISTICOS_OPCIONES.find((option) => option.value === value)?.label ?? value;
}

export function buildLogisticaContainerHref(
  locale: string,
  contenedorId: string,
): string {
  return `/${locale}/logistica?containerId=${encodeURIComponent(contenedorId)}`;
}

export type OrderContainerBadgeProps = {
  contenedor: OrderLinkedContainer;
  compact?: boolean;
};

export function OrderContainerBadge({ contenedor, compact = false }: OrderContainerBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md bg-blue-50 text-blue-700 ring-1 ring-blue-100 font-medium ${
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"
      }`}
    >
      <Package className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      Contenedor {contenedor.identificador_embarque}
    </span>
  );
}

export type OrderContainerSummaryProps = {
  contenedor: OrderLinkedContainer;
  locale: string;
  compact?: boolean;
};

export function OrderContainerSummary({
  contenedor,
  locale,
  compact = false,
}: OrderContainerSummaryProps) {
  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      <OrderContainerBadge contenedor={contenedor} compact={compact} />
      <div className={`text-slate-500 ${compact ? "text-[10px] leading-snug" : "text-[11px]"}`}>
        <div>ETA contenedor: {fmtDate(contenedor.fecha_eta_estimada)}</div>
        <div>Estado: {resolveEstadoLabel(contenedor.estado_logistico)}</div>
        {contenedor.puerto_llegada ? <div>Llegada: {contenedor.puerto_llegada}</div> : null}
      </div>
      <Link
        href={buildLogisticaContainerHref(locale, contenedor.contenedor_id)}
        className={`inline-flex items-center gap-1 font-medium text-blue-600 hover:text-blue-700 hover:underline ${
          compact ? "text-[10px]" : "text-[11px]"
        }`}
      >
        Ver contenedor
        <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}

export type OrderContainerActionsProps = {
  contenedor: OrderLinkedContainer | null;
  locale: string;
  mobile?: boolean;
  onCreateContainer: () => void;
};

export function OrderContainerActions({
  contenedor,
  locale,
  mobile = false,
  onCreateContainer,
}: OrderContainerActionsProps) {
  const iconBtn = mobile
    ? "inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg transition"
    : "inline-flex items-center justify-center w-7 h-7 rounded-md transition";

  if (contenedor) {
    return (
      <Link
        href={buildLogisticaContainerHref(locale, contenedor.contenedor_id)}
        title={`Ver contenedor ${contenedor.identificador_embarque}`}
        aria-label="Ver contenedor"
        className={`${iconBtn} bg-blue-50 text-blue-600 hover:bg-blue-100`}
      >
        <Package className="h-3.5 w-3.5" />
        {mobile ? <span className="sr-only">Ver contenedor</span> : null}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onCreateContainer}
      title="Crear contenedor desde esta orden"
      aria-label="Crear contenedor"
      className={`${iconBtn} bg-blue-50 text-blue-600 hover:bg-blue-100`}
    >
      <Package className="h-3.5 w-3.5" />
      {mobile ? <span className="sr-only">Crear contenedor</span> : null}
    </button>
  );
}
