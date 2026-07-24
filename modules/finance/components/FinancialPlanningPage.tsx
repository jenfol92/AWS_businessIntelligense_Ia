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
  Search,
  Link2,
  TrendingUp,
  X,
} from "lucide-react";
import type {
  FinanceCashAccount,
  FinanceCreditLine,
  FinancePlanningEvent,
  FinancePlanningResponse,
} from "../types/planning.types";
import type { SupplierPaymentFundingSourceType } from "../types/supplierPaymentExecution.types";
import { LOGISTICS_LABELS } from "../utils/logisticsLabels";
import { resolveSupplierPaymentActuals } from "../utils/resolveSupplierPaymentActuals";
import { LinkedPurchasePaymentModal } from "./LinkedPurchasePaymentModal";
import { PurchasePaymentBatchDetailModal } from "./PurchasePaymentBatchDetailModal";

const FUNDING_SOURCE_OPTIONS: Array<{
  value: SupplierPaymentFundingSourceType;
  label: string;
}> = [
  { value: "cash_account", label: "Caja / cuenta propia" },
  { value: "credit_line", label: "Línea de crédito" },
];

const STATUS_FILTER_OPTIONS = [
  { value: "ALL", label: "Todos" },
  { value: "pendiente", label: "Pendiente" },
  { value: "parcial", label: "Parcial" },
  { value: "pagado", label: "Pagado" },
  { value: "vencido", label: "Vencido" },
  { value: "previsto", label: "Previsto" },
  { value: "proximos_30", label: "Proximos 30 dias" },
] as const;

type StatusFilter = (typeof STATUS_FILTER_OPTIONS)[number]["value"];

type FinanceFiltersState = {
  q: string;
  estado: StatusFilter;
  fechaDesde: string;
  fechaHasta: string;
};

const EMPTY_FILTERS: FinanceFiltersState = {
  q: "",
  estado: "ALL",
  fechaDesde: "",
  fechaHasta: "",
};

