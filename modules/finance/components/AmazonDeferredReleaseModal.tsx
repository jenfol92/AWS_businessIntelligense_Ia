"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { AmazonDeferredReleaseAggregate } from "../types/planning.types";
import { formatOriginalAmount, formatPlanningEur, unvaluedSummary } from "./amazonPlanningFormat";

type DeferredTransaction = {
  id: unknown;
  sourceKey: string | null;
  marketplace: string | null;
  amazonTransactionId: string | null;
  amazonTransactionType: string | null;
  amazonPostedAt: string | null;
  amazonReleaseDate: string | null;
  amazonDeferralReason: string | null;
  originalCurrency: string | null;
  originalAmount: number | null;
  amountEur: number | null;
};

type DetailResponse = {
  ok: boolean;
  semantic: string;
  label: string;
  observedAt: string | null;
  releaseDate: string | null;
  transactions: DeferredTransaction[];
  error?: string;
};

function transactionTypeLabel(type: string | null): string {
  if (!type) return "—";
  if (type === "Shipment") return "Shipment";
  if (type === "Refund") return "Refund";
  if (type === "RemovalShipment") return "RemovalShipment";
  return type;
}

function deferralReasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  if (reason === "DD7") return "DD7";
  if (reason === "B2B") return "B2B";
  return reason;
}

export function AmazonDeferredReleaseModal({
  month,
  dailyBuckets,
  observedAt,
  onClose,
}: {
  month: string;
  dailyBuckets: AmazonDeferredReleaseAggregate[];
  observedAt: string | null;
  onClose: () => void;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const daysInMonth = useMemo(
    () =>
      dailyBuckets
        .filter((bucket) => bucket.date?.startsWith(`${month}-`))
        .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
    [dailyBuckets, month],
  );

  useEffect(() => {
    if (!selectedDay) {
      setDetail(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDetail(null);

    void (async () => {
      try {
        const response = await fetch(
          `/api/finance/planning/amazon-deferred-release?releaseDate=${encodeURIComponent(selectedDay)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const json = (await response.json()) as DetailResponse;
        if (!response.ok || !json.ok) {
          throw new Error(json.error ?? "No se pudo cargar el detalle de liberación.");
        }
        setDetail(json);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "Error desconocido");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [selectedDay]);

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-950/50 p-4">
      <div className="mx-auto my-8 w-full max-w-5xl rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Liberación Amazon prevista · {month}</h2>
            <p className="mt-1 text-xs text-amber-800">
              Liberación Amazon ≠ ingreso bancario. Importe retenido observado en Amazon, agrupado por fecha de
              liberación prevista por Amazon (maturityDate). No es ingreso bancario ni fecha bancaria.
            </p>
            {observedAt ? (
              <p className="mt-1 text-[11px] text-slate-500">
                Snapshot observado: {new Date(observedAt).toLocaleString("es-ES")}
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} title="Cerrar" className="p-2 text-slate-500 hover:text-slate-800">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-5 p-5">
          <section>
            <h3 className="text-sm font-semibold text-slate-900">Días del mes</h3>
            <p className="mt-1 text-xs text-slate-500">
              Selecciona un día para cargar transacciones individuales bajo demanda.
            </p>
            {daysInMonth.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                No hay importes retenidos con liberación prevista Amazon en este mes.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">Fecha liberación prevista (Amazon)</th>
                      <th className="py-2 pr-3">EUR conocido</th>
                      <th className="py-2 pr-3">Transacciones</th>
                      <th className="py-2 pr-3">Positivos</th>
                      <th className="py-2 pr-3">Negativos</th>
                      <th className="py-2">No valorados</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {daysInMonth.map((day) => {
                      const unvalued = unvaluedSummary(day);
                      return (
                        <tr
                          key={day.date ?? "unknown"}
                          className={`cursor-pointer hover:bg-violet-50 ${selectedDay === day.date ? "bg-violet-50" : ""}`}
                          onClick={() => day.date && setSelectedDay(day.date)}
                        >
                          <td className="py-2 pr-3 font-medium text-slate-900">{day.date ?? "—"}</td>
                          <td className="py-2 pr-3">{formatPlanningEur(day.knownEur)}</td>
                          <td className="py-2 pr-3">{day.transactionCount}</td>
                          <td className="py-2 pr-3 text-emerald-700">{formatPlanningEur(day.positiveKnownEur)}</td>
                          <td className="py-2 pr-3 text-rose-700">{formatPlanningEur(day.negativeKnownEur)}</td>
                          <td className="py-2">
                            {day.unvaluedCount > 0 ? (
                              <span className="text-amber-800">
                                {unvalued ?? `${day.unvaluedCount} sin valorar`}
                                {!day.isComplete ? " · incompleto" : ""}
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {selectedDay ? (
            <section className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Detalle · {selectedDay}</h3>
              {loading ? <p className="mt-3 text-sm text-slate-500">Cargando transacciones…</p> : null}
              {error ? <p className="mt-3 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
              {!loading && !error && detail && detail.transactions.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">Sin transacciones para este día.</p>
              ) : null}
              {!loading && !error && detail && detail.transactions.length > 0 ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="py-2 pr-3">Tipo</th>
                        <th className="py-2 pr-3">Motivo</th>
                        <th className="py-2 pr-3">Marketplace</th>
                        <th className="py-2 pr-3">Original</th>
                        <th className="py-2 pr-3">EUR</th>
                        <th className="py-2">ID transacción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {detail.transactions.map((tx, index) => (
                        <tr key={String(tx.id ?? tx.sourceKey ?? index)}>
                          <td className="py-2 pr-3 font-medium">{transactionTypeLabel(tx.amazonTransactionType)}</td>
                          <td className="py-2 pr-3">{deferralReasonLabel(tx.amazonDeferralReason) ?? "—"}</td>
                          <td className="py-2 pr-3">{tx.marketplace ?? "—"}</td>
                          <td className="py-2 pr-3">
                            {formatOriginalAmount(tx.originalAmount, tx.originalCurrency ?? "—")}
                          </td>
                          <td className="py-2 pr-3">{formatPlanningEur(tx.amountEur)}</td>
                          <td className="py-2 font-mono text-[10px] text-slate-600">
                            {tx.amazonTransactionId ?? tx.sourceKey ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
