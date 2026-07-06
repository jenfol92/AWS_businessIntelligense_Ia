/**
 * Módulo  : planner / llegadas
 * Archivo : app/[locale]/(dashboard)/planificador/llegadas/page.tsx
 * Qué hace: Vista responsive de llegadas previstas (calendario desktop, timeline móvil).
 * Responsabilidad: Orquestar datos de GET /api/planner/arrivals y filtros client-side.
 */

"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  CalendarClock,
  CalendarDays,
  Loader2,
  Package,
  RefreshCw,
  Search,
} from "lucide-react";
import { DEFAULT_LOCALE, isLocale } from "@/config/i18n";
import { ArrivalLogisticsDetailModal } from "@/modules/planner/components/ArrivalLogisticsDetailModal";
import {
  PlannerArrivalMonthDesktopCard,
  PlannerArrivalMonthMobileSection,
} from "@/modules/planner/components/PlannerArrivalMonthViews";
import OrderReadonlyModal from "@/modules/orders/components/OrderReadonlyModal";
import { usePlannerArrivals } from "@/modules/planner/hooks/usePlannerArrivals";
import { usePlannerDestinationOptions } from "@/modules/planner/hooks/usePlannerDestinationOptions";
import {
  ARRIVAL_LOGISTIC_STATUS_OPTIONS,
  type ArrivalOrder,
  type ArrivalOrderStatus,
} from "@/modules/planner/types/arrivals.types";
import { computeArrivalKpis } from "@/modules/planner/utils/computeArrivalKpis";
import {
  filterArrivalMonths,
  flattenAllArrivalOrders,
  type PlannerArrivalsFiltersState,
} from "@/modules/planner/utils/filterArrivalMonths";

type StatusFilter = "ALL" | ArrivalOrderStatus;

