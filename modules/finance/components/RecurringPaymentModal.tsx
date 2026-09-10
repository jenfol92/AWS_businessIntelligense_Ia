"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { accountingDate } from "../utils/accountingDate";
import { readPaymentOperation, reservePaymentOperation, clearPaymentOperation, attemptPaymentOperation, type PendingPaymentOperation } from "../utils/recurringPaymentOperation";
import type { FinancePlanningEvent } from "../types/planning.types";

type PaymentType = { id: string; name: string; category: string };
type Account = { id: string; name: string; balance: number; currency: string };
const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";

export function RecurringPaymentModal({ event, onClose, onSaved }: {
  event?: FinancePlanningEvent; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [options, setOptions] = useState<{ types: PaymentType[]; accounts: Account[]; operationScope: string } | null>(null);
  const [typeId, setTypeId] = useState("");
  const [concept, setConcept] = useState(event?.title ?? "");
  const [amount, setAmount] = useState(event ? String(event.plannedAmountEur) : "");
  const [accountId, setAccountId] = useState(event?.paymentCashAccountId ?? "");
  const [date, setDate] = useState(accountingDate());
  const [frequency, setFrequency] = useState("1");
  const [hasEnd, setHasEnd] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [action, setAction] = useState("pending");
  const [typeName, setTypeName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);
  const request = useRef<PendingPaymentOperation | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  function restoreOperation(operation: PendingPaymentOperation) {
    const payload = JSON.parse(operation.body);
    request.current = operation;
    setUncertain(true); setTypeName(null);
    setAmount(String(payload.amount_eur)); setAccountId(payload.cash_account_id);
    setDate(payload.paid_date ?? payload.date);
    setConcept(payload.concept ?? "Pago pendiente de confirmación");
    if (payload.payment_type_id) setTypeId(payload.payment_type_id);
    if (payload.frequency != null) setFrequency(String(payload.frequency));
    setHasEnd(Boolean(payload.end_date)); setEndDate(payload.end_date ?? "");
    setAction(payload.action ?? "paid");
  }

  useEffect(() => {
    dialog.current?.showModal();
    const controller = new AbortController();
    void fetch("/api/finance/recurring-payments", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error("No se pudo cargar el formulario. Comprueba los permisos y que la migración de pagos recurrentes esté aplicada.");
        if (!controller.signal.aborted) {
          if (typeof json.operationScope !== "string") throw new Error("No se pudo identificar la sesión de pagos.");
          setOptions(json); setTypeId(json.types.find((t: PaymentType) => t.category === "social_security")?.id ?? json.types[0]?.id ?? "");
          const pending = readPaymentOperation(window.localStorage, json.operationScope);
          if (pending) restoreOperation(pending);
          setStorageReady(true);
        }
      }).catch(caught => { if (!controller.signal.aborted) setError(caught.message); });
    return () => controller.abort();
  }, []);

  async function createType() {
    if (busy.current || !typeName?.trim()) return;
    busy.current = true; setSaving(true); setError(null);
    try {
      const response = await fetch("/api/finance/payment-types", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: typeName.trim() }) });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error ?? "No se pudo crear el tipo de pago.");
      setOptions(current => current ? { ...current, types: [...current.types, json.data] } : current);
      setTypeId(json.data.id); setTypeName(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo crear el tipo."); }
    finally { busy.current = false; setSaving(false); }
  }

  async function finishConfirmed() {
    request.current = null; setSaved(true); setUncertain(false);
    try { await onSaved(); onClose(); }
    catch { setError("Operación confirmada. No se pudo refrescar la pantalla; cierra y pulsa Actualizar, sin repetir el pago."); }
  }

  function locked<T>(action: () => Promise<T>) {
    if (!options || !navigator.locks) throw new Error("Este navegador no permite proteger las operaciones entre pestañas. No se ha enviado el pago.");
    return navigator.locks.request('finance-recurring:' + options.operationScope, action);
  }

  async function checkStatus() {
    if (busy.current || !options || !request.current) return;
    busy.current = true; setSaving(true); setError(null);
    try {
      await locked(async () => {
        const operation = request.current!;
        const response = await fetch('/api/finance/recurring-payments?operationId=' + encodeURIComponent(operation.operationId) + '&kind=' + (operation.paying ? 'pay' : 'create'), { cache: "no-store" });
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error ?? "No se pudo comprobar el estado.");
        if (json.data?.state === "confirmed") {
          clearPaymentOperation(window.localStorage, options.operationScope, operation.operationId);
          await finishConfirmed();
        } else setError("Todavía no hay confirmación. La petición puede seguir en curso; se conserva la misma operación para reintentar.");
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo comprobar el estado."); }
    finally { busy.current = false; setSaving(false); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current || saved || !options || !storageReady) return;
    busy.current = true; setSaving(true); setError(null);
    try {
      await locked(async () => {
        const existing = readPaymentOperation(window.localStorage, options.operationScope);
        if (existing && existing.operationId !== request.current?.operationId) {
          restoreOperation(existing);
          setError("Existe una operación sin confirmar. Comprueba su estado antes de iniciar otra.");
          return;
        }
        const previouslyUncertain = request.current !== null;
        if (!request.current) {
          const operationId = crypto.randomUUID();
          const payload = event ? {
            idempotency_key: operationId, amount_eur: Number(amount), cash_account_id: accountId, paid_date: date,
            ...(event.unlinkedInstallmentId ? { installment_id: event.unlinkedInstallmentId }
              : { template_id: event.unlinkedTemplateId, due_date: event.date }),
          } : {
            idempotency_key: operationId, payment_type_id: typeId, concept, amount_eur: Number(amount), cash_account_id: accountId,
            date, frequency: Number(frequency), end_date: frequency !== "0" && hasEnd ? endDate : null, action,
          };
          request.current = reservePaymentOperation(window.localStorage, options.operationScope,
            { operationId, paying: Boolean(event), body: JSON.stringify(payload) });
        }
        const outcome = await attemptPaymentOperation(window.localStorage, options.operationScope, request.current, previouslyUncertain,
          operation => fetch('/api/finance/recurring-payments' + (operation.paying ? '?action=pay' : ''), {
            method: "POST", headers: { "Content-Type": "application/json" }, body: operation.body,
          }));
        if (outcome.state === "confirmed") await finishConfirmed();
        else {
          if (outcome.state === "rejected") { request.current = null; setUncertain(false); }
          else setUncertain(true);
          setError(outcome.message ?? "No se ha confirmado la operación.");
        }
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo proteger la operación; no se iniciará otro pago."); }
    finally { busy.current = false; setSaving(false); }
  }

  const cannotClose = saving || uncertain;
  function close() { if (!busy.current && !uncertain) onClose(); }

  return <dialog ref={dialog} onCancel={e => { if (cannotClose) e.preventDefault(); else close(); }} className="w-full max-w-xl rounded-xl p-0 shadow-xl backdrop:bg-slate-950/50">
    <form onSubmit={submit} className="space-y-4 p-6">
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{uncertain ? "Operación pendiente de confirmar" : event ? "Registrar pago recurrente" : "Crear pago recurrente"}</h2><button type="button" disabled={cannotClose} onClick={close} aria-label="Cerrar">✕</button></div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {uncertain && <div role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        Hay una operación pendiente de confirmar. No se puede cerrar ni crear otra; la clave se conserva también al recargar.
        <button type="button" disabled={saving} onClick={() => void checkStatus()} className="mt-2 block font-semibold underline">Comprobar estado</button>
      </div>}
      {!options && !error && <p>Cargando cuentas y tipos de pago…</p>}
      <fieldset disabled={saving || saved || uncertain || !options || !storageReady} className="space-y-4 disabled:opacity-70">
        {!event && <><label className="block text-sm">Tipo de pago<select required className={field} value={typeId} onChange={e => setTypeId(e.target.value)}>{options?.types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
          <button type="button" className="text-sm font-semibold text-indigo-700" onClick={() => setTypeName("")}>+ Crear tipo de pago</button>
          {typeName !== null && <div className="flex gap-2"><input aria-label="Nombre del tipo de pago" className={field} maxLength={80} value={typeName} onChange={e => setTypeName(e.target.value)} /><button type="button" onClick={() => void createType()} disabled={!typeName.trim()}>Guardar tipo</button></div>}</>}
        <label className="block text-sm">Concepto<input required maxLength={200} readOnly={Boolean(event)} className={field} value={concept} onChange={e => setConcept(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-sm">Importe EUR<input required type="number" min="0.01" step="0.01" max={event?.plannedAmountEur} className={field} value={amount} onChange={e => setAmount(e.target.value)} /></label><label className="text-sm">{event ? "Fecha de pago" : "Fecha"}<input required type="date" max={event || action === "paid" ? accountingDate() : undefined} className={field} value={date} onChange={e => setDate(e.target.value)} /></label></div>
        <label className="block text-sm">Cuenta bancaria<select required className={field} value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">Seleccionar cuenta</option>{options?.accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {Number(account.balance).toLocaleString("es-ES")} EUR</option>)}</select></label>
        {!event && <><label className="block text-sm">Frecuencia<select className={field} value={frequency} onChange={e => setFrequency(e.target.value)}><option value="0">Una vez</option><option value="1">Mensual</option><option value="3">Trimestral</option><option value="12">Anual</option></select></label>
          {frequency !== "0" && <label className="block text-sm">Finalización<select className={field} value={hasEnd ? "date" : "none"} onChange={e => setHasEnd(e.target.value === "date")}><option value="none">Sin fecha</option><option value="date">Hasta una fecha</option></select>{hasEnd && <input required type="date" min={date} aria-label="Fecha de finalización" className={field} value={endDate} onChange={e => setEndDate(e.target.value)} />}</label>}
          <label className="block text-sm">Acción<select className={field} value={action} onChange={e => setAction(e.target.value)}><option value="pending">Guardar pendiente</option><option value="paid">Registrar como pagado</option></select></label></>}
      </fieldset>
      <p className="text-xs text-slate-500">{event || action === "paid" ? "Se descontará este importe de la cuenta elegida en el ERP." : "El saldo de la cuenta no cambia hasta registrar el pago."} {!event && frequency !== "0" && "Las próximas cuotas quedarán pendientes; no se descontarán por adelantado."}</p>
      <div className="flex justify-end gap-3"><button type="button" disabled={cannotClose} onClick={close}>{saved ? "Cerrar" : "Cancelar"}</button>{!saved && <button type="submit" disabled={saving || !options || !storageReady || typeName !== null} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Guardando…" : uncertain ? "Reintentar misma operación" : event ? "Registrar pago" : "Crear pago recurrente"}</button>}</div>
    </form>
  </dialog>;
}