function eur(value: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function signedEur(value: number): string {
  const absValue = Math.abs(value);
  if (value > 0) return `+${eur(absValue)}`;
  if (value < 0) return `-${eur(absValue)}`;
  return eur(0);
}

function signedOriginalCurrency(value: number, currency: string | null | undefined): string {
  const absValue = Math.abs(value);
  const formatted = absValue.toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatted} ${currency ?? ""}`.trim();
}

function dateLabel(value: string | null): string {
  if (!value) return "Fecha pendiente";
  return new Date(`${value}T00:00:00`).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
  });
}

function normalizeSearch(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function eventMatchesQuery(event: FinancePlanningEvent, query: string): boolean {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return true;

  return [
    event.orderCode,
    event.numeroPedidoAgente,
    event.agentContact,
    event.containerCode,
    event.creditLineBank,
    event.creditLineName,
  ].some((value) => normalizeSearch(value).includes(normalizedQuery));
}

function eventMatchesStatus(event: FinancePlanningEvent, estado: StatusFilter): boolean {
  if (estado === "ALL") return true;

  if (estado === "proximos_30") {
    if (event.type !== "credit_line_release" || !event.date || event.status === "pagado") {
      return false;
    }

    const today = new Date().toISOString().slice(0, 10);
    return event.date >= today && event.date <= addDaysIso(today, 30);
  }

  if (estado === "vencido") {
    if (!event.date || event.status === "pagado") return false;
    const today = new Date().toISOString().slice(0, 10);
    return event.status === "vencido" || event.date < today;
  }

  return event.status === estado;
}

function eventMatchesDateRange(
  event: FinancePlanningEvent,
  fechaDesde: string,
  fechaHasta: string,
): boolean {
  if (!fechaDesde && !fechaHasta) return true;
  if (!event.date) return false;
  if (fechaDesde && event.date < fechaDesde) return false;
  if (fechaHasta && event.date > fechaHasta) return false;
  return true;
}

function eventMatchesFilters(event: FinancePlanningEvent, filters: FinanceFiltersState): boolean {
  return eventMatchesQuery(event, filters.q)
    && eventMatchesStatus(event, filters.estado)
    && eventMatchesDateRange(event, filters.fechaDesde, filters.fechaHasta);
}

function sourceLabel(source: FinancePlanningEvent["recommendedSource"]): string {
  if (source === "cash") return "Caja propia";
  if (source === "caja_rural") return "Caja Rural";
  if (source === "la_caixa") return "La Caixa";
  if (source === "bbva") return "BBVA";
  return "Sin fuente";
}

function statusClass(status: FinancePlanningEvent["status"]): string {
  if (status === "pagado") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "parcial") return "bg-violet-50 text-violet-700 border-violet-200";
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

function supplierPaymentFinanceLabel(event: FinancePlanningEvent): string | null {
  if (event.hasMixedPaymentSources) return "Varias fuentes";
  if (event.paymentSourceType === "cash_account") return "Financiado con caja";
  if (event.paymentSourceType === "credit_line") return "Financiado con linea";
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
  cashAccounts,
  creditLines,
  onClose,
  onSaved,
}: {
  event: FinancePlanningEvent;
  cashAccounts: FinanceCashAccount[];
  creditLines: FinanceCreditLine[];
  onClose: () => void;
  onSaved: (batchId: string | null, reference: string | null) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const isEurPayment = event.originalCurrency.trim().toUpperCase() === "EUR";
  const originalAmount = event.pendingAmountOriginal ?? event.originalAmount ?? 0;
  const activeCreditLines = creditLines.filter(
    (line) => ["activa", "activo", "active"].includes(line.status.trim().toLowerCase()),
  );
  const [sourceType, setSourceType] =
    useState<SupplierPaymentFundingSourceType | "">("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [creditLineId, setCreditLineId] = useState("");
  const [actualFxRate, setActualFxRate] = useState(isEurPayment ? "1" : "");
  const [actualAmountEur, setActualAmountEur] = useState(
    isEurPayment && originalAmount > 0 ? String(originalAmount) : "",
  );
  const [bankFeeEur, setBankFeeEur] = useState("");
  const [ffFeeEur, setFfFeeEur] = useState("");
  const [bankReference, setBankReference] = useState("");
  const [paidAt, setPaidAt] = useState(today);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actualFxRateNumber = actualFxRate.trim() ? Number(actualFxRate) : null;
  const actualAmountEurNumber = actualAmountEur.trim() ? Number(actualAmountEur) : null;
  let resolvedActualAmountEur = 0;
  let resolvedActualFxRate: number | null = null;
  try {
    const resolved = resolveSupplierPaymentActuals({
      amountOriginal: originalAmount,
      currencyOriginal: event.originalCurrency,
      actualFxRate: actualFxRateNumber,
      actualAmountEur: actualAmountEurNumber,
    });
    resolvedActualAmountEur = resolved.actualAmountEur;
    resolvedActualFxRate = resolved.actualFxRate;
  } catch {
    // La validación al enviar muestra el error concreto; el preview queda pendiente.
  }
  const bankFeeNumber = bankFeeEur.trim() ? Number(bankFeeEur) : 0;
  const ffFeeNumber = ffFeeEur.trim() ? Number(ffFeeEur) : 0;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
      setError(`El importe original ${event.originalCurrency} debe ser mayor que 0.`);
      return;
    }

    if (!sourceType) {
      setError("Selecciona explícitamente una fuente financiera.");
      return;
    }
    if (sourceType === "cash_account" && !cashAccountId) {
      setError("Selecciona una caja o cuenta propia.");
      return;
    }
    if (sourceType === "credit_line" && !creditLineId) {
      setError("Selecciona una línea de crédito activa.");
      return;
    }

    if (
      !isEurPayment &&
      actualFxRateNumber == null &&
      actualAmountEurNumber == null
    ) {
      setError("Introduce el tipo de cambio real o el importe EUR real.");
      return;
    }

    if (
      actualFxRateNumber != null &&
      (!Number.isFinite(actualFxRateNumber) || actualFxRateNumber <= 0)
    ) {
      setError("Tipo de cambio real debe ser mayor que 0.");
      return;
    }

    if (
      actualAmountEurNumber != null &&
      (!Number.isFinite(actualAmountEurNumber) || actualAmountEurNumber <= 0)
    ) {
      setError("Importe EUR real debe ser mayor que 0.");
      return;
    }

    try {
      resolveSupplierPaymentActuals({
        amountOriginal: originalAmount,
        currencyOriginal: event.originalCurrency,
        actualFxRate: actualFxRateNumber,
        actualAmountEur: actualAmountEurNumber,
      });
    } catch (validationError) {
      setError(
        validationError instanceof Error &&
          validationError.message === "INCONSISTENT_ACTUAL_VALUES"
          ? "El tipo de cambio y el importe EUR real no son coherentes."
          : "Los importes reales no son válidos.",
      );
      return;
    }

    if (bankFeeEur.trim() && (!Number.isFinite(bankFeeNumber) || bankFeeNumber < 0)) {
      setError("Comision bancaria debe ser mayor o igual que 0.");
      return;
    }

    if (ffFeeEur.trim() && (!Number.isFinite(ffFeeNumber) || ffFeeNumber < 0)) {
      setError("Gastos FF debe ser mayor o igual que 0.");
      return;
    }

    setSaving(true);

    try {
      const res = await fetch(
        `/api/finance/supplier-payments/${event.id}/mark-paid`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: event.orderId,
            actualFxRate: isEurPayment ? undefined : actualFxRateNumber,
            actualAmountEur: isEurPayment ? undefined : actualAmountEurNumber,
            sourceType,
            cashAccountId: sourceType === "cash_account" ? cashAccountId : null,
            creditLineId: sourceType === "credit_line" ? creditLineId : null,
            paidAt,
            bankReference: bankReference.trim() || null,
            bankFeeEur: bankFeeEur.trim() ? Number(bankFeeEur) : null,
            ffFeeEur: ffFeeEur.trim() ? Number(ffFeeEur) : null,
            notes: notes.trim() ? notes.trim() : null,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "No se pudo marcar el pago");
      }
      await onSaved(
        json.financing?.batch_id ? String(json.financing.batch_id) : null,
        bankReference.trim() || null,
      );
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
            <h2 className="text-base font-semibold text-slate-900">
              Pagar obligación al agente
            </h2>
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
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
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
              <div className="text-xs text-slate-500">Pagado anteriormente</div>
              <div className="font-semibold text-slate-900">
                {(event.allocatedAmountOriginal ?? 0).toLocaleString("es-ES", {
                  maximumFractionDigits: 2,
                })}{" "}
                {event.originalCurrency}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">Pendiente que se pagará ahora</div>
              <div className="font-semibold text-slate-900">
                {originalAmount.toLocaleString("es-ES", { maximumFractionDigits: 2 })}{" "}
                {event.originalCurrency}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 sm:col-span-3">
              <div className="text-xs text-slate-500">EUR real</div>
              <div className="font-semibold text-slate-900">
                Pendiente de pago
              </div>
              {event.plannedAmountEur > 0 ? (
                <div className="text-[11px] text-slate-500">
                  Estimación legacy: {eur(event.plannedAmountEur)}
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs font-medium text-slate-600">
              Tipo de cambio real
              <input
                type="number"
                step="0.000001"
                min="0.000001"
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
              Importe EUR real
              <input
                type="number"
                step="0.01"
                min="0.01"
                disabled={isEurPayment}
                value={actualAmountEur}
                onChange={(e) => setActualAmountEur(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                placeholder="Alternativa al tipo de cambio"
              />
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
              Gastos FF
              <input
                type="number"
                step="0.01"
                min="0"
                value={ffFeeEur}
                onChange={(e) => setFfFeeEur(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="EUR"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Fuente financiera
              <select
                required
                value={sourceType}
                onChange={(e) => {
                  const next = e.target.value as SupplierPaymentFundingSourceType | "";
                  setSourceType(next);
                  setCashAccountId("");
                  setCreditLineId("");
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
              >
                <option value="">Selecciona una fuente</option>
                {FUNDING_SOURCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {sourceType === "cash_account" ? (
              <label className="text-xs font-medium text-slate-600">
                Caja / cuenta propia
                <select
                  required
                  value={cashAccountId}
                  onChange={(e) => setCashAccountId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
                >
                  <option value="">Selecciona una cuenta</option>
                  {cashAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({eur(account.balance)})
                    </option>
                  ))}
                </select>
              </label>
            ) : sourceType === "credit_line" ? (
              <label className="text-xs font-medium text-slate-600">
                Línea de crédito
                <select
                  required
                  value={creditLineId}
                  onChange={(e) => setCreditLineId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
                >
                  <option value="">Selecciona una línea</option>
                  {activeCreditLines.map((line) => (
                    <option key={line.id} value={line.id}>
                      {line.bankName} / {line.lineName} (disp. {eur(line.availableAmount)})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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
            <label className="text-xs font-medium text-slate-600">
              Referencia bancaria
              <input
                value={bankReference}
                onChange={(e) => setBankReference(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="Opcional"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
            <div>
              <div className="text-slate-500">Equivalente EUR calculado</div>
              <div className="font-semibold text-slate-900">
                {eur(Number.isFinite(resolvedActualAmountEur) ? resolvedActualAmountEur : 0)}
              </div>
              <div className="text-[10px] text-slate-500">
                FX: {resolvedActualFxRate != null && Number.isFinite(resolvedActualFxRate)
                  ? resolvedActualFxRate.toFixed(6)
                  : "pendiente"}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Comision bancaria EUR</div>
              <div className="font-semibold text-slate-900">{eur(Number.isFinite(bankFeeNumber) ? bankFeeNumber : 0)}</div>
            </div>
            <div>
              <div className="text-slate-500">Gastos FF EUR</div>
              <div className="font-semibold text-slate-900">{eur(Number.isFinite(ffFeeNumber) ? ffFeeNumber : 0)}</div>
            </div>
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
            El pago, su aplicación a la obligación y el movimiento de caja o disposición de crédito se registrarán atómicamente.
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
  onRepayCreditLine,
  onViewBatch,
}: {
  event: FinancePlanningEvent;
  onMarkPaid: (event: FinancePlanningEvent) => void;
  onRepayCreditLine: (event: FinancePlanningEvent) => void;
  onViewBatch: (batchId: string) => void;
}) {
  const canMarkSupplierPayment =
    event.canMarkPaid && event.status !== "pagado" && isSupplierPaymentEvent(event);
  const financeLabel = supplierPaymentFinanceLabel(event);
  const isCreditLineEvent = event.type === "credit_line_release";
  const canRepayCreditLine = canRepayCreditLineEvent(event);
  const showSupplierPaymentTrace = isSupplierPaymentEvent(event);

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
          <div className="text-slate-400">
            {showSupplierPaymentTrace ? "Importe original" : "Importe"}
          </div>
          <div className="font-semibold text-slate-800">
            {showSupplierPaymentTrace
              ? signedOriginalCurrency(event.originalAmount ?? 0, event.originalCurrency).replace("+", "")
              : isCreditLineEvent
                ? `Saldo a pagar: ${eur(event.plannedAmountEur)}`
                : eur(event.plannedAmountEur)}
          </div>
          {showSupplierPaymentTrace ? (
            <div className="mt-1 text-[11px] text-slate-500">
              Pagado: {signedOriginalCurrency(event.allocatedAmountOriginal ?? 0, event.originalCurrency).replace("+", "")}
              {" · "}Pendiente: {signedOriginalCurrency(event.pendingAmountOriginal ?? event.originalAmount ?? 0, event.originalCurrency).replace("+", "")}
            </div>
          ) : null}
        </div>
        <div>
          <div className="text-slate-400">
            {showSupplierPaymentTrace ? "EUR real" : isCreditLineEvent ? "Pagado" : "Fuente"}
          </div>
          <div className="font-semibold text-slate-800">
            {showSupplierPaymentTrace
              ? event.actualAmountEur != null
                ? eur(event.actualAmountEur)
                : event.status === "pagado"
                  ? "Legacy no verificado"
                  : "Pendiente de pago"
              : isCreditLineEvent
                ? eur(event.paidLineAmountEur ?? 0)
                : sourceLabel(event.recommendedSource)}
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
          {showSupplierPaymentTrace
            ? event.plannedAmountEur > 0
              ? `Estimación EUR legacy: ${eur(event.plannedAmountEur)}`
              : "Sin estimación EUR"
            : `Cambio previsto: ${event.plannedFxRate ?? "pendiente"}`}
        </div>
      )}
      {showSupplierPaymentTrace ? (
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
          <div>
            <span className="block text-slate-400">Tipo de cambio real</span>
            <b>{event.actualFxRate ?? "-"}{event.actualFxRateIsWeighted ? " (medio ponderado)" : ""}</b>
          </div>
          <div>
            <span className="block text-slate-400">Fecha efectiva</span>
            <b>{event.paidAt ? event.paidAt.slice(0, 10) : "-"}</b>
          </div>
          <div>
            <span className="block text-slate-400">Referencia bancaria</span>
            <b>{event.bankReference ?? "-"}</b>
          </div>
          <div>
            <span className="block text-slate-400">EUR real pagado orden</span>
            <b>{event.orderPaidRealEur != null ? eur(event.orderPaidRealEur) : "-"}</b>
          </div>
          <div>
            <span className="block text-slate-400">Comisión bancaria separada</span>
            <b>{event.bankFeeEur != null ? eur(event.bankFeeEur) : "-"}</b>
          </div>
          <div>
            <span className="block text-slate-400">Gastos FF</span>
            <b>{event.ffFeeEur != null ? eur(event.ffFeeEur) : "-"}</b>
          </div>
          <div>
            <span className="block text-slate-400">Pagos vinculados</span>
            <b>{event.linkedBatchCount ?? 0}</b>
          </div>
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500 line-clamp-2">{event.recommendationReason}</p>
        <div className="shrink-0 flex flex-col items-end gap-1">
          {financeLabel ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
              {financeLabel}
            </span>
          ) : null}
          {event.latestBatchId ? (
            <button
              type="button"
              onClick={() => onViewBatch(event.latestBatchId!)}
              className="inline-flex items-center gap-1 border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Ver pagos vinculados
            </button>
          ) : null}
          {canMarkSupplierPayment ? (
            <button
              onClick={() => onMarkPaid(event)}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Pagar obligación
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
  const [selectedPaymentEvent, setSelectedPaymentEvent] =
    useState<FinancePlanningEvent | null>(null);
  const [selectedRepaymentEvent, setSelectedRepaymentEvent] = useState<FinancePlanningEvent | null>(null);
  const [linkedPaymentOpen, setLinkedPaymentOpen] = useState(false);
  const [detailBatchId, setDetailBatchId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState<FinanceFiltersState>(EMPTY_FILTERS);
  const [urlFiltersReady, setUrlFiltersReady] = useState(false);

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

  const reloadPlanning = useCallback(async () => {
    const res = await fetch("/api/finance/planning?months=6", {
      cache: "no-store",
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "Error refrescando planificacion");
    setData(json);
  }, []);

  const openSupplierPaymentModal = useCallback((event: FinancePlanningEvent) => {
    if (!isSupplierPaymentEvent(event)) return;
    if (event.status === "pagado") return;
    setSelectedPaymentEvent(event);
  }, []);

  const openCreditLineRepaymentModal = useCallback((event: FinancePlanningEvent) => {
    if (!canRepayCreditLineEvent(event)) return;
    setSelectedRepaymentEvent(event);
  }, []);

  const refreshAfterCreditLineRepayment = useCallback(async (message: string) => {
    await reloadPlanning();
    setSuccessMessage(message);
  }, [reloadPlanning]);

  const refreshAfterIndividualPayment = useCallback(async (
    batchId: string | null,
    reference: string | null,
  ) => {
    await reloadPlanning();
    setSuccessMessage(
      `Pago proveedor registrado (${reference || batchId || "sin referencia"}). Planificación y saldos actualizados.`,
    );
  }, [reloadPlanning]);

  const refreshAfterLinkedPayment = useCallback(async (batchId: string, reference: string | null) => {
    try {
      await reloadPlanning();
      setSuccessMessage(
        `Pago vinculado registrado (${reference || batchId}). Planificación y saldos actualizados.`,
      );
    } catch {
      setSuccessMessage(
        `Pago vinculado registrado (${reference || batchId}), pero la pantalla no pudo actualizarse. Recarga los datos; no repitas el pago.`,
      );
    }
  }, [reloadPlanning]);

  useEffect(() => {
    loadPlanning();
  }, [loadPlanning]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const estadoParam = params.get("estado")?.trim();
    const estado = STATUS_FILTER_OPTIONS.some((option) => option.value === estadoParam)
      ? (estadoParam as StatusFilter)
      : "ALL";

    setFilters({
      q: params.get("q")?.trim() ?? "",
      estado,
      fechaDesde: params.get("fechaDesde")?.trim() ?? "",
      fechaHasta: params.get("fechaHasta")?.trim() ?? "",
    });
    setUrlFiltersReady(true);
  }, []);

  useEffect(() => {
    if (!urlFiltersReady) return;

    const params = new URLSearchParams(window.location.search);
    params.delete("q");
    params.delete("estado");
    params.delete("fechaDesde");
    params.delete("fechaHasta");

    if (filters.q.trim()) params.set("q", filters.q.trim());
    if (filters.estado !== "ALL") params.set("estado", filters.estado);
    if (filters.fechaDesde) params.set("fechaDesde", filters.fechaDesde);
    if (filters.fechaHasta) params.set("fechaHasta", filters.fechaHasta);

    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState(null, "", nextUrl);
  }, [filters, urlFiltersReady]);

  const allPendingDateEvents = useMemo(
    () => data?.pendingDateEvents ?? [],
    [data],
  );

  const filteredMonths = useMemo(
    () =>
      data?.months.map((month) => ({
        ...month,
        events: month.events.filter((event) => eventMatchesFilters(event, filters)),
      })) ?? [],
    [data, filters],
  );

  const filteredPendingDateEvents = useMemo(
    () => allPendingDateEvents.filter((event) => eventMatchesFilters(event, filters)),
    [allPendingDateEvents, filters],
  );

  const filteredResultsCount = useMemo(
    () =>
      filteredMonths.reduce((sum, month) => sum + month.events.length, 0)
      + filteredPendingDateEvents.length,
    [filteredMonths, filteredPendingDateEvents],
  );

  const hasActiveFilters =
    Boolean(filters.q.trim()) ||
    filters.estado !== "ALL" ||
    Boolean(filters.fechaDesde) ||
    Boolean(filters.fechaHasta);

  const updateFilter = useCallback(
    <K extends keyof FinanceFiltersState>(key: K, value: FinanceFiltersState[K]) => {
      setFilters((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
  }, []);

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
            <button
              type="button"
              onClick={() => setLinkedPaymentOpen(true)}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <Link2 className="h-4 w-4" />
              Crear pago vinculado
            </button>
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
                {line.cycleDays ? `Ciclo aprox. ${line.cycleDays} dias.` : "Fechas configuradas"} Coste pendiente de configurar.
              </p>
            </div>
          ))}
        </section>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Cambio previsto global USD/EUR: {data.summary.plannedUsdEurRate ?? "pendiente de configurar"}.
          Es una referencia estimada y nunca sustituye el cambio bancario real de cada pago.
        </div>

        {successMessage ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
            {successMessage}
          </div>
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(240px,1.4fr)_180px_160px_160px_auto] lg:items-end">
            <label className="text-xs font-medium text-slate-600">
              Buscar
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <Search className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  type="search"
                  value={filters.q}
                  onChange={(e) => updateFilter("q", e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  placeholder="Buscar orden, pedido agente, proveedor, contenedor..."
                />
              </div>
            </label>

            <label className="text-xs font-medium text-slate-600">
              Estado
              <select
                value={filters.estado}
                onChange={(e) => updateFilter("estado", e.target.value as StatusFilter)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              >
                {STATUS_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-medium text-slate-600">
              Desde
              <input
                type="date"
                value={filters.fechaDesde}
                onChange={(e) => updateFilter("fechaDesde", e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
              />
            </label>

            <label className="text-xs font-medium text-slate-600">
              Hasta
              <input
                type="date"
                value={filters.fechaHasta}
                onChange={(e) => updateFilter("fechaHasta", e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
              />
            </label>

            <button
              type="button"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-4 w-4" />
              Limpiar filtros
            </button>
          </div>
          <div className="mt-3 text-xs font-medium text-slate-500">
            {filteredResultsCount} resultados
          </div>
        </section>

        {hasActiveFilters && filteredResultsCount === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
            No hay órdenes/vencimientos que coincidan con los filtros.
          </div>
        ) : null}

        <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {filteredMonths.map((month) => (
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
                      onRepayCreditLine={openCreditLineRepaymentModal}
                      onViewBatch={setDetailBatchId}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </section>

        {filteredPendingDateEvents.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Package className="h-4 w-4" />
              Fecha pendiente
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredPendingDateEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onMarkPaid={openSupplierPaymentModal}
                  onRepayCreditLine={openCreditLineRepaymentModal}
                  onViewBatch={setDetailBatchId}
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
            <p>La recomendacion usa disponibilidad suficiente y prioridad configurada, no coste.</p>
            <p>Una linea no se usa para pagar otra linea; las liberaciones salen de caja propia.</p>
            <p>La caja propia se reserva para liberar lineas y cubrir pagos no financiables.</p>
          </div>
        </section>
      </div>

      {selectedPaymentEvent && isSupplierPaymentEvent(selectedPaymentEvent) ? (
        <PaymentModal
          event={selectedPaymentEvent}
          cashAccounts={data.cashAccounts}
          creditLines={data.creditLines}
          onClose={() => setSelectedPaymentEvent(null)}
          onSaved={refreshAfterIndividualPayment}
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
      {linkedPaymentOpen ? (
        <LinkedPurchasePaymentModal
          onClose={() => setLinkedPaymentOpen(false)}
          onSaved={refreshAfterLinkedPayment}
        />
      ) : null}
      {detailBatchId ? (
        <PurchasePaymentBatchDetailModal
          batchId={detailBatchId}
          onClose={() => setDetailBatchId(null)}
        />
      ) : null}
    </main>
  );
}
