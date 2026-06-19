import { ChevronDown, ChevronRight, Clock } from "lucide-react";

import {
  ArrivalEventCard,
  destinationBadgeClassName,
  groupOrdersByDestination,
  sortOrdersByDate,
} from "@/modules/planner/components/ArrivalEventCard";
import type { ArrivalMonth } from "@/modules/planner/types/arrivals.types";

function formatDay(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(8, 10);
}

export function PlannerArrivalMonthDesktopCard({
  month,
  locale,
}: {
  month: ArrivalMonth;
  locale: string;
}) {
  const datedOrders = sortOrdersByDate([...month.confirmedEtaOrders, ...month.estimatedOrders]);
  const byDestination = groupOrdersByDestination(datedOrders);

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-slate-900">{month.label}</h2>
            <p className="text-xs text-slate-500">{month.month}</p>
          </div>
          <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-full bg-indigo-600 px-2 text-sm font-bold text-white">
            {month.total}
          </span>
        </div>
        {byDestination.size > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Array.from(byDestination.entries()).map(([badge, orders]) => (
              <span
                key={badge}
                className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200"
              >
                <span className={`rounded px-1 py-0.5 font-bold ${destinationBadgeClassName(badge)}`}>
                  {badge}
                </span>
                {orders.length}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex-1 space-y-4 p-3">
        {datedOrders.length === 0 && month.pendingDateOrders.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">Sin llegadas en este mes</p>
        ) : null}

        {datedOrders.length > 0 ? (
          <div className="space-y-3">
            {datedOrders.map((order) => (
              <div key={order.orderId} className="min-w-0">
                <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                  <span className="text-base font-bold tabular-nums text-slate-700">
                    {formatDay(order.estimatedMonthDate)}
                  </span>
                  <span>{order.hasDefinedEta ? "día ETA" : "mes estimado"}</span>
                </div>
                <ArrivalEventCard order={order} locale={locale} />
              </div>
            ))}
          </div>
        ) : null}

        {month.pendingDateOrders.length > 0 ? (
          <div className="space-y-2 border-t border-dashed border-slate-200 pt-3">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-700">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              Pendientes de fecha
            </p>
            {month.pendingDateOrders.map((order) => (
              <ArrivalEventCard key={order.orderId} order={order} locale={locale} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function PlannerArrivalMonthMobileSection({
  month,
  locale,
  expanded,
  onToggle,
}: {
  month: ArrivalMonth;
  locale: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const datedOrders = sortOrdersByDate([...month.confirmedEtaOrders, ...month.estimatedOrders]);

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">{month.label}</p>
          <p className="text-xs text-slate-500">
            {month.total} llegada{month.total === 1 ? "" : "s"}
          </p>
        </div>
        {expanded ? (
          <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
        ) : (
          <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
        )}
      </button>

      {expanded ? (
        <div className="space-y-3 border-t border-slate-100 px-3 pb-3 pt-2">
          {datedOrders.map((order) => (
            <ArrivalEventCard key={order.orderId} order={order} locale={locale} compact />
          ))}
          {month.pendingDateOrders.length > 0 ? (
            <div className="space-y-2 border-t border-dashed border-slate-200 pt-2">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-700">
                Pendientes de fecha
              </p>
              {month.pendingDateOrders.map((order) => (
                <ArrivalEventCard key={order.orderId} order={order} locale={locale} compact />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
