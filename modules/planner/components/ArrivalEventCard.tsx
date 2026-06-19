import Link from "next/link";
import { CheckCircle, Clock, Ship } from "lucide-react";

import { ArrivalProductSummary } from "@/modules/planner/components/ArrivalProductSummary";
import type { ArrivalDateSource, ArrivalOrder } from "@/modules/planner/types/arrivals.types";
import {
  getArrivalVisualCategory,
  type ArrivalVisualCategory,
} from "@/modules/planner/utils/arrivalVisualUtils";
import { ResponsiveDataCard } from "@/shared/ui/ResponsiveDataCard";

const SOURCE_LABEL: Record<ArrivalDateSource, string> = {
  container_eta: "ETA contenedor",
  order_eta: "ETA orden",
  estimated_from_etd: "Estimada por lead time",
  estimated_from_order_date: "Estimada por lead time",
  supplier_lead_time: "Estimada por lead time",
  unknown: "Pendiente",
};

const VISUAL_CATEGORY_STYLE: Record<
  ArrivalVisualCategory,
  { label: string; className: string }
> = {
  entregada: {
    label: "Entregado",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  atrasada: {
    label: "Atrasado",
    className: "bg-rose-50 text-rose-700 ring-rose-200",
  },
  confirmada: {
    label: "ETA confirmada",
    className: "bg-blue-50 text-blue-700 ring-blue-200",
  },
  estimada: {
    label: "ETA estimada",
    className: "bg-sky-50 text-sky-700 ring-sky-200",
  },
  sin_definir: {
    label: "ETA sin definir",
    className: "bg-amber-50 text-amber-700 ring-amber-200",
  },
};

const DESTINATION_BADGE: Record<string, string> = {
  FBA: "bg-orange-600 text-white",
  ES: "bg-emerald-600 text-white",
  EU: "bg-blue-600 text-white",
  UK: "bg-violet-600 text-white",
  IT: "bg-red-500 text-white",
  FR: "bg-sky-600 text-white",
  DE: "bg-slate-700 text-white",
  "Sin destino definido": "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
};

function formatEta(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return date.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function destinationBadgeClass(badge: string): string {
  return DESTINATION_BADGE[badge] ?? "bg-slate-800 text-white";
}

function buildDetailHref(locale: string, order: ArrivalOrder): string {
  if (order.containerId) {
    return `/${locale}/logistica?containerId=${encodeURIComponent(order.containerId)}`;
  }
  return `/${locale}/pedidos?orderId=${encodeURIComponent(order.orderId)}`;
}

function EtaBadge({ order }: { order: ArrivalOrder }) {
  const category = getArrivalVisualCategory(order);
  const style = VISUAL_CATEGORY_STYLE[category];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${style.className}`}
    >
      {category === "entregada" ? <CheckCircle className="h-3 w-3" aria-hidden /> : null}
      {category === "atrasada" ? <Clock className="h-3 w-3" aria-hidden /> : null}
      {style.label}
    </span>
  );
}

function ContainerBadge({ order }: { order: ArrivalOrder }) {
  if (order.containerId) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-indigo-200">
        <Ship className="h-3 w-3" aria-hidden />
        {order.containerNumber ?? "Contenedor"}
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">
      Sin contenedor
    </span>
  );
}

export type ArrivalEventCardProps = {
  order: ArrivalOrder;
  locale: string;
  compact?: boolean;
};

export function ArrivalEventCard({ order, locale, compact = false }: ArrivalEventCardProps) {
  const href = buildDetailHref(locale, order);
  const reference = order.numeroPedidoAgente || order.numeroOrden || order.displayCode;
  const dateLabel = order.hasDefinedEta
    ? formatEta(order.etaVisible)
    : order.estimatedMonthDate
      ? `Mes est. ${formatEta(order.estimatedMonthDate)}`
      : "ETA sin definir";

  if (compact) {
    return (
      <ResponsiveDataCard
        title={<span className="font-mono">{reference}</span>}
        subtitle={
          <ArrivalProductSummary lines={order.productLines} fallbackText={order.productSummary} />
        }
        badges={
          <div className="flex flex-wrap justify-end gap-1">
            <EtaBadge order={order} />
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${destinationBadgeClass(order.destinationBadge)}`}
            >
              {order.destinationBadge}
            </span>
          </div>
        }
        fields={[
          { label: "Fecha", value: dateLabel },
          { label: "Destino", value: order.destination ?? "—" },
          { label: "Origen fecha", value: SOURCE_LABEL[order.dateSource] },
          {
            label: "Contenedor",
            value: order.containerNumber ?? "—",
            className: "col-span-2",
          },
        ]}
        footer={<ContainerBadge order={order} />}
        actions={
          <Link
            href={href}
            className="inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Ver detalle
          </Link>
        }
      />
    );
  }

  return (
    <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm font-bold text-slate-900">{reference}</p>
          {order.numeroOrden && order.numeroPedidoAgente ? (
            <p className="truncate text-xs text-slate-500">{order.numeroOrden}</p>
          ) : null}
        </div>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${destinationBadgeClass(order.destinationBadge)}`}
        >
          {order.destinationBadge}
        </span>
      </div>

      <ArrivalProductSummary
        lines={order.productLines}
        fallbackText={order.productSummary}
        className="mt-1"
      />

      <div className="mt-2 flex flex-wrap gap-1.5">
        <EtaBadge order={order} />
        <ContainerBadge order={order} />
        <span className="inline-flex rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">
          {SOURCE_LABEL[order.dateSource]}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Fecha</p>
          <p className="text-sm font-medium text-slate-800">{dateLabel}</p>
        </div>
        <Link
          href={href}
          className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          Ver detalle
        </Link>
      </div>
    </article>
  );
}

export function sortOrdersByDate(orders: ArrivalOrder[]): ArrivalOrder[] {
  return [...orders].sort((a, b) =>
    (a.estimatedMonthDate ?? "9999-99-99").localeCompare(b.estimatedMonthDate ?? "9999-99-99"),
  );
}

export function groupOrdersByDestination(orders: ArrivalOrder[]): Map<string, ArrivalOrder[]> {
  const map = new Map<string, ArrivalOrder[]>();
  for (const order of orders) {
    const key = order.destinationBadge;
    const list = map.get(key) ?? [];
    list.push(order);
    map.set(key, list);
  }
  return map;
}

export function destinationBadgeClassName(badge: string): string {
  return destinationBadgeClass(badge);
}
