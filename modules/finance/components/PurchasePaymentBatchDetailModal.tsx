"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

type BatchDetail = {
  batch: Record<string, unknown>;
  allocations: Record<string, unknown>[];
  movement: Record<string, unknown> | null;
};

const amount = (value: unknown, currency: string) =>
  `${Number(value ?? 0).toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;

export function PurchasePaymentBatchDetailModal({
  batchId,
  onClose,
}: {
  batchId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/finance/purchase-payment-batches/${batchId}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error ?? "No se pudo cargar el pago.");
        setDetail(json as BatchDetail);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "Error desconocido");
        }
      }
    })();
    return () => controller.abort();
  }, [batchId]);

  const batch = detail?.batch;
  const currency = String(batch?.original_currency ?? "");

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-950/50 p-4">
      <div className="mx-auto my-8 w-full max-w-4xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Detalle del pago vinculado</h2>
            <p className="text-xs text-slate-500">{batchId}</p>
          </div>
          <button type="button" onClick={onClose} title="Cerrar" className="p-2 text-slate-500">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="space-y-5 p-5">
          {error ? <p className="border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          {!detail && !error ? <p className="text-sm text-slate-500">Cargando detalle...</p> : null}
          {batch ? (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
                <div><dt className="text-xs text-slate-500">Agente</dt><dd className="font-semibold">{String(batch.agent_name ?? "-")}</dd></div>
                <div><dt className="text-xs text-slate-500">Fecha</dt><dd>{String(batch.paid_at ?? "-").slice(0, 10)}</dd></div>
                <div><dt className="text-xs text-slate-500">Referencia</dt><dd>{String(batch.bank_reference ?? "-")}</dd></div>
                <div><dt className="text-xs text-slate-500">Fuente</dt><dd>{String(batch.source_name ?? batch.source_type ?? "-")}</dd></div>
                <div><dt className="text-xs text-slate-500">Principal</dt><dd>{amount(batch.amount_original, currency)}</dd></div>
                <div><dt className="text-xs text-slate-500">Cambio real</dt><dd>{String(batch.actual_fx_rate ?? "-")}</dd></div>
                <div><dt className="text-xs text-slate-500">EUR real</dt><dd>{amount(batch.actual_amount_eur, "EUR")}</dd></div>
                <div><dt className="text-xs text-slate-500">Total cargado</dt><dd className="font-semibold">{amount(batch.funded_total_eur, "EUR")}</dd></div>
                <div><dt className="text-xs text-slate-500">Comisión bancaria</dt><dd>{amount(batch.bank_fee_eur, "EUR")}</dd></div>
                <div><dt className="text-xs text-slate-500">Gastos FF</dt><dd>{amount(batch.ff_fee_eur, "EUR")}</dd></div>
                <div><dt className="text-xs text-slate-500">Movimiento</dt><dd>{String(detail.movement?.id ?? "-")}</dd></div>
              </dl>
              <div className="overflow-auto border border-slate-200">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr><th className="p-2">Orden</th><th className="p-2">Pedido agente</th><th className="p-2">Fábrica</th><th className="p-2">Obligación</th><th className="p-2 text-right">Aplicado</th><th className="p-2 text-right">EUR</th><th className="p-2">Resultado histórico</th><th className="p-2">Estado actual</th></tr>
                  </thead>
                  <tbody>
                    {detail.allocations.map((allocation) => (
                      <tr key={String(allocation.id)} className="border-t border-slate-100">
                        <td className="p-2 font-semibold">{String(allocation.numero_orden ?? "-")}</td>
                        <td className="p-2">{String(allocation.numero_pedido_agente ?? "-")}</td>
                        <td className="p-2">{String(allocation.supplier_names ?? "-")}</td>
                        <td className="p-2">{String(allocation.payment_type ?? "-")}</td>
                        <td className="p-2 text-right">{amount(allocation.allocated_amount_original, currency)}</td>
                        <td className="p-2 text-right">{amount(allocation.allocated_amount_eur, "EUR")}</td>
                        <td className="p-2">{String(allocation.resulting_status ?? "-")}</td>
                        <td className="p-2">{String(allocation.current_obligation_status ?? "-")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