function resolveLocale(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function PlanificadorLlegadasPage() {
  const params = useParams();
  const locale = resolveLocale(params.locale);

  const [filters, setFilters] = useState<PlannerArrivalsFiltersState>(() => ({
    fromMonth: currentMonthKey(),
    monthsCount: 6,
    status: "ALL",
    destination: "ALL",
    container: "ALL",
    search: "",
  }));

  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => new Set([currentMonthKey()]));
  const [detailOrder, setDetailOrder] = useState<ArrivalOrder | null>(null);
  const [readonlyOrderId, setReadonlyOrderId] = useState<string | null>(null);

  const { options: destinationOptions } = usePlannerDestinationOptions();

  const { data, loading, error, reload } = usePlannerArrivals({
    fromMonth: filters.fromMonth,
    monthsCount: filters.monthsCount,
    destination: filters.destination,
    status: filters.status,
  });

  const filteredMonths = useMemo(() => {
    if (!data) return [];
    return filterArrivalMonths(data.months, filters);
  }, [data, filters]);

  const filteredOrders = useMemo(
    () => flattenAllArrivalOrders(filteredMonths),
    [filteredMonths],
  );

  const kpis = useMemo(
    () => computeArrivalKpis(filteredOrders, currentMonthKey()),
    [filteredOrders],
  );

  const hasActiveFilters =
    filters.status !== "ALL"
    || filters.destination !== "ALL"
    || filters.container !== "ALL"
    || filters.search.trim().length > 0;

  function toggleMonth(monthKey: string) {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-screen-2xl space-y-5 px-4 pb-10 pt-0 sm:px-6 lg:px-8">
      <header className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
              <CalendarClock className="h-6 w-6" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                  Llegadas previstas
                </h1>
                <span className="inline-flex rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 ring-1 ring-indigo-200">
                  Planificador
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                Calendario de órdenes, contenedores y ETA estimadas
              </p>
              <p className="mt-0.5 text-xs text-slate-400">Solo órdenes confirmadas</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            Actualizar
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
        {[
          { label: "Total llegadas", value: kpis.total, color: "text-slate-800" },
          { label: "ETA confirmada", value: kpis.confirmed, color: "text-emerald-600" },
          { label: "ETA estimada", value: kpis.estimated, color: "text-blue-600" },
          { label: "Sin ETA definida", value: kpis.undefinedEta, color: "text-amber-600" },
          { label: "Este mes", value: kpis.thisMonth, color: "text-indigo-600" },
          { label: "Retrasadas", value: kpis.delayed, color: "text-rose-600" },
          { label: "Entregadas", value: kpis.delivered, color: "text-emerald-700" },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-4"
          >
            <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {kpi.label}
            </p>
            <p className={`mt-1 text-xl font-bold tabular-nums sm:text-2xl ${kpi.color}`}>
              {loading && !data ? "—" : kpi.value}
            </p>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Filtros</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-500">Desde mes</span>
            <input
              type="month"
              value={filters.fromMonth}
              onChange={(e) => setFilters((f) => ({ ...f, fromMonth: e.target.value }))}
              className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-700"
            />
          </label>

          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-500">Meses visibles</span>
            <select
              value={filters.monthsCount}
              onChange={(e) =>
                setFilters((f) => ({ ...f, monthsCount: Number(e.target.value) }))
              }
              className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-700"
            >
              {[4, 6, 8, 12].map((n) => (
                <option key={n} value={n}>
                  {n} meses
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-500">Estado</span>
            <select
              value={filters.status}
              onChange={(e) =>
                setFilters((f) => ({ ...f, status: e.target.value as StatusFilter }))
              }
              className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-700"
            >
              {ARRIVAL_LOGISTIC_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-500">Destino / país</span>
            <select
              value={filters.destination}
              onChange={(e) => setFilters((f) => ({ ...f, destination: e.target.value }))}
              className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-700"
            >
              {destinationOptions.map((dest) => (
                <option key={dest.value} value={dest.value}>
                  {dest.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-500">Logistica</span>
            <select
              value={filters.container}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  container: e.target.value as PlannerArrivalsFiltersState["container"],
                }))
              }
              className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-700"
            >
              <option value="ALL">Todos</option>
              <option value="with">Con logistica vinculada</option>
              <option value="without">Sin logística vinculada</option>
            </select>
          </label>

          <label className="flex min-w-0 flex-col gap-1 sm:col-span-2 lg:col-span-1 xl:col-span-1">
            <span className="text-[11px] font-medium text-slate-500">Buscar</span>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <input
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                placeholder="Pedido agente, orden, contenedor…"
                className="min-h-10 w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm text-slate-700"
              />
            </div>
          </label>
        </div>
      </section>

      {error ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
          Cargando llegadas…
        </div>
      ) : null}

      {data && filteredMonths.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
          <Package className="mx-auto mb-3 h-10 w-10 text-slate-300" aria-hidden />
          <p className="text-sm font-medium text-slate-600">
            {hasActiveFilters
              ? "No hay llegadas con los filtros actuales."
              : "No hay llegadas previstas en el rango seleccionado."}
          </p>
        </div>
      ) : null}

      {data && filteredMonths.length > 0 ? (
        <>
          <div className="hidden lg:grid lg:grid-cols-2 lg:gap-4 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredMonths.map((month) => (
              <PlannerArrivalMonthDesktopCard
                key={month.month}
                month={month}
                locale={locale}
                onOpenDetail={setDetailOrder}
                onOpenOrder={(order) => setReadonlyOrderId(order.orderId)}
              />
            ))}
          </div>

          <div className="space-y-3 lg:hidden">
            {filteredMonths.map((month) => (
              <PlannerArrivalMonthMobileSection
                key={month.month}
                month={month}
                locale={locale}
                expanded={expandedMonths.has(month.month)}
                onToggle={() => toggleMonth(month.month)}
                onOpenDetail={setDetailOrder}
                onOpenOrder={(order) => setReadonlyOrderId(order.orderId)}
              />
            ))}
          </div>

          <p className="text-center text-xs text-slate-400">
            {filteredOrders.length} llegada{filteredOrders.length === 1 ? "" : "s"}
            {hasActiveFilters ? " (filtrado)" : ""}
            {" · "}
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="inline h-3.5 w-3.5" aria-hidden />
              {filters.fromMonth} → {filters.monthsCount} meses
            </span>
          </p>
        </>
      ) : null}
      {detailOrder ? (
        <ArrivalLogisticsDetailModal
          order={detailOrder}
          locale={locale}
          onClose={() => setDetailOrder(null)}
          onOpenOrder={(orderId) => {
            setDetailOrder(null);
            setReadonlyOrderId(orderId);
          }}
        />
      ) : null}
      {readonlyOrderId ? (
        <OrderReadonlyModal
          ordenId={readonlyOrderId}
          onClose={() => setReadonlyOrderId(null)}
        />
      ) : null}
    </div>
  );
}
