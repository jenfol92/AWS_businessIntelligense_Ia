"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock,
  CreditCard,
  Euro,
  Landmark,
  Package,
  TrendingUp,
} from "lucide-react";
import type {
  FinancePlanningEvent,
  FinancePlanningResponse,
} from "../types/planning.types";
import { LOGISTICS_LABELS } from "../utils/logisticsLabels";

function eur(value: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function dateLabel(value: string | null): string {
  if (!value) return "Fecha pendiente";
  return new Date(`${value}T00:00:00`).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
  });
}

function sourceLabel(source: FinancePlanningEvent["recommendedSource"]): string {
  if (source === "cash") return "Caja propia";
  if (source === "caja_rural") return "Caja Rural";
  if (source === "la_caixa") return "La Caixa";
  if (source === "bbva") return "BBVA";
  if (source === "manual") return "Revision manual";
  return "Sin fuente";
}

function statusClass(status: FinancePlanningEvent["status"]): string {
  if (status === "pagado") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "vencido") return "bg-rose-50 text-rose-700 border-rose-200";
  if (status === "previsto") return "bg-sky-50 text-sky-700 border-sky-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
}

function logisticsTypeLabel(type: FinancePlanningEvent["logisticsType"]): string {
  return LOGISTICS_LABELS[type] ?? type;
}

function eventAccent(event: FinancePlanningEvent): string {
  if (event.type === "amazon_income") return "border-l-emerald-400";
  if (event.type === "supplier_deposit" || event.type === "supplier_balance") return "border-l-sky-400";
  if (event.type === "credit_line_release") return "border-l-indigo-400";
  if (event.status === "pagado") return "border-l-emerald-400";
  if (event.status === "vencido") return "border-l-rose-400";
  return "border-l-amber-400";
}

function PaymentModal({
  event,
  onClose,
}: {
  event: FinancePlanningEvent;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/40 flex items-start justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-xl bg-white rounded-xl shadow-2xl my-10 border border-slate-100">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Marcar pago</h2>
            <p className="text-xs text-slate-500">{event.title} · {event.containerCode ?? event.orderCode ?? "Sin referencia"}</p>
          </div>
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-900">
            Cerrar
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">Importe original</div>
              <div className="font-semibold text-slate-900">
                {event.originalAmount?.toLocaleString("es-ES", { maximumFractionDigits: 2 }) ?? "-"} {event.originalCurrency}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">Previsto EUR</div>
              <div className="font-semibold text-slate-900">{eur(event.plannedAmountEur)}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs font-medium text-slate-600">
              Tipo de cambio real
              <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Ej. 0.92" />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Comision bancaria
              <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="EUR" />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Fuente de pago
              <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white">
                <option>Caja propia</option>
                <option>Caja Rural</option>
                <option>La Caixa</option>
                <option>BBVA</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Fecha de pago
              <input type="date" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </label>
          </div>
          <label className="text-xs font-medium text-slate-600 block">
            Observaciones
            <textarea className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm min-h-20" />
          </label>
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            Modal preparado. En esta fase no se simulan pagos ni movimientos falsos hasta conectar la escritura financiera.
          </div>
        </div>
      </div>
    </div>
  );
}

