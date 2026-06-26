"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
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
  FinanceCashAccount,
  FinanceCreditLine,
  FinancePlanningEvent,
  FinancePlanningResponse,
  FinanceSupplierPaymentSourceType,
} from "../types/planning.types";
import { LOGISTICS_LABELS } from "../utils/logisticsLabels";

const PAYMENT_SOURCE_OPTIONS = [
  { value: "cash", label: "Caja propia" },
  { value: "caja_rural", label: "Caja Rural" },
  { value: "la_caixa", label: "La Caixa" },
  { value: "bbva", label: "BBVA" },
  { value: "manual", label: "Revision manual" },
];

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

function isSupplierPaymentEvent(event: FinancePlanningEvent): boolean {
  return event.type === "supplier_deposit" || event.type === "supplier_balance";
}

function isSupplierPaymentFinanced(event: FinancePlanningEvent): boolean {
  return event.paymentSourceType === "cash_account"
    || event.paymentSourceType === "credit_line"
    || event.paymentSourceType === "manual";
}

function supplierPaymentFinanceLabel(event: FinancePlanningEvent): string | null {
  if (event.paymentSourceType === "cash_account") return "Financiado con caja";
  if (event.paymentSourceType === "credit_line") return "Financiado con linea";
  if (event.paymentSourceType === "manual") return "Financiacion manual";
  return null;
}

function canRepayCreditLineEvent(event: FinancePlanningEvent): boolean {
  return event.type === "credit_line_release"
    && event.isInformational !== true
    && Boolean(event.creditLineId)
    && Boolean(event.repaymentGroupId)
    && event.plannedAmountEur > 0;
}

