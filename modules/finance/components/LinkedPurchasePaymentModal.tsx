"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import type {
  PurchasePaymentCandidate,
  PurchasePaymentCandidateResponse,
  PurchasePaymentEntryMode,
  PurchasePaymentSourceType,
} from "../types/purchasePaymentBatch.types";
import {
  selectedPurchasePaymentRows,
  togglePurchasePaymentCandidate,
} from "../utils/purchasePaymentSelection";

const money = (value: number, currency: string) =>
  `${value.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

export function LinkedPurchasePaymentModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (batchId: string, reference: string | null) => Promise<void>;
}) {
  const [data, setData] = useState<PurchasePaymentCandidateResponse | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<PurchasePaymentEntryMode>("selected_payments");
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [selectedCandidates, setSelectedCandidates] = useState(
    () => new Map<string, PurchasePaymentCandidate>(),
  );
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [freeAmount, setFreeAmount] = useState("");
  const [sourceType, setSourceType] = useState<PurchasePaymentSourceType | "">("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [creditLineId, setCreditLineId] = useState("");
  const [actualFxRate, setActualFxRate] = useState("");
  const [actualAmountEur, setActualAmountEur] = useState("");
  const [bankFeeEur, setBankFeeEur] = useState("");
  const [ffFeeEur, setFfFeeEur] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [bankReference, setBankReference] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/finance/purchase-payment-candidates?q=${encodeURIComponent(query)}`, {
          cache: "no-store", signal: controller.signal,
        });
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error ?? "No se pudieron cargar las obligaciones.");
        setData(json as PurchasePaymentCandidateResponse);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Error desconocido");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  const selectedRows = useMemo(
    () => selectedPurchasePaymentRows(selectedCandidates),
    [selectedCandidates],
  );
  const lockedAgent = selectedRows[0]?.agentId ?? null;
  const lockedCurrency = selectedRows[0]?.originalCurrency ?? null;
  const totalApplied = selectedRows.reduce((sum, row) => sum + (selected[row.supplierPaymentId] ?? 0), 0);
  const principal = mode === "free_amount" ? Number(freeAmount || 0) : totalApplied;
  const eurReal = lockedCurrency === "EUR"
    ? principal
    : actualAmountEur
      ? Number(actualAmountEur)
      : principal * Number(actualFxRate || 0);
  const totalCharged = eurReal + Number(bankFeeEur || 0) + Number(ffFeeEur || 0);
  const orderCount = new Set(selectedRows.map((row) => row.orderId)).size;
  const supplierCount = new Set(selectedRows.map((row) => row.supplierId ?? row.supplierName)).size;

  const toggle = (row: PurchasePaymentCandidate) => {
    setError(null);
    const alreadySelected = selectedCandidates.has(row.supplierPaymentId);
    if (!alreadySelected && (
      (lockedAgent && row.agentId !== lockedAgent)
      || (lockedCurrency && row.originalCurrency !== lockedCurrency)
    )) return;
    setSelectedCandidates((current) => {
      return togglePurchasePaymentCandidate(current, row);
    });
    setSelected((current) => {
      const next = { ...current };
      if (alreadySelected) delete next[row.supplierPaymentId];
      else next[row.supplierPaymentId] = row.pendingAmountOriginal;
      return next;
    });
  };

  const toggleOrder = (row: PurchasePaymentCandidate) => {
    const rows = (data?.candidates ?? []).filter((candidate) =>
      candidate.orderId === row.orderId
      && (!lockedAgent || candidate.agentId === lockedAgent)
      && (!lockedCurrency || candidate.originalCurrency === lockedCurrency));
    const allSelected = rows.every((candidate) => selected[candidate.supplierPaymentId] !== undefined);
    setSelected((current) => {
      const next = { ...current };
      rows.forEach((candidate) => {
        if (allSelected) delete next[candidate.supplierPaymentId];
        else next[candidate.supplierPaymentId] = candidate.pendingAmountOriginal;
      });
      return next;
    });
    setSelectedCandidates((current) => {
      const next = new Map(current);
      rows.forEach((candidate) => {
        if (allSelected) next.delete(candidate.supplierPaymentId);
        else next.set(candidate.supplierPaymentId, candidate);
      });
      return next;
    });
  };

  const submit = async () => {
    setError(null);
    if (!selectedRows.length) return setError("Selecciona al menos una obligación.");
    if (!Number.isFinite(principal) || principal <= 0) return setError("El principal debe ser mayor que 0.");
    if (Math.abs(totalApplied - principal) > 0.0001) return setError("La suma aplicada debe coincidir exactamente con el principal.");
    if (!sourceType) return setError("Selecciona explícitamente la fuente financiera.");
    if (sourceType === "cash_account" && !cashAccountId) return setError("Selecciona una cuenta propia.");
    if (sourceType === "credit_line" && !creditLineId) return setError("Selecciona una línea de crédito.");
    if (lockedCurrency !== "EUR" && !actualFxRate && !actualAmountEur) {
      return setError("Introduce tipo de cambio real o EUR real.");
    }

    setSaving(true);
    try {
      const response = await fetch("/api/finance/purchase-payment-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payeeType: "agent",
          agentId: selectedRows[0].agentId,
          entryMode: mode,
          amountOriginal: principal,
          originalCurrency: selectedRows[0].originalCurrency,
          actualFxRate: actualFxRate || null,
          actualAmountEur: actualAmountEur || null,
          bankFeeEur: bankFeeEur || 0,
          ffFeeEur: ffFeeEur || 0,
          paidAt,
          bankReference: bankReference || null,
          notes: notes || null,
          sourceType,
          cashAccountId: sourceType === "cash_account" ? cashAccountId : null,
          creditLineId: sourceType === "credit_line" ? creditLineId : null,
          idempotencyKey,
          allocations: selectedRows.map((row) => ({
            supplierPaymentId: row.supplierPaymentId,
            amountOriginal: selected[row.supplierPaymentId],
          })),
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error ?? "No se pudo registrar el pago.");
      await onSaved(String(json.batch.id), json.batch.bank_reference ? String(json.batch.bank_reference) : null);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-3">
      <div className="mx-auto my-4 w-full max-w-6xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div><h2 className="text-base font-semibold text-slate-950">Crear pago vinculado</h2><p className="text-xs text-slate-500">Transferencia al agente aplicada a obligaciones de compra</p></div>
          <button type="button" onClick={onClose} className="p-2 text-slate-500 hover:text-slate-900" title="Cerrar"><X className="h-5 w-5" /></button>
        </header>
        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex border border-slate-200 p-1">
                {(["selected_payments", "free_amount"] as const).map((value) => (
                  <button key={value} type="button" onClick={() => setMode(value)}
                    className={`px-3 py-1.5 text-xs font-medium ${mode === value ? "bg-slate-900 text-white" : "text-slate-600"}`}>
                    {value === "selected_payments" ? "Seleccionar obligaciones" : "Importe libre"}
                  </button>
                ))}
              </div>
              {mode === "free_amount" ? <input type="number" min="0.01" step="0.0001" value={freeAmount} onChange={(e) => setFreeAmount(e.target.value)}
                placeholder="Importe transferido" className="w-48 border border-slate-200 px-3 py-2 text-sm" /> : null}
            </div>
            <div className="flex items-center gap-2 border border-slate-200 px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 text-sm outline-none"
                placeholder="Orden, pedido agente, agente, fábrica o referencia" />
            </div>
            {selectedRows.length ? (
              <div className="border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 text-xs font-semibold text-slate-700">
                  Seleccionados ({selectedRows.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedRows.map((row) => (
                    <button
                      key={row.supplierPaymentId}
                      type="button"
                      onClick={() => toggle(row)}
                      className="inline-flex items-center gap-1 border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                    >
                      {row.orderNumber} · {row.paymentType}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="max-h-[520px] overflow-auto border border-slate-200">
              <table className="w-full min-w-[920px] text-left text-xs">
                <thead className="sticky top-0 bg-slate-100 text-slate-600"><tr>
                  <th className="p-2">Sel.</th><th className="p-2">Orden</th><th className="p-2">Agente / fábrica</th>
                  <th className="p-2">Obligación</th><th className="p-2 text-right">Original</th><th className="p-2 text-right">Pagado</th>
                  <th className="p-2 text-right">Pendiente</th><th className="p-2">Importe a aplicar</th>
                </tr></thead>
                <tbody>
                  {loading ? <tr><td colSpan={8} className="p-6 text-center text-slate-500">Cargando...</td></tr> :
                    (data?.candidates ?? []).map((row) => {
                      const incompatible = Boolean((lockedAgent && row.agentId !== lockedAgent) || (lockedCurrency && row.originalCurrency !== lockedCurrency));
                      const checked = selectedCandidates.has(row.supplierPaymentId);
                      return <tr key={row.supplierPaymentId} className={`border-t border-slate-100 ${incompatible ? "opacity-40" : ""}`}>
                        <td className="p-2"><input type="checkbox" checked={checked} disabled={incompatible} onChange={() => toggle(row)} /></td>
                        <td className="p-2"><button type="button" onClick={() => toggleOrder(row)} className="font-semibold text-sky-700">{row.orderNumber}</button><div className="text-slate-400">{row.agentOrderNumber ?? "-"}</div></td>
                        <td className="p-2"><b>{row.agentName}</b><div className="text-slate-500">{row.supplierName ?? "Sin fábrica"}</div></td>
                        <td className="p-2">{row.paymentType}<div className="text-slate-500">{row.status} · {row.dueDate ?? "sin fecha"}</div></td>
                        <td className="p-2 text-right">{money(row.amountOriginal, row.originalCurrency)}</td>
                        <td className="p-2 text-right">{money(row.allocatedAmountOriginal, row.originalCurrency)}</td>
                        <td className="p-2 text-right font-semibold">{money(row.pendingAmountOriginal, row.originalCurrency)}</td>
                        <td className="p-2"><input type="number" step="0.0001" min="0.0001" max={row.pendingAmountOriginal} disabled={!checked}
                          value={checked ? selected[row.supplierPaymentId] : ""} onChange={(e) => setSelected((current) => ({ ...current, [row.supplierPaymentId]: Number(e.target.value) }))}
                          className="w-32 border border-slate-200 px-2 py-1.5 disabled:bg-slate-50" /></td>
                      </tr>;
                    })}
                </tbody>
              </table>
            </div>
          </section>
          <aside className="space-y-4">
            <section className="border border-slate-200 p-4 text-xs">
              <h3 className="font-semibold text-slate-900">Destinatario y resumen</h3>
              <dl className="mt-3 grid grid-cols-2 gap-2">
                <dt className="text-slate-500">Destinatario</dt><dd className="text-right font-medium">{selectedRows[0]?.agentName ?? "Sin seleccionar"} (agente)</dd>
                <dt className="text-slate-500">Órdenes / fábricas</dt><dd className="text-right">{orderCount} / {supplierCount}</dd>
                <dt className="text-slate-500">Principal</dt><dd className="text-right font-semibold">{money(principal || 0, lockedCurrency ?? "")}</dd>
                <dt className="text-slate-500">EUR real</dt><dd className="text-right">{money(eurReal || 0, "EUR")}</dd>
                <dt className="text-slate-500">Comisiones</dt><dd className="text-right">{money(Number(bankFeeEur || 0) + Number(ffFeeEur || 0), "EUR")}</dd>
                <dt className="text-slate-500">Total cargado</dt><dd className="text-right font-semibold">{money(totalCharged || 0, "EUR")}</dd>
              </dl>
            </section>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">Cambio real<input type="number" step="0.000001" value={actualFxRate} onChange={(e) => setActualFxRate(e.target.value)} className="mt-1 w-full border px-2 py-2" /></label>
              <label className="text-xs">EUR real<input type="number" step="0.01" value={actualAmountEur} onChange={(e) => setActualAmountEur(e.target.value)} className="mt-1 w-full border px-2 py-2" /></label>
              <label className="text-xs">Comisión banco<input type="number" step="0.01" min="0" value={bankFeeEur} onChange={(e) => setBankFeeEur(e.target.value)} className="mt-1 w-full border px-2 py-2" /></label>
              <label className="text-xs">Gastos FF<input type="number" step="0.01" min="0" value={ffFeeEur} onChange={(e) => setFfFeeEur(e.target.value)} className="mt-1 w-full border px-2 py-2" /></label>
            </div>
            <label className="block text-xs">Fecha efectiva<input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="mt-1 w-full border px-2 py-2" /></label>
            <fieldset className="space-y-2 text-xs"><legend className="font-semibold">Fuente financiera</legend>
              <label className="flex items-center gap-2"><input type="radio" checked={sourceType === "cash_account"} onChange={() => { setSourceType("cash_account"); setCreditLineId(""); }} /> Cuenta propia</label>
              {sourceType === "cash_account" ? <select value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value)} className="w-full border px-2 py-2"><option value="">Seleccionar cuenta</option>{data?.cashAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {money(account.balance, account.currency)}</option>)}</select> : null}
              <label className="flex items-center gap-2"><input type="radio" checked={sourceType === "credit_line"} onChange={() => { setSourceType("credit_line"); setCashAccountId(""); }} /> Línea de crédito</label>
              {sourceType === "credit_line" ? <select value={creditLineId} onChange={(e) => setCreditLineId(e.target.value)} className="w-full border px-2 py-2"><option value="">Seleccionar línea</option>{data?.creditLines.map((line) => <option key={line.id} value={line.id}>{line.bankName} · {line.lineName} · {money(line.availableAmount, "EUR")}</option>)}</select> : null}
            </fieldset>
            <input value={bankReference} onChange={(e) => setBankReference(e.target.value)} placeholder="Referencia bancaria" className="w-full border px-3 py-2 text-xs" />
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones" className="w-full border px-3 py-2 text-xs" rows={2} />
            {error ? <p className="border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">{error}</p> : null}
            <button type="button" disabled={saving} onClick={submit} className="inline-flex w-full items-center justify-center gap-2 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              <Check className="h-4 w-4" />{saving ? "Registrando..." : "Crear pago vinculado"}
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}