function EventCard({
  event,
  onMarkPaid,
}: {
  event: FinancePlanningEvent;
  onMarkPaid: (event: FinancePlanningEvent) => void;
}) {
  return (
    <article className={`bg-white border border-slate-200 border-l-4 ${eventAccent(event)} rounded-lg p-3 shadow-sm`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <CalendarDays className="h-3.5 w-3.5" />
            <span>{dateLabel(event.date)}</span>
          </div>
          <h3 className="mt-1 text-sm font-semibold text-slate-900 truncate">{event.title}</h3>
          <p className="text-xs text-slate-500 truncate">
            {event.containerCode ?? event.orderCode ?? "Sin referencia"}
            {event.numeroPedidoAgente ? ` · ${event.numeroPedidoAgente}` : ""}
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClass(event.status)}`}>
          {event.status}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-slate-400">Importe</div>
          <div className="font-semibold text-slate-800">{eur(event.plannedAmountEur)}</div>
        </div>
        <div>
          <div className="text-slate-400">Fuente</div>
          <div className="font-semibold text-slate-800">{sourceLabel(event.recommendedSource)}</div>
        </div>
        <div>
          <div className="text-slate-400">Agente</div>
          <div className="font-medium text-slate-700 truncate">{event.agentContact ?? "Sin agente"}</div>
        </div>
        <div>
          <div className="text-slate-400">Tipo</div>
          <div className="font-medium text-slate-700">{logisticsTypeLabel(event.logisticsType)}</div>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-slate-500">
        Cambio previsto: {event.plannedFxRate ? event.plannedFxRate : "Cambio previsto pendiente"}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500 line-clamp-2">{event.recommendationReason}</p>
        {event.canMarkPaid && (
          <button
            onClick={() => onMarkPaid(event)}
            className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Pagado
          </button>
        )}
      </div>
    </article>
  );
}

export function FinancialPlanningPage() {
  const [data, setData] = useState<FinancePlanningResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<FinancePlanningEvent | null>(null);

  useEffect(() => {
    fetch("/api/finance/planning?months=6", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (!json.ok) throw new Error(json.error ?? "Error cargando planificacion");
        setData(json);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Error desconocido"))
      .finally(() => setLoading(false));
  }, []);

  const allPendingDateEvents = useMemo(
    () => data?.months.flatMap((month) => month.pendingDateEvents) ?? [],
    [data],
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-7xl text-sm text-slate-500">Cargando planificacion financiera...</div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-3xl rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error ?? "No se pudo cargar la planificacion financiera."}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-6 space-y-5">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
              <Euro className="h-3.5 w-3.5" />
              Planificacion financiera
            </div>
            <h1 className="mt-3 text-2xl font-bold text-slate-950">Cronograma financiero mensual</h1>
            <p className="mt-1 text-sm text-slate-500">
              Pagos de contenedores, liberaciones de lineas e ingresos previstos. No se recomienda por coste hasta configurar comisiones/intereses.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">Limite credito</div>
              <div className="text-sm font-bold text-slate-900">{eur(data.summary.totalCreditLimit)}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">Dispuesto</div>
              <div className="text-sm font-bold text-slate-900">{eur(data.summary.totalCreditUsed)}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">Disponible</div>
              <div className="text-sm font-bold text-emerald-700">{eur(data.summary.totalCreditAvailable)}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">Caja propia</div>
              <div className="text-sm font-bold text-slate-900">{eur(data.summary.cashBalance)}</div>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {data.creditLines.map((line) => (
            <div key={line.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">{line.bankName}</h2>
                  <p className="text-xs text-slate-500">{line.lineName}</p>
                </div>
                <Landmark className="h-5 w-5 text-slate-400" />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div><span className="block text-slate-400">Limite</span><b>{eur(line.creditLimit)}</b></div>
                <div><span className="block text-slate-400">Usado</span><b>{eur(line.usedAmount)}</b></div>
                <div><span className="block text-slate-400">Libre</span><b>{eur(line.availableAmount)}</b></div>
              </div>
              <p className="mt-3 text-[11px] text-slate-500">
                {line.cycleDays ? `Ciclo aprox. ${line.cycleDays} dias.` : "Fechas manuales."} Coste pendiente de configurar.
              </p>
            </div>
          ))}
        </section>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Cambio previsto USD/EUR: {data.summary.plannedUsdEurRate ?? "pendiente de configurar"}. Se usa primero el cambio del contenedor y despues este parametro global.
        </div>

        <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {data.months.map((month) => (
            <div key={month.month} className="rounded-lg border border-slate-200 bg-white/70 overflow-hidden">
              <div className="bg-slate-900 text-white px-4 py-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold">{month.label}</h2>
                  <Clock className="h-5 w-5 text-slate-300" />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-200">
                  <span>Pendiente: {eur(month.totalPendingPayments)}</span>
                  <span>Pagado: {eur(month.totalPaidPayments)}</span>
                  <span>Ingresos: {eur(month.totalIncome)}</span>
                  <span>Liberaciones: {eur(month.totalCreditReleases)}</span>
                </div>
              </div>
              <div className="px-4 py-3 border-b border-slate-200 grid grid-cols-2 gap-2 text-xs bg-white">
                <div className="flex items-center gap-2 text-slate-600">
                  <Banknote className="h-4 w-4" />
                  Caja: <b>{eur(month.projectedCashBalance)}</b>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <CreditCard className="h-4 w-4" />
                  Credito: <b>{eur(month.projectedCreditAvailable)}</b>
                </div>
              </div>
              <div className="p-3 space-y-3 min-h-44">
                {month.events.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                    Sin eventos fechados
                  </div>
                ) : (
                  month.events.map((event) => (
                    <EventCard key={event.id} event={event} onMarkPaid={setSelectedEvent} />
                  ))
                )}
              </div>
            </div>
          ))}
        </section>

        {allPendingDateEvents.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Package className="h-4 w-4" />
              Fecha pendiente
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {allPendingDateEvents.map((event) => (
                <EventCard key={event.id} event={event} onMarkPaid={setSelectedEvent} />
              ))}
            </div>
          </section>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <TrendingUp className="h-4 w-4" />
            Reglas activas
          </div>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-600">
            <p>La recomendacion usa disponibilidad suficiente y prioridad manual, no coste.</p>
            <p>Una linea no se usa para pagar otra linea; las liberaciones salen de caja propia.</p>
            <p>La caja propia se reserva para liberar lineas y cubrir pagos no financiables.</p>
          </div>
        </section>
      </div>
      {selectedEvent && <PaymentModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </main>
  );
}
