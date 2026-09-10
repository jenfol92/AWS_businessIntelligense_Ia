"use client";
import { planningRequest } from "../utils/planningRequest";
import { accountingDate } from "../utils/accountingDate";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  creditLineNonDrawdownDebtLabel,
  isActiveCreditLineStatus,
} from "../utils/creditLineStatus";
import { RecurringPaymentModal } from "./RecurringPaymentModal";
import { buildMonthlyTotals } from "../utils/buildMonthlyTotals";
import { unvaluedPayments } from "../utils/monthlyPaymentSummary";
import { LinkedPurchasePaymentModal } from "./LinkedPurchasePaymentModal";
import { PurchasePaymentBatchDetailModal } from "./PurchasePaymentBatchDetailModal";
import { CreditLineMaturityPaymentModal } from "./CreditLineMaturityPaymentModal";
import type { CreditLineMaturity } from "../types/creditLineMaturities.types";

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
    event.title,
    event.plannedMaturityReference,
  ].some((value) => normalizeSearch(value).includes(normalizedQuery));
}

function eventMatchesStatus(event: FinancePlanningEvent, estado: StatusFilter): boolean {
  if (estado === "ALL") return true;

  if (estado === "proximos_30") {
    if (!["credit_line_maturity","credit_line_planned_maturity"].includes(event.type) || !event.date || event.status === "pagado") {
      return false;
    }

    const today = accountingDate();
    return event.date >= today && event.date <= addDaysIso(today, 30);
  }

  if (estado === "vencido") {
    if (!event.date || event.status === "pagado") return false;
    const today = accountingDate();
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
  if (["credit_line_maturity", "credit_line_planned_maturity", "credit_line_repayment_settlement"].includes(event.type)) return "border-l-indigo-500";
  if (event.type === "credit_line_release") return "border-l-slate-300";
  if (event.status === "pagado") return "border-l-emerald-400";
  if (event.status === "vencido") return "border-l-rose-400";
  return "border-l-amber-400";
}

function eventCategoryLabel(event: FinancePlanningEvent): string {
  if (event.type === "supplier_deposit" || event.obligationCategory === "deposits") return "PROVEEDOR · DEPÓSITO";
  if (event.type === "supplier_balance" || event.obligationCategory === "balances") return "PROVEEDOR · BALANCE";
  if (event.isLegacyOpeningBalance && ["credit_line_maturity", "credit_line_repayment_settlement"].includes(event.type)) return "CRÉDITO · DEUDA INICIAL";
  if (["credit_line_maturity", "credit_line_planned_maturity", "credit_line_repayment_settlement"].includes(event.type)) return "CRÉDITO · VENCIMIENTO";
  if (event.type === "amazon_income") return `AMAZON · ${{RECEIVED:"RECIBIDO",PENDING_BANK:"TRANSFERENCIA EN CURSO",AVAILABLE:"DISPONIBLE PARA SOLICITAR",DEFERRED:"DIFERIDO",FUTURE:"FUTURO",LEGACY_CONFIRMED:"HISTORICO SIN CLASIFICAR"}[event.amazonStatus??"FUTURE"]}`;
  return "OTROS · OBLIGACIÓN";
}

function knownEur(value: number | null | undefined): string {
  return value == null ? "EUR unavailable" : eur(value);
}

function originalMoney(value:number,currency:string){return `${new Intl.NumberFormat("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2}).format(value)} ${currency}`;}

function combinedKnownEur(...values: Array<number | null | undefined>): string {
  const known = values.filter((value): value is number => value != null);
  return known.length === 0 ? "Pendiente" : eur(known.reduce((sum, value) => sum + value, 0));
}

function eventToMaturity(event: FinancePlanningEvent): CreditLineMaturity {
  return {
    id: event.id,
    creditLineId: event.creditLineId ?? "",
    repaymentGroupId: event.repaymentGroupId ?? "",
    bankName: event.creditLineBank ?? "",
    lineName: event.creditLineName ?? "",
    creditLimit: 0,
    lineStatus: "active",
    lineAllowsDrawdown: true,
    dueDate: event.date ?? "",
    originalAmountEur: event.originalAmountEur ?? event.plannedAmountEur,
    paidAmountEur: event.paidLineAmountEur ?? 0,
    remainingAmountEur: event.remainingAmountEur ?? event.plannedAmountEur,
    groupStatus: event.repaymentGroupStatus === "partially_paid" ? "partially_paid" : "open",
    displayStatus: event.status === "vencido" ? "vencido" : event.status === "parcial" ? "parcial" : "pendiente",
    visualStatus: event.status === "vencido" ? "overdue" : event.status === "parcial" ? "partial" : "pending",
    daysUntilDue: event.daysUntilDue ?? 0,
    movementCount: event.movementCount ?? 0,
    financedOrderCount: event.financedOrderCount ?? 0,
    financedOrderCodes: event.financedOrderCodes ?? [],
    canRepay: event.canRepay ?? false,
    isLegacyOpeningBalance: event.isLegacyOpeningBalance ?? false,
    expectedInterestEur: event.expectedInterestEur ?? null,
    expectedFeesEur: event.expectedFeesEur ?? null,
  };
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
  const today = accountingDate();
  const isEurPayment = event.originalCurrency.trim().toUpperCase() === "EUR";
  const originalAmount = event.pendingAmountOriginal ?? event.originalAmount ?? 0;
  const activeCreditLines = creditLines.filter((line) =>
    isActiveCreditLineStatus(line.status),
  );
  const [sourceType, setSourceType] =
    useState<SupplierPaymentFundingSourceType | "">("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [creditLineId, setCreditLineId] = useState("");
  const [manualDueDate, setManualDueDate] = useState("");
  const [actualFxForeignPerEur, setActualFxForeignPerEur] = useState(isEurPayment ? "1" : "");
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
  const paymentIdempotencyKey = useRef<string | null>(null);
  if (!paymentIdempotencyKey.current) paymentIdempotencyKey.current = crypto.randomUUID();
  const actualFxForeignPerEurNumber = actualFxForeignPerEur.trim() ? Number(actualFxForeignPerEur) : null;
  const actualAmountEurNumber = actualAmountEur.trim() ? Number(actualAmountEur) : null;
  let resolvedActualAmountEur = 0;
  let resolvedActualFxRate: number | null = null;
  try {
    const resolved = resolveSupplierPaymentActuals({
      amountOriginal: originalAmount,
      currencyOriginal: event.originalCurrency,
      actualFxForeignPerEur: actualFxForeignPerEurNumber,
      actualAmountEur: actualAmountEurNumber,
    });
    resolvedActualAmountEur = resolved.actualAmountEur;
    resolvedActualFxRate = resolved.actualFxRate;
  } catch {
    // La validación al enviar muestra el error concreto; el preview queda pendiente.
  }
  const bankFeeNumber = bankFeeEur.trim() ? Number(bankFeeEur) : 0;
  const ffFeeNumber = ffFeeEur.trim() ? Number(ffFeeEur) : 0;
  const selectedCreditLine =
    activeCreditLines.find((line) => line.id === creditLineId) ?? null;
  const needsManualDueDate =
    sourceType === "credit_line"
    && selectedCreditLine != null
    && selectedCreditLine.cycleDays == null;

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
    if (needsManualDueDate) {
      if (!manualDueDate || !/^\d{4}-\d{2}-\d{2}$/.test(manualDueDate)) {
        setError("Indica la fecha de vencimiento de la disposición.");
        return;
      }
      const due = new Date(`${manualDueDate}T00:00:00.000Z`);
      if (Number.isNaN(due.getTime()) || due.toISOString().slice(0, 10) !== manualDueDate) {
        setError("La fecha de vencimiento de la disposición no es valida.");
        return;
      }
      if (manualDueDate < paidAt) {
        setError("El vencimiento de la disposición debe ser igual o posterior a la fecha de pago.");
        return;
      }
    }

    if (
      !isEurPayment &&
      actualFxForeignPerEurNumber == null &&
      actualAmountEurNumber == null
    ) {
      setError("Introduce el tipo de cambio real o el importe EUR real.");
      return;
    }

    if (
      actualFxForeignPerEurNumber != null &&
      (!Number.isFinite(actualFxForeignPerEurNumber) || actualFxForeignPerEurNumber <= 0)
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
        actualFxForeignPerEur: actualFxForeignPerEurNumber,
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
            idempotencyKey: paymentIdempotencyKey.current,
            orderId: event.orderId,
            actualFxForeignPerEur: isEurPayment ? undefined : actualFxForeignPerEurNumber,
            actualFxRate: isEurPayment ? undefined : resolvedActualFxRate,
            actualAmountEur: isEurPayment ? undefined : actualAmountEurNumber,
            sourceType,
            cashAccountId: sourceType === "cash_account" ? cashAccountId : null,
            creditLineId: sourceType === "credit_line" ? creditLineId : null,
            manualDueDate:
              sourceType === "credit_line" && needsManualDueDate ? manualDueDate : null,
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
                value={actualFxForeignPerEur}
                onChange={(e) => setActualFxForeignPerEur(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                placeholder="Ej. 1.17"
              />
              <span className="mt-1 block text-[11px] font-normal text-slate-500">
                {isEurPayment
                  ? "Pago en EUR, no requiere tipo de cambio."
                  : `1 EUR = X ${event.originalCurrency}. Se conserva el inverso en actual_fx_rate legacy.`}
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
                  onChange={(e) => {
                    setCreditLineId(e.target.value);
                    setManualDueDate("");
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
                >
                  <option value="">Selecciona una línea</option>
                  {activeCreditLines.map((line) => (
                    <option key={line.id} value={line.id}>
                      {line.bankName} / {line.lineName} (disp. {eur(line.availableAmount)})
                      {line.cycleDays == null ? " · vencimiento manual" : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {needsManualDueDate ? (
              <label className="text-xs font-medium text-slate-600 sm:col-span-2">
                Fecha de vencimiento de la disposición
                <input
                  type="date"
                  required
                  value={manualDueDate}
                  min={paidAt}
                  onChange={(e) => setManualDueDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                <span className="mt-1 block text-[11px] font-normal text-slate-500">
                  Obligatoria porque la línea no tiene cycle_days. Debe ser &gt;= fecha de pago.
                </span>
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

function EventCard({
  event,
  onMarkPaid,
  onViewBatch,
  onPayMaturity,
}: {
  event: FinancePlanningEvent;
  onMarkPaid: (event: FinancePlanningEvent) => void;
  onViewBatch: (batchId: string) => void;
  onPayMaturity: (event: FinancePlanningEvent) => void;
}) {
  const canMarkSupplierPayment =
    event.canMarkPaid && event.status !== "pagado" && isSupplierPaymentEvent(event);
  const financeLabel = supplierPaymentFinanceLabel(event);
  const isCreditLineMaturity = event.type === "credit_line_maturity";
  const isPlannedCreditMaturity = event.type === "credit_line_planned_maturity";
  const isCreditLineInfo = event.type === "credit_line_release";
  const isCreditLineEvent = isCreditLineMaturity || isPlannedCreditMaturity || isCreditLineInfo;
  const showSupplierPaymentTrace = isSupplierPaymentEvent(event);

  if (event.type === "unlinked_obligation" || event.type === "unlinked_payment_settlement") {
    return <article className="rounded-lg border border-slate-200 border-l-4 border-l-emerald-500 bg-white p-3 shadow-sm">
      <div className="flex justify-between gap-2"><span className="text-xs font-semibold text-emerald-700">{event.paymentTypeName ?? "Pago recurrente"}</span><span className={statusClass(event.status)}>{event.status}</span></div>
      <h3 className="mt-2 font-semibold text-slate-900">{event.title}</h3><p className="text-xs text-slate-500">{dateLabel(event.date)}</p>
      <p className="my-3 text-sm font-bold">{event.status === "pagado" ? "Pagado" : "Pendiente"}: {eur(event.status === "pagado" ? event.paidAmountEur ?? 0 : event.plannedAmountEur)}</p>
      {event.canMarkPaid && event.status !== "pagado" && <button type="button" onClick={() => onMarkPaid(event)} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Registrar pago</button>}
    </article>;
  }
  if (isPlannedCreditMaturity) {
    return (
      <article className={`bg-white border border-slate-200 border-l-4 ${eventAccent(event)} rounded-lg p-3 shadow-sm`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><div className="mb-1 text-[10px] font-bold tracking-wide text-indigo-600">{eventCategoryLabel(event)}</div><div className="flex items-center gap-2 text-xs text-slate-500"><CalendarDays className="h-3.5 w-3.5" /><span>{dateLabel(event.date)}</span></div><h3 className="mt-1 truncate text-sm font-semibold text-slate-900">{event.title}</h3><p className="text-xs text-slate-500">{event.creditLineBank} / {event.creditLineName}</p></div>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClass(event.status)}`}>{event.status}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div><div className="text-slate-400">Principal previsto</div><b>{eur(event.plannedPrincipalEur ?? 0)}</b></div>
          <div><div className="text-slate-400">Salida total prevista</div><b>{eur(event.plannedCashOutEur ?? 0)}</b></div>
          <div><div className="text-slate-400">Intereses previstos</div><b>{knownEur(event.expectedInterestEur)}</b></div>
          <div><div className="text-slate-400">Comisiones previstas</div><b>{knownEur(event.expectedFeesEur)}</b></div>
          <div><div className="text-slate-400">Crédito previsto a liberar</div><b>{eur(event.plannedCreditReleaseEur ?? 0)}</b></div>
          <div><div className="text-slate-400">Estado de la previsión</div><b>{event.status === "vencido" ? "vencido" : "previsto"}</b></div>
        </div>
        {event.plannedMaturityReference ? <div className="mt-2 text-[11px] text-slate-500">Referencia: {event.plannedMaturityReference}</div> : null}
      </article>
    );
  }

  if (event.isLegacyOpeningBalance && (isCreditLineMaturity || event.type === "credit_line_repayment_settlement")) {
    const principal = isCreditLineMaturity
      ? event.remainingAmountEur ?? event.plannedAmountEur
      : event.plannedPrincipalEur ?? event.plannedAmountEur;
    const totalKnown = principal + (event.expectedInterestEur ?? 0) + (event.expectedFeesEur ?? 0);
    const stateLabel = event.status === "parcial"
      ? "parcialmente pagado"
      : event.status;
    return (
      <article className={`rounded-lg border border-slate-200 border-l-4 ${eventAccent(event)} bg-white p-3 shadow-sm`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 text-[10px] font-bold tracking-wide text-indigo-700">CRÉDITO · DEUDA INICIAL</div>
            <div className="flex items-center gap-2 text-xs text-slate-500"><CalendarDays className="h-3.5 w-3.5" />{dateLabel(event.date)}</div>
            <h3 className="mt-1 text-sm font-semibold text-slate-900">{event.creditLineBank}</h3>
            <p className="text-xs text-slate-500">{event.creditLineName}</p>
          </div>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClass(event.status)}`}>{stateLabel}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
          <div><div className="text-slate-400">Principal {isCreditLineMaturity ? "pendiente" : "pagado"}</div><b>{eur(principal)}</b></div>
          <div><div className="text-slate-400">Intereses conocidos</div><b>{knownEur(event.expectedInterestEur)}</b></div>
          <div><div className="text-slate-400">Comisiones conocidas</div><b>{knownEur(event.expectedFeesEur)}</b></div>
          <div><div className="text-slate-400">Total conocido</div><b>{eur(totalKnown)}</b></div>
        </div>
        {isCreditLineMaturity && event.canRepay ? (
          <div className="mt-3 flex justify-end"><button type="button" onClick={() => onPayMaturity(event)} className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500">Pagar y liberar</button></div>
        ) : null}
      </article>
    );
  }

  return (
    <article className={`bg-white border border-slate-200 border-l-4 ${eventAccent(event)} rounded-lg p-3 shadow-sm`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 text-[10px] font-bold tracking-wide text-slate-600">{eventCategoryLabel(event)}</div>
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
          {isCreditLineInfo ? " - Sin vencimiento generado todavia" : ""}
          {isCreditLineMaturity ? " - Operable desde este evento" : ""}
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-slate-500">
          {showSupplierPaymentTrace
            ? event.plannedFxPending
              ? "FX pendiente de regularización · la deuda no se considera cero"
              : `EUR pendiente estimado: ${eur(event.estimatedPendingEur ?? event.plannedAmountEur)} · Coste provisional: ${eur(event.provisionalCostEur ?? event.plannedAmountEur)}`
            : `Cambio previsto: ${event.plannedFxRate ?? "pendiente"}`}
        </div>
      )}
      {showSupplierPaymentTrace ? (
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
          <div>
            <span className="block text-slate-400">Tipo de cambio real</span>
            <b>{event.actualFxForeignPerEur != null ? `1 EUR = ${event.actualFxForeignPerEur} ${event.originalCurrency}` : event.actualFxRate != null ? `${event.actualFxRate} EUR por ${event.originalCurrency} (legacy)` : "-"}{event.actualFxRateIsWeighted ? " (medio ponderado informativo)" : ""}</b>
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
          {isCreditLineMaturity && event.canRepay ? (
            <button type="button" onClick={() => onPayMaturity(event)} className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500">Pagar y liberar</button>
          ) : canMarkSupplierPayment ? (
            <button
              onClick={() => onMarkPaid(event)}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Pagar obligación
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
  const [linkedPaymentOpen, setLinkedPaymentOpen] = useState(false);
  const [partialPayment, setPartialPayment] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [recurringEvent, setRecurringEvent] = useState<FinancePlanningEvent | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshBusy = useRef(false);
  const requestVersion = useRef(0);
  const [detailBatchId, setDetailBatchId] = useState<string | null>(null);
  const [maturityPaymentEvent, setMaturityPaymentEvent] = useState<FinancePlanningEvent | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState<FinanceFiltersState>(EMPTY_FILTERS);
  const [urlFiltersReady, setUrlFiltersReady] = useState(false);

  const initialPlanningRequest = useRef<Promise<FinancePlanningResponse> | null>(null);
  const loadPlanning = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const pending = initialPlanningRequest.current ?? planningRequest<FinancePlanningResponse>("/api/finance/planning?months=6");
      initialPlanningRequest.current = pending;
      const json = await pending;
      if (version === requestVersion.current) setData(json);
    } catch (err) {
      if (version === requestVersion.current) setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      if (version === requestVersion.current) { initialPlanningRequest.current = null; setLoading(false); }
    }
  }, []);

  const reloadPlanning = useCallback(async () => {
    const version = ++requestVersion.current;
    const json = await planningRequest<FinancePlanningResponse>("/api/finance/planning?months=6");
    if (version === requestVersion.current) setData(json);
    return json as FinancePlanningResponse;
  }, []);

  const handleRefresh = useCallback(async () => {
    if (refreshBusy.current) return;
    refreshBusy.current = true;
    setRefreshing(true); setRefreshError(null); setSuccessMessage(null);
    try {
      const sync = await planningRequest<{ state: "running" | "succeeded" | "failed" }>(
        "/api/finance/amazon-refresh", { method: "POST" }, 120_000);
      await reloadPlanning();
      if (sync?.state === "failed") setRefreshError("Amazon no pudo completar la actualización. Se muestran los últimos datos disponibles.");
      else setSuccessMessage(sync?.state === "running"
        ? "Ya hay una sincronización de Amazon en curso. Se han recargado los datos guardados; todavía no se confirma una actualización."
        : sync?.state === "succeeded"
          ? "Consulta de saldos Amazon completada y planificación recargada. Los importes pueden no haber cambiado."
          : "Planificación recargada desde los datos guardados.");
    } catch (caught) { setRefreshError(caught instanceof Error ? caught.message : "No se pudo actualizar."); }
    finally { refreshBusy.current = false; setRefreshing(false); }
  }, [reloadPlanning]);

  const openSupplierPaymentModal = useCallback((event: FinancePlanningEvent) => {
    if (event.type === "unlinked_obligation" && event.canMarkPaid) { setRecurringEvent(event); setRecurringOpen(true); return; }
    if (!isSupplierPaymentEvent(event)) return;
    if (event.status === "pagado") return;
    setSelectedPaymentEvent(event);
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
      data?.months.map((month) => {
        const events = month.events.filter((event) => eventMatchesFilters(event, filters));
        return { ...month, ...buildMonthlyTotals(events), events,
          hasUnvaluedForeignDebt: Object.keys(unvaluedPayments(events)).length > 0 };
      }) ?? [],
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

  const amazonCards = data.amazonCashForecast.marketplaceCards;
  const europeAmazonCard = amazonCards.find((card) => card.marketplace === "EUROPE");
  const unresolvedAmazonCard = amazonCards.find((card) => card.marketplace === "UNRESOLVED");
  const marketplaceAmazonCards = amazonCards.filter((card) => !["EUROPE", "UNRESOLVED"].includes(card.marketplace));
  const pendingBankCards = amazonCards.filter((card) => card.marketplace !== "EUROPE" && card.marketplace !== "UNRESOLVED" && (card.pendingBankEur ?? 0) > 0);
  const unresolvedAmountEur = unresolvedAmazonCard
    ? (unresolvedAmazonCard.availablePositiveEur ?? 0) + (unresolvedAmazonCard.deferredEur ?? 0) + (unresolvedAmazonCard.pendingBankEur ?? 0)
    : 0;

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
            <p className={`mt-1 text-xs ${data.amazonSync?.stale ? "text-amber-700" : "text-emerald-700"}`}>
              {data.amazonSync?.stale
                ? `Amazon: datos de ${data.amazonSync.lastSuccessfulAmazonSyncAt ? new Date(data.amazonSync.lastSuccessfulAmazonSyncAt).toLocaleString("es-ES") : "sin sincronizacion previa"} · actualizacion pendiente`
                : `Amazon actualizado: ${data.amazonSync?.lastSuccessfulAmazonSyncAt ? new Date(data.amazonSync.lastSuccessfulAmazonSyncAt).toLocaleString("es-ES") : "ahora"}`}
            </p>
            {data.permissions.canManageCreditLineRegularizations && <details className="relative mt-3 inline-block">
              <summary className="cursor-pointer rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">Crear pago ▾</summary>
              <div className="absolute left-0 z-20 mt-1 grid w-56 gap-1 rounded-lg border bg-white p-2 shadow-lg" onClick={e => { e.currentTarget.closest("details")?.removeAttribute("open"); }}>
                <button type="button" className="rounded px-3 py-2 text-left text-sm hover:bg-slate-100" onClick={() => { setPartialPayment(false); setLinkedPaymentOpen(true); }}>Pago vinculado</button>
                <button type="button" className="rounded px-3 py-2 text-left text-sm hover:bg-slate-100" onClick={() => { setPartialPayment(true); setLinkedPaymentOpen(true); }}>Pago parcial</button>
                <button type="button" className="rounded px-3 py-2 text-left text-sm hover:bg-slate-100" onClick={() => { setRecurringEvent(undefined); setRecurringOpen(true); }}>Pago recurrente</button>
              </div>
            </details>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">Limite activo</div>
              <div className="text-sm font-bold text-slate-900">
                {eur(data.summary.totalActiveCreditLimit ?? data.summary.totalCreditLimit)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">Dispuesto (todas)</div>
              <div className="text-sm font-bold text-slate-900">{eur(data.summary.totalCreditUsed)}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">Disponible activo</div>
              <div className="text-sm font-bold text-emerald-700">
                {eur(data.summary.totalActiveCreditAvailable ?? data.summary.totalCreditAvailable)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">Caja operativa real</div>
              <div className="text-sm font-bold text-slate-900">{eur(data.summary.cashBalance)}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">Reserva / disponible sobre reserva</div>
              <div className="text-sm font-bold text-slate-900">{eur(data.summary.minimumOperatingReserveEur)} / {eur(data.summary.operatingCashAvailableAboveReserveEur)}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">Estado tesoreria</div>
              <div className="text-sm font-bold uppercase text-indigo-700">{data.summary.treasuryEvaluation.status}</div>
              <div className="mt-1 text-[10px] text-slate-500">{data.summary.treasuryEvaluation.recommendation}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">Amazon disponible para solicitar (fuera de caja)</div>
              <div className="text-sm font-bold text-slate-900">{eur(data.summary.amazonAvailable)}</div>
              <div className="mt-1 text-[10px] text-slate-500">{data.summary.amazonAvailableSource}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">Amazon previsto</div>
              <div className="text-sm font-bold text-sky-700">{eur(data.summary.amazonExpected)}</div>
              <div className="mt-1 text-[10px] text-slate-500">{data.summary.amazonExpectedNetRatio == null ? "Neto bancario no disponible hasta disponer de evidencia histórica suficiente." : `Ventas estimadas × ratio neto histórico configurado ${Math.round(data.summary.amazonExpectedNetRatio * 100)} %.`} No modifica caja.</div>
            </div>
          </div>
        </header>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Amazon · Estados de liquidez por marketplace</h2>
              <p className="mt-1 text-xs text-slate-500">AVAILABLE es dinero que puede solicitarse a Amazon, pero todavía no está en banco.</p>
              <p className="mt-1 text-[11px] text-slate-400">Última actualización: {data.amazonSync?.lastSuccessfulAmazonSyncAt ? new Date(data.amazonSync.lastSuccessfulAmazonSyncAt).toLocaleString("es-ES") : "no disponible"}</p>
            </div>
            <button type="button" disabled={refreshing} onClick={() => void handleRefresh()} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">{refreshing ? "Actualizando…" : "Actualizar"}</button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {marketplaceAmazonCards.map((card) => <div key={card.marketplace} className="rounded-lg border border-slate-200 p-3">
              <div className="text-sm font-bold text-slate-900">{card.marketplace}</div>
              <div className="mt-3 text-[11px] text-slate-500">Disponible para solicitar</div><div className="text-sm font-semibold text-slate-900">{originalMoney(card.availableOriginal,card.currency)}</div><div className="text-lg font-bold text-emerald-700">{knownEur(card.availablePositiveEur)}</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs"><div><span className="block text-slate-400">Diferido por Amazon</span><b className="block">{originalMoney(card.deferredOriginal,card.currency)}</b><b>{knownEur(card.deferredEur)}</b></div><div><span className="block text-slate-400">En curso / pendiente banco</span><b className="block">{originalMoney(card.pendingBankOriginal,card.currency)}</b><b>{knownEur(card.pendingBankEur)}</b></div></div>
              {(card.pendingBankEur ?? 0) > 0 ? <div className="mt-2 text-[11px] text-emerald-700">Llegada estimada: {card.pendingBankArrivalBase ?? card.expectedBankDate ?? "no disponible"}</div> : null}
              {card.currency!=="EUR"?<div className="mt-3 border-t border-slate-100 pt-2 text-[10px] text-slate-500">FX: {card.fxRate!=null?`1 ${card.currency} = ${card.fxRate.toFixed(6)} EUR`:"EUR unavailable"}<br/>{card.fxSources.join(", ")||"UNAVAILABLE"} · {card.fxObservedAt??"sin fecha FX"}</div>:<div className="mt-3 border-t border-slate-100 pt-2 text-[10px] text-slate-400">EUR · sin conversión</div>}
            </div>)}

            {europeAmazonCard ? <div className="rounded-lg border-2 border-indigo-200 bg-indigo-50/40 p-4 sm:col-span-2 xl:col-span-2">
              <div className="text-base font-bold text-indigo-950">Europa · equivalente EUR estimado</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3 text-xs"><div><span className="block text-slate-500">Disponible para solicitar</span><b className="text-lg text-emerald-700">{knownEur(europeAmazonCard.availablePositiveEur)}</b></div><div><span className="block text-slate-500">Diferido por Amazon</span><b className="text-lg text-slate-900">{knownEur(europeAmazonCard.deferredEur)}</b></div><div><span className="block text-slate-500">En curso / pendiente de banco</span><b className="text-lg text-slate-900">{knownEur(europeAmazonCard.pendingBankEur)}</b></div></div>
              <div className="mt-3 text-[10px] text-slate-400">EUR oficiales + equivalentes ECB; no es un total exacto Amazon. No incluye UNRESOLVED ni marketplaces de Oriente Próximo · snapshot {europeAmazonCard.lastSnapshotAt ? new Date(europeAmazonCard.lastSnapshotAt).toLocaleString("es-ES") : "no disponible"}</div>
            </div> : null}

            <div className={`rounded-lg border p-3 ${unresolvedAmountEur > 0 ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50/60"}`}>
              <div className="text-sm font-bold text-slate-900">UNRESOLVED</div>
              <div className="mt-1 text-[11px] text-slate-500">Importes Amazon pendientes de asignar a un marketplace.</div>
              <div className={`mt-3 text-lg font-bold ${unresolvedAmountEur > 0 ? "text-amber-800" : "text-slate-500"}`}>{eur(unresolvedAmountEur)}</div>
              <div className="mt-1 text-xs text-slate-500">{unresolvedAmountEur > 0 ? "Pendientes de asignar" : "Sin importes pendientes de asignar"}</div>
            </div>
          </div>

          <div className="mt-5 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Próximas transferencias en curso</h3>
            <div className="mt-2 overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="text-slate-400"><tr><th className="py-2 pr-4">Marketplace</th><th className="py-2 pr-4">Importe</th><th className="py-2 pr-4">Solicitado/Iniciado</th><th className="py-2 pr-4">Llegada estimada</th><th className="py-2">Estado</th></tr></thead><tbody className="divide-y divide-slate-100">{pendingBankCards.map((card) => <tr key={card.marketplace}><td className="py-2 pr-4 font-semibold">{card.marketplace}</td><td className="py-2 pr-4">{knownEur(card.pendingBankEur)}</td><td className="py-2 pr-4">Evidencia Amazon</td><td className="py-2 pr-4">{card.pendingBankArrivalBase ?? card.expectedBankDate ?? "no disponible"}</td><td className="py-2 text-emerald-700">PENDING_BANK</td></tr>)}{pendingBankCards.length === 0 ? <tr><td colSpan={5} className="py-4 text-center text-slate-400">No hay transferencias en curso.</td></tr> : null}</tbody></table></div>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {data.creditLines.map((line) => {
            const allowsDrawdown = isActiveCreditLineStatus(line.status);
            const debtNote = creditLineNonDrawdownDebtLabel(line.status);
            return (
            <div key={line.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">{line.bankName}</h2>
                  <p className="text-xs text-slate-500">{line.lineName}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Estado: {line.status}</p>
                </div>
                <Landmark className="h-5 w-5 text-slate-400" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div><span className="block text-slate-400">Limite</span><b>{eur(line.creditLimit)}</b></div>
                <div><span className="block text-slate-400">Usado real</span><b>{eur(line.usedAmount)}</b></div>
                <div>
                  <span className="block text-slate-400">
                    {allowsDrawdown ? "Disponible real" : "Disponible (no usable)"}
                  </span>
                  <b className={allowsDrawdown ? undefined : "text-slate-400"}>
                    {eur(line.availableAmount)}
                  </b>
                </div>
                <div><span className="block text-slate-400">Liberacion prevista</span><b>{eur(line.plannedReleaseDuringHorizon ?? 0)}</b></div>
              </div>
              {(line.scheduledExcessEur ?? 0) > 0 ? <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">Exceso calendarizado: {eur(line.scheduledExcessEur ?? 0)}. Es una alerta, no credito disponible.</p> : null}
              <p className="mt-2 text-[11px] text-slate-500">Solo el disponible real autoriza nuevas disposiciones. Las liberaciones previstas no pueden anticiparse.</p>
              <p className="mt-3 text-[11px] text-slate-500">
                {line.cycleDays ? `Ciclo aprox. ${line.cycleDays} dias.` : "Fechas configuradas"} Coste pendiente de configurar.
              </p>
              {debtNote ? (
                <p className="mt-2 text-[11px] text-amber-800">{debtNote}</p>
              ) : null}
              {line.legacyGap ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                  <div className="font-semibold">Deuda inicial pendiente de migración: {eur(line.legacyGap.unexplainedAmount)}</div>
                </div>
              ) : null}
            </div>
            );
          })}
        </section>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Cambio previsto global USD/EUR: {data.summary.plannedUsdEurRate ?? "pendiente de configurar"}.
          Es una referencia estimada y nunca sustituye el cambio bancario real de cada pago.
        </div>

        {refreshing && <p role="status" className="text-sm text-slate-600">Consultando la actualización. Amazon tiene un límite de espera de 2 minutos; después se recarga la planificación.</p>}
        {refreshError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{refreshError}</p>}
        {data.recurringPaymentsWarning && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{data.recurringPaymentsWarning}</p>}
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
                  <div><b className="text-white">{hasActiveFilters ? "Pendiente filtrado" : "Pendiente"}{month.hasUnvaluedForeignDebt ? " (parcial)" : ""}: {eur(month.pendingBreakdown.total)}</b>
                    {([['lines','Líneas'],['deposits','Depósitos'],['balances','Balances'],['others','Otros']] as const).map(([key,label]) => {
                      const unvalued = Object.entries(unvaluedPayments(month.events,key));
                      return <div key={key}>{label}: {unvalued.length && month.pendingBreakdown[key] === 0 ? "Pendiente de valorar" : eur(month.pendingBreakdown[key])}
                        {unvalued.map(([currency,amount]) => <span className="block text-amber-300" key={currency}>{originalMoney(amount,currency)} · cambio previsto pendiente</span>)}
                      </div>;
                    })}
                  </div>
                  <div><b className="text-white">Pagado: {eur(month.paidBreakdown.total)}</b><div>Lineas {eur(month.paidBreakdown.lines)}</div><div>Depositos {eur(month.paidBreakdown.deposits)}</div><div>Balances {eur(month.paidBreakdown.balances)}</div><div>Otros {eur(month.paidBreakdown.others)}</div></div>
                  <span className="col-span-2">Importes pendientes en EUR estimados con el cambio previsto; pagados con importes reales.</span>
                  <span>Amazon disponible: {eur(month.amazonAvailableEur)}</span>
                  <span>Amazon pendiente banco: {eur(month.amazonPendingBankEur)}</span>
                  <span>Amazon diferido: {eur(month.amazonDeferredEur)}</span>
                  <span className="col-span-2 font-semibold text-amber-200">Estimación ingresos AWS: {month.amazonMonthlyEstimateEur == null ? "Sin estimación" : eur(month.amazonMonthlyEstimateEur)}<span className="block font-normal text-slate-300">Previsión del mes; no es saldo bancario disponible.</span></span>
                  <span>Amazon recibido: {eur(month.amazonReceivedEur)}</span>
                  {month.hasUnvaluedForeignDebt ? <span className="text-amber-300">FX pendiente: {month.pendingFxObligations} obligación(es), importe EUR no valorado</span> : null}
                  <span>Liberacion prevista: {eur(month.totalCreditReleases)}</span>
                  <span>Intereses: {combinedKnownEur(month.recordedInterestEur, month.plannedCreditInterestEur)}</span>
                  <span>Comisiones: {combinedKnownEur(month.recordedFeesEur, month.plannedCreditFeesEur)}</span>
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
                      onViewBatch={setDetailBatchId}
                      onPayMaturity={setMaturityPaymentEvent}
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
                  onViewBatch={setDetailBatchId}
                  onPayMaturity={setMaturityPaymentEvent}
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
            <p>Una linea puede refinanciar un vencimiento mediante el flujo atomico existente.</p>
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
      {recurringOpen && <RecurringPaymentModal event={recurringEvent} onClose={() => { setRecurringOpen(false); setRecurringEvent(undefined); }} onSaved={async () => {
        await reloadPlanning(); setSuccessMessage("Pago recurrente guardado. Planificación y saldo de cuenta actualizados.");
      }} />}
      {linkedPaymentOpen ? (
        <LinkedPurchasePaymentModal
          initialMode={partialPayment ? "free_amount" : "selected_payments"}
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
      {maturityPaymentEvent ? (
        <CreditLineMaturityPaymentModal
          maturity={eventToMaturity(maturityPaymentEvent)}
          cashAccounts={data.cashAccounts}
          creditLines={data.creditLines}
          onClose={() => setMaturityPaymentEvent(null)}
          onSaved={async (message) => {
            setMaturityPaymentEvent(null);
            await refreshAfterCreditLineRepayment(message);
          }}
        />
      ) : null}
    </main>
  );
}