function PaymentModal({
  event,
  onClose,
  onSaved,
}: {
  event: FinancePlanningEvent;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const isEurPayment = event.originalCurrency.trim().toUpperCase() === "EUR";
  const [actualFxRate, setActualFxRate] = useState(
    isEurPayment
      ? "1"
      : event.plannedFxRate != null
        ? String(event.plannedFxRate)
        : "",
  );
  const [bankFeeEur, setBankFeeEur] = useState("");
  const [paymentSource, setPaymentSource] = useState<string>(
    event.recommendedSource ?? "cash",
  );
  const [paidAt, setPaidAt] = useState(today);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const res = await fetch(
        `/api/finance/supplier-payments/${event.id}/mark-paid`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actualFxRate: isEurPayment ? undefined : Number(actualFxRate),
            paymentSource,
            paidAt,
            bankFeeEur: bankFeeEur.trim() ? Number(bankFeeEur) : null,
            notes: notes.trim() ? notes.trim() : null,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "No se pudo marcar el pago");
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/40 flex items-start justify-center p-4 overflow-y-auto">
      <form
        onSubmit={submit}
        className="w-full max-w-xl bg-white rounded-xl shadow-2xl my-10 border border-slate-100"
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Marcar pago</h2>
            <p className="text-xs text-slate-500">
              {event.title} - {event.containerCode ?? event.orderCode ?? "Sin referencia"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-sm text-slate-500 hover:text-slate-900 disabled:opacity-50"
          >
            Cerrar
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">Importe original</div>
              <div className="font-semibold text-slate-900">
                {event.originalAmount?.toLocaleString("es-ES", {
                  maximumFractionDigits: 2,
                }) ?? "-"}{" "}
                {event.originalCurrency}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">Previsto EUR</div>
              <div className="font-semibold text-slate-900">
                {eur(event.plannedAmountEur)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs font-medium text-slate-600">
              Tipo de cambio real
              <input
                type="number"
                step="0.000001"
                min="0.000001"
                required={!isEurPayment}
                disabled={isEurPayment}
                value={actualFxRate}
                onChange={(e) => setActualFxRate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                placeholder="Ej. 0.92"
              />
              <span className="mt-1 block text-[11px] font-normal text-slate-500">
                {isEurPayment
                  ? "Pago en EUR, no requiere tipo de cambio."
                  : "1 unidad de moneda origen = X EUR."}
              </span>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Comision bancaria
              <input
                type="number"
                step="0.01"
                min="0"
                value={bankFeeEur}
                onChange={(e) => setBankFeeEur(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="EUR"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Fuente de pago
              <select
                required
                value={paymentSource}
                onChange={(e) => setPaymentSource(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
              >
                {PAYMENT_SOURCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Fecha de pago
              <input
                type="date"
                required
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <label className="text-xs font-medium text-slate-600 block">
            Observaciones
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm min-h-20"
            />
          </label>

          {error ? (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-800">
            Guarda el pago real en pagos proveedor. No crea movimientos de caja ni linea de credito en esta fase.
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar pago"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function FinanceSupplierPaymentModal({
  event,
  cashAccounts,
  creditLines,
  onClose,
  onSaved,
}: {
  event: FinancePlanningEvent;
  cashAccounts: FinanceCashAccount[];
  creditLines: FinanceCreditLine[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [sourceType, setSourceType] = useState<FinanceSupplierPaymentSourceType>("cash_account");
  const [movementDate, setMovementDate] = useState(today);
  const [cashAccountId, setCashAccountId] = useState(cashAccounts[0]?.id ?? "");
  const [creditLineId, setCreditLineId] = useState(creditLines[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!sourceType) {
      setError("Selecciona un tipo de financiacion.");
      return;
    }

    if (!movementDate) {
      setError("Indica la fecha de movimiento.");
      return;
    }

    if (sourceType === "cash_account" && !cashAccountId) {
      setError("Selecciona una cuenta de caja.");
      return;
    }

    if (sourceType === "credit_line" && !creditLineId) {
      setError("Selecciona una linea de credito.");
      return;
    }

    setSaving(true);

    const fundingSourceId =
      sourceType === "cash_account"
        ? cashAccountId
        : sourceType === "credit_line"
          ? creditLineId
          : "manual";

    try {
      const res = await fetch(
        `/api/finance/supplier-payments/${event.id}/finance`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceType,
            movementDate,
            cashAccountId: sourceType === "cash_account" ? cashAccountId : null,
            creditLineId: sourceType === "credit_line" ? creditLineId : null,
            notes: notes.trim() ? notes.trim() : null,
            idempotencyKey: `supplier-payment-finance:${event.id}:${sourceType}:${fundingSourceId}:${movementDate}`,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "No se pudo financiar el pago proveedor");
      }
      await onSaved("Pago proveedor financiado correctamente.");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/40 flex items-start justify-center p-4 overflow-y-auto">
      <form
        onSubmit={submit}
        className="w-full max-w-xl bg-white rounded-xl shadow-2xl my-10 border border-slate-100"
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Financiar pago proveedor</h2>
            <p className="text-xs text-slate-500">
              {event.title} - {event.containerCode ?? event.orderCode ?? "Sin referencia"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-sm text-slate-500 hover:text-slate-900 disabled:opacity-50"
          >
            Cerrar
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">Importe financiado</div>
              <div className="font-semibold text-slate-900">{eur(event.plannedAmountEur)}</div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">Estado</div>
              <div className="font-semibold text-slate-900">{event.status}</div>
            </div>
          </div>

          <label className="text-xs font-medium text-slate-600 block">
            Tipo de financiacion
            <select
              required
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as FinanceSupplierPaymentSourceType)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
            >
              <option value="cash_account">Caja / cuenta</option>
              <option value="credit_line">Linea de credito</option>
            </select>
          </label>

          <label className="text-xs font-medium text-slate-600 block">
            Fecha de movimiento
            <input
              type="date"
              required
              value={movementDate}
              onChange={(e) => setMovementDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>

          {sourceType === "cash_account" ? (
            <label className="text-xs font-medium text-slate-600 block">
              Cuenta de caja
              <select
                required
                value={cashAccountId}
                onChange={(e) => setCashAccountId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
              >
                <option value="" disabled>
                  Selecciona cuenta
                </option>
                {cashAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} - {eur(account.balance)}
                  </option>
                ))}
              </select>
              {cashAccounts.length === 0 ? (
                <span className="mt-1 block text-[11px] font-normal text-rose-600">
                  No hay cuentas/caja disponibles. Revisa finance_cash_accounts o permisos/RLS.
                </span>
              ) : null}
            </label>
          ) : null}

          {sourceType === "credit_line" ? (
            <label className="text-xs font-medium text-slate-600 block">
              Linea de credito
              <select
                required
                value={creditLineId}
                onChange={(e) => setCreditLineId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
              >
                <option value="" disabled>
                  Selecciona linea
                </option>
                {creditLines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.bankName} - {line.lineName} - libre {eur(line.availableAmount)}
                  </option>
                ))}
              </select>
              {creditLines.length === 0 ? (
                <span className="mt-1 block text-[11px] font-normal text-rose-600">
                  No hay lineas de credito disponibles. Revisa que existan lineas activas en Finanzas.
                </span>
              ) : null}
            </label>
          ) : null}

          <label className="text-xs font-medium text-slate-600 block">
            Notas
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm min-h-20"
            />
          </label>

          {error ? (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-800">
            Solo financia un pago proveedor ya pagado con caja/cuenta o linea de credito. No marca pagos ni divide la financiacion entre varias fuentes.
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Financiar"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function CreditLineRepaymentModal({
  event,
  cashAccounts,
  onClose,
  onSaved,
}: {
  event: FinancePlanningEvent;
  cashAccounts: FinanceCashAccount[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const maxAmount = event.plannedAmountEur;
  const [amount, setAmount] = useState(String(maxAmount));
  const [movementDate, setMovementDate] = useState(today);
  const [cashAccountId, setCashAccountId] = useState(cashAccounts[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setError("El importe debe ser mayor que 0.");
      return;
    }

    if (amountNumber > maxAmount) {
      setError("El importe no puede superar el saldo pendiente.");
      return;
    }

    if (!movementDate) {
      setError("Indica la fecha de pago.");
      return;
    }

    if (!cashAccountId) {
      setError("Selecciona una cuenta/caja origen.");
      return;
    }

    if (!event.creditLineId || !event.repaymentGroupId) {
      setError("Este vencimiento no tiene linea o grupo asociado.");
      return;
    }

    setSaving(true);

    try {
      const res = await fetch(`/api/finance/credit-lines/${event.creditLineId}/repay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountNumber,
          movementDate,
          cashAccountId,
          repaymentGroupId: event.repaymentGroupId,
          notes: notes.trim() ? notes.trim() : null,
          idempotencyKey: `credit-line-repayment:${event.creditLineId}:${event.repaymentGroupId}:${cashAccountId}:${amountNumber}:${movementDate}`,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "No se pudo pagar la linea");
      }
      await onSaved("Pago de linea registrado correctamente.");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/40 flex items-start justify-center p-4 overflow-y-auto">
      <form
        onSubmit={submit}
        className="w-full max-w-xl bg-white rounded-xl shadow-2xl my-10 border border-slate-100"
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Pagar linea de credito</h2>
            <p className="text-xs text-slate-500">
              {event.creditLineBank ?? "Linea"} / {event.creditLineName ?? "Sin nombre"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-sm text-slate-500 hover:text-slate-900 disabled:opacity-50"
          >
            Cerrar
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">Vencimiento</div>
              <div className="font-semibold text-slate-900">{dateLabel(event.date)}</div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">Saldo pendiente</div>
              <div className="font-semibold text-slate-900">{eur(maxAmount)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
            <label className="text-xs font-medium text-slate-600">
              Importe a pagar
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={maxAmount}
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => setAmount(String(maxAmount))}
              disabled={saving}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Pagar total
            </button>
          </div>

          <label className="text-xs font-medium text-slate-600 block">
            Fecha de pago
            <input
              type="date"
              required
              value={movementDate}
              onChange={(e) => setMovementDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>

          <label className="text-xs font-medium text-slate-600 block">
            Cuenta/caja origen
            <select
              required
              value={cashAccountId}
              onChange={(e) => setCashAccountId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
            >
              <option value="" disabled>
                Selecciona cuenta
              </option>
              {cashAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} - {eur(account.balance)} - {account.currency}
                </option>
              ))}
            </select>
            {cashAccounts.length === 0 ? (
              <span className="mt-1 block text-[11px] font-normal text-rose-600">
                No hay cuentas/caja disponibles. Revisa finance_cash_accounts o permisos/RLS.
              </span>
            ) : null}
          </label>

          <label className="text-xs font-medium text-slate-600 block">
            Notas
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm min-h-20"
            />
          </label>

          {error ? (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-800">
            Registra un pago total o parcial del vencimiento de linea usando la RPC oficial.
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar pago"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function EventCard({
  event,
  onMarkPaid,
  onFinance,
  onRepayCreditLine,
}: {
  event: FinancePlanningEvent;
  onMarkPaid: (event: FinancePlanningEvent) => void;
  onFinance: (event: FinancePlanningEvent) => void;
  onRepayCreditLine: (event: FinancePlanningEvent) => void;
}) {
  const canMarkSupplierPayment =
    event.canMarkPaid && event.status !== "pagado" && isSupplierPaymentEvent(event);
  const canFinanceSupplierPayment =
    isSupplierPaymentEvent(event) && event.status === "pagado" && !isSupplierPaymentFinanced(event);
  const financeLabel = supplierPaymentFinanceLabel(event);
  const isCreditLineEvent = event.type === "credit_line_release";
  const canRepayCreditLine = canRepayCreditLineEvent(event);

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
            {event.numeroPedidoAgente ? ` - ${event.numeroPedidoAgente}` : ""}
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClass(event.status)}`}>
          {event.status}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-slate-400">Importe</div>
          <div className="font-semibold text-slate-800">
            {isCreditLineEvent ? `Saldo a pagar: ${eur(event.plannedAmountEur)}` : eur(event.plannedAmountEur)}
          </div>
        </div>
        <div>
          <div className="text-slate-400">{isCreditLineEvent ? "Pagado" : "Fuente"}</div>
          <div className="font-semibold text-slate-800">
            {isCreditLineEvent ? eur(event.paidLineAmountEur ?? 0) : sourceLabel(event.recommendedSource)}
          </div>
        </div>
        <div>
          <div className="text-slate-400">Agente</div>
          <div className="font-medium text-slate-700 truncate">{event.agentContact ?? "Sin agente"}</div>
        </div>
        <div>
          <div className="text-slate-400">{isCreditLineEvent ? "Estado linea" : "Tipo"}</div>
          <div className="font-medium text-slate-700">
            {isCreditLineEvent
              ? event.repaymentGroupStatus ?? "Sin vencimiento"
              : logisticsTypeLabel(event.logisticsType)}
          </div>
        </div>
      </div>
      {isCreditLineEvent ? (
        <div className="mt-2 text-[11px] text-slate-500">
          {event.creditLineBank} / {event.creditLineName}
          {event.isInformational ? " - Sin vencimiento generado todavia" : ""}
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-slate-500">
          Cambio previsto: {event.plannedFxRate ? event.plannedFxRate : "Cambio previsto pendiente"}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500 line-clamp-2">{event.recommendationReason}</p>
        <div className="shrink-0 flex flex-col items-end gap-1">
          {financeLabel ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
              {financeLabel}
            </span>
          ) : null}
          {canMarkSupplierPayment ? (
            <button
              onClick={() => onMarkPaid(event)}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Pago proveedor
            </button>
          ) : null}
          {canFinanceSupplierPayment ? (
            <button
              onClick={() => onFinance(event)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <CreditCard className="h-3.5 w-3.5" />
              Financiar
            </button>
          ) : null}
          {canRepayCreditLine ? (
            <button
              onClick={() => onRepayCreditLine(event)}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
            >
              <Banknote className="h-3.5 w-3.5" />
              Pagar linea
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function FinancialPlanningPage() {
  const [data, setData] = useState<FinancePlanningResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPaymentEvent, setSelectedPaymentEvent] = useState<FinancePlanningEvent | null>(null);
  const [selectedFinanceEvent, setSelectedFinanceEvent] = useState<FinancePlanningEvent | null>(null);
  const [selectedRepaymentEvent, setSelectedRepaymentEvent] = useState<FinancePlanningEvent | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadPlanning = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/finance/planning?months=6", {
        cache: "no-store",
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Error cargando planificacion");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshAfterPayment = useCallback(async () => {
    const res = await fetch("/api/finance/planning?months=6", {
      cache: "no-store",
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "Error refrescando planificacion");
    setData(json);
  }, []);

  const openSupplierPaymentModal = useCallback((event: FinancePlanningEvent) => {
    if (!isSupplierPaymentEvent(event)) return;
    setSelectedPaymentEvent(event);
  }, []);

  const openSupplierFinanceModal = useCallback((event: FinancePlanningEvent) => {
    if (!isSupplierPaymentEvent(event)) return;
    if (event.status !== "pagado") return;
    if (isSupplierPaymentFinanced(event)) return;
    setSelectedFinanceEvent(event);
  }, []);

  const openCreditLineRepaymentModal = useCallback((event: FinancePlanningEvent) => {
    if (!canRepayCreditLineEvent(event)) return;
    setSelectedRepaymentEvent(event);
  }, []);

  const refreshAfterFinance = useCallback(async (message: string) => {
    await refreshAfterPayment();
    setSuccessMessage(message);
  }, [refreshAfterPayment]);

  const refreshAfterCreditLineRepayment = useCallback(async (message: string) => {
    await refreshAfterPayment();
    setSuccessMessage(message);
  }, [refreshAfterPayment]);

  useEffect(() => {
    loadPlanning();
  }, [loadPlanning]);

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

        {successMessage ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
            {successMessage}
          </div>
        ) : null}

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
                    <EventCard
                      key={event.id}
                      event={event}
                      onMarkPaid={openSupplierPaymentModal}
                      onFinance={openSupplierFinanceModal}
                      onRepayCreditLine={openCreditLineRepaymentModal}
                    />
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
                <EventCard
                  key={event.id}
                  event={event}
                  onMarkPaid={openSupplierPaymentModal}
                  onFinance={openSupplierFinanceModal}
                  onRepayCreditLine={openCreditLineRepaymentModal}
                />
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

      {selectedPaymentEvent && isSupplierPaymentEvent(selectedPaymentEvent) ? (
        <PaymentModal
          event={selectedPaymentEvent}
          onClose={() => setSelectedPaymentEvent(null)}
          onSaved={refreshAfterPayment}
        />
      ) : null}
      {selectedFinanceEvent && isSupplierPaymentEvent(selectedFinanceEvent) ? (
        <FinanceSupplierPaymentModal
          event={selectedFinanceEvent}
          cashAccounts={data.cashAccounts}
          creditLines={data.creditLines}
          onClose={() => setSelectedFinanceEvent(null)}
          onSaved={refreshAfterFinance}
        />
      ) : null}
      {selectedRepaymentEvent && canRepayCreditLineEvent(selectedRepaymentEvent) ? (
        <CreditLineRepaymentModal
          event={selectedRepaymentEvent}
          cashAccounts={data.cashAccounts}
          onClose={() => setSelectedRepaymentEvent(null)}
          onSaved={refreshAfterCreditLineRepayment}
        />
      ) : null}
    </main>
  );
}
