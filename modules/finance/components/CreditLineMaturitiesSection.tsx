"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Banknote, AlertTriangle } from "lucide-react";
import type { FinanceCashAccount, FinanceCreditLine } from "../types/planning.types";
import { CreditLineRefinancingModal } from "./CreditLineRefinancingModal";
import type {
  CreditLineMaturitiesResponse,
  CreditLineMaturity,
  CreditLineMaturityFilter,
  CreditLineMaturityVisualStatus,
  CreditLineLegacyGap,
} from "../types/creditLineMaturities.types";
import { creditLineNonDrawdownDebtLabel } from "../utils/creditLineStatus";
import { addCivilDays, nextSuggestedDueDate } from "../utils/creditLineLegacyDates";
import {
  MAX_DISPOSITIONS,
  MAX_MONEY_EXCLUSIVE,
  MAX_NOTES_LENGTH,
  MAX_REFERENCE_LENGTH,
} from "../services/creditLineLegacyRegularizationValidation";

const MATURITY_FILTERS: Array<{ value: CreditLineMaturityFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "overdue", label: "Vencidos" },
  { value: "next_7", label: "Proximos 7 dias" },
  { value: "next_15", label: "Proximos 15 dias" },
  { value: "this_month", label: "Este mes" },
  { value: "partial", label: "Parciales" },
];

function eur(value: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return "Sin fecha";
  return value;
}

function daysLabel(daysUntilDue: number): string {
  if (daysUntilDue < 0) return `${Math.abs(daysUntilDue)} dias vencido`;
  if (daysUntilDue === 0) return "Vence hoy";
  return `${daysUntilDue} dias restantes`;
}

function visualLabel(status: CreditLineMaturityVisualStatus): string {
  switch (status) {
    case "overdue":
      return "Vencido";
    case "due_today":
      return "Vence hoy";
    case "next_7":
      return "Proximo 7 dias";
    case "next_15":
      return "Proximo 15 dias";
    case "partial":
      return "Parcialmente pagado";
    default:
      return "Pendiente";
  }
}

function visualClass(status: CreditLineMaturityVisualStatus): string {
  switch (status) {
    case "overdue":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "due_today":
      return "bg-orange-50 text-orange-700 border-orange-200";
    case "next_7":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "next_15":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "partial":
      return "bg-violet-50 text-violet-700 border-violet-200";
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function displayStatusLabel(maturity: CreditLineMaturity): string {
  switch (maturity.displayStatus) {
    case "vencido_parcial":
      return "Vencido parcial";
    case "parcial":
      return "Parcial";
    case "vencido":
      return "Vencido";
    default:
      return "Pendiente";
  }
}

export function CreditLineRepaymentModal({
  maturity,
  cashAccounts,
  onClose,
  onSaved,
}: {
  maturity: CreditLineMaturity;
  cashAccounts: FinanceCashAccount[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const eurAccounts = cashAccounts.filter(
    (account) => account.currency.trim().toUpperCase() === "EUR",
  );
  const maxAmount = maturity.remainingAmountEur;
  const [principalPaidEur, setPrincipalPaidEur] = useState(String(maxAmount));
  const [interestPaidEur, setInterestPaidEur] = useState("0");
  const [feesPaidEur, setFeesPaidEur] = useState("0");
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [cashAccountId, setCashAccountId] = useState("");
  const [bankReference, setBankReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastAttempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const selectedAccount = eurAccounts.find((account) => account.id === cashAccountId) ?? null;

  const submit = async (e: FormEvent<HTMLFormElement>, mode: "full" | "partial") => {
    e.preventDefault();
    setError(null);

    const principal = mode === "full" ? maxAmount : Number(principalPaidEur);
    const interest = Number(interestPaidEur);
    const fees = Number(feesPaidEur);
    const components = [principal, interest, fees];
    if (components.some((value) => !Number.isFinite(value) || value < 0
      || Math.abs(Math.round(value * 100) - value * 100) > Number.EPSILON * Math.max(1, Math.abs(value * 100)) * 4)) {
      setError("Los importes deben ser positivos o cero y tener como maximo dos decimales.");
      return;
    }
    if (principal + interest + fees <= 0) {
      setError("Indica al menos un componente mayor que cero.");
      return;
    }
    if (principal > maxAmount) {
      setError("El principal no puede superar el saldo pendiente.");
      return;
    }
    if (!effectiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      setError("Indica una fecha de pago valida.");
      return;
    }
    if (!cashAccountId) {
      setError("Selecciona una cuenta EUR.");
      return;
    }
    if (!selectedAccount || selectedAccount.currency.trim().toUpperCase() !== "EUR") {
      setError("Solo se permiten cuentas EUR.");
      return;
    }
    if (selectedAccount.balance < principal + interest + fees) {
      setError("Saldo de caja insuficiente.");
      return;
    }

    setSaving(true);
    try {
      const attemptPayload = {
        repaymentGroupId: maturity.repaymentGroupId,
        cashAccountId,
        principalPaidEur: principal,
        interestPaidEur: interest,
        feesPaidEur: fees,
        effectiveDate,
        bankReference: bankReference.trim() ? bankReference.trim() : null,
        notes: notes.trim() ? notes.trim() : null,
      };
      const fingerprint = JSON.stringify(attemptPayload);
      const idempotencyKey = lastAttempt.current?.fingerprint === fingerprint
        ? lastAttempt.current.key
        : crypto.randomUUID();
      lastAttempt.current = { fingerprint, key: idempotencyKey };
      const res = await fetch(`/api/finance/credit-lines/${maturity.creditLineId}/repay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...attemptPayload,
          idempotencyKey,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "No se pudo pagar la linea");
      }
      await onSaved(
        mode === "full"
          ? "Pago total de linea registrado correctamente."
          : "Pago parcial de linea registrado correctamente.",
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
        onSubmit={(e) => submit(e, "partial")}
        className="w-full max-w-xl bg-white rounded-xl shadow-2xl my-10 border border-slate-100"
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Pagar linea de credito</h2>
            <p className="text-xs text-slate-500">
              {maturity.bankName} / {maturity.lineName}
            </p>
            {!maturity.lineAllowsDrawdown ? (
              <p className="text-[11px] text-amber-800 mt-1">
                {creditLineNonDrawdownDebtLabel(maturity.lineStatus)}
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            Cerrar
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-slate-500">Vencimiento</div>
              <div className="font-semibold text-slate-900">{dateLabel(maturity.dueDate)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-slate-500">Saldo pendiente</div>
              <div className="font-semibold text-slate-900">{eur(maxAmount)}</div>
            </div>
          </div>

          <label className="text-xs font-medium text-slate-600 block">
            Principal a devolver
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={principalPaidEur}
              onChange={(e) => setPrincipalPaidEur(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-slate-600 block">
              Intereses
              <input type="number" min="0" step="0.01" required value={interestPaidEur}
                onChange={(e) => setInterestPaidEur(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium text-slate-600 block">
              Comisiones
              <input type="number" min="0" step="0.01" required value={feesPaidEur}
                onChange={(e) => setFeesPaidEur(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-slate-500">Salida total de caja</div>
              <div className="font-semibold text-slate-900">{eur((Number(principalPaidEur) || 0) + (Number(interestPaidEur) || 0) + (Number(feesPaidEur) || 0))}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-slate-500">Credito que se libera</div>
              <div className="font-semibold text-slate-900">{eur(Number(principalPaidEur) || 0)}</div>
            </div>
          </div>

          <label className="text-xs font-medium text-slate-600 block">
            Cuenta EUR
            <select
              required
              value={cashAccountId}
              onChange={(e) => setCashAccountId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">Selecciona cuenta</option>
              {eurAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({eur(account.balance)})
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-slate-600 block">
            Fecha efectiva
            <input
              type="date"
              required
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>

          <label className="text-xs font-medium text-slate-600 block">
            Referencia bancaria
            <input
              value={bankReference}
              onChange={(e) => setBankReference(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="Opcional"
            />
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

          <div className="flex flex-wrap justify-end gap-2 pt-2">
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
              className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Registrar pago parcial"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={(e) => {
                setPrincipalPaidEur(String(maxAmount));
                void submit(e as unknown as FormEvent<HTMLFormElement>, "full");
              }}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Pagar total"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

type LegacyDispositionDraft = {
  principalEur: string;
  dispositionDate: string;
  contractualDueDate: string;
  expectedInterestEur: string;
  expectedFeesEur: string;
  dueDateEdited: boolean;
  reference: string;
  notes: string;
};

export function LegacyRegularizationForm({ gap, onSaved, onCancel }: {
  gap: CreditLineLegacyGap;
  onSaved: (message: string) => Promise<void>;
  onCancel: () => void;
}) {
  const blank = (): LegacyDispositionDraft => ({ principalEur: "", dispositionDate: "", contractualDueDate: "", expectedInterestEur: "", expectedFeesEur: "", dueDateEdited: false, reference: "", notes: "" });
  const [items, setItems] = useState<LegacyDispositionDraft[]>([blank()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const gapCents = Math.round(gap.unexplainedAmount * 100);
  const totalCents = items.reduce((sum, item) => {
    const value = Number(item.principalEur);
    return sum + (Number.isFinite(value) ? Math.round(value * 100) : 0);
  }, 0);
  const differenceCents = gapCents - totalCents;
  const today = (() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  })();
  const rowLimitReached = items.length >= MAX_DISPOSITIONS;
  const valid = differenceCents === 0 && items.length > 0 && items.every((item) => {
    const amount = Number(item.principalEur);
    return Number.isFinite(amount) && amount > 0 && amount < MAX_MONEY_EXCLUSIVE
      && Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-7
      && /^\d{4}-\d{2}-\d{2}$/.test(item.contractualDueDate)
      && (!item.dispositionDate || (/^\d{4}-\d{2}-\d{2}$/.test(item.dispositionDate) && item.dispositionDate <= today && item.contractualDueDate >= item.dispositionDate))
      && [item.expectedInterestEur, item.expectedFeesEur].every((raw) => raw === "" || (Number.isFinite(Number(raw)) && Number(raw) >= 0 && Number(raw) < MAX_MONEY_EXCLUSIVE && Math.abs(Number(raw) * 100 - Math.round(Number(raw) * 100)) < 1e-7));
  });

  const update = (index: number, changes: Partial<LegacyDispositionDraft>) => setItems((current) => current.map((item, i) => i === index ? { ...item, ...changes } : item));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid) return;
    setSaving(true); setError(null);
    const dispositions = items.map((item) => ({
      principalEur: Number(item.principalEur), dispositionDate: item.dispositionDate || null,
      contractualDueDate: item.contractualDueDate, reference: item.reference.trim() || null,
      expectedInterestEur: item.expectedInterestEur === "" ? null : Number(item.expectedInterestEur),
      expectedFeesEur: item.expectedFeesEur === "" ? null : Number(item.expectedFeesEur),
      notes: item.notes.trim() || null,
    }));
    const fingerprint = JSON.stringify(dispositions);
    const idempotencyKey = attempt.current?.fingerprint === fingerprint ? attempt.current.key : crypto.randomUUID();
    attempt.current = { fingerprint, key: idempotencyKey };
    try {
      const response = await fetch(`/api/finance/credit-lines/${gap.creditLineId}/legacy-opening-balance`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dispositions, idempotencyKey }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error ?? "No se pudo regularizar el saldo inicial");
      await onSaved("Saldo inicial regularizado correctamente.");
      onCancel();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error desconocido"); }
    finally { setSaving(false); }
  };

  return <form onSubmit={submit} className="mt-3 space-y-3 rounded-lg border border-amber-300 bg-white p-3">
    <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-6">
      <div><span className="block text-slate-500">Limite</span><b>{eur(gap.creditLimit)}</b></div>
      <div><span className="block text-slate-500">Usado actual</span><b>{eur(gap.usedAmount)}</b></div>
      <div><span className="block text-slate-500">Principal explicado</span><b>{eur(gap.explainedRemaining)}</b></div>
      <div><span className="block text-slate-500">Gap legacy</span><b>{eur(gapCents / 100)}</b></div>
      <div><span className="block text-slate-500">Total desglosado</span><b>{eur(totalCents / 100)}</b></div>
      <div><span className="block text-slate-500">Diferencia</span><b>{eur(differenceCents / 100)}</b></div>
    </div>
    {items.map((item, index) => {
      const suggested = gap.repaymentMode === "periodic_release" && gap.cycleDays
        ? addCivilDays(item.dispositionDate, gap.cycleDays) : "";
      return <div key={index} className="grid gap-2 rounded border border-slate-200 p-2 md:grid-cols-7">
        <input aria-label="Principal" type="number" min="0.01" max="999999999999.99" step="0.01" value={item.principalEur} onChange={(e) => update(index, { principalEur: e.target.value })} placeholder="Principal EUR" className="rounded border px-2 py-1" />
        <input aria-label="Fecha disposicion" title="Opcional si se desconoce" type="date" max={today} value={item.dispositionDate} onChange={(e) => update(index, { dispositionDate: e.target.value, contractualDueDate: nextSuggestedDueDate(e.target.value, gap.cycleDays, item.contractualDueDate, item.dueDateEdited) })} className="rounded border px-2 py-1" />
        <div><input aria-label="Vencimiento contractual" type="date" value={item.contractualDueDate} onChange={(e) => update(index, { contractualDueDate: e.target.value, dueDateEdited: true })} className="w-full rounded border px-2 py-1" />
          <div className="mt-1 text-[10px] text-slate-500">{gap.repaymentMode === "manual_due_dates" ? "Vencimiento pactado por disposicion" : item.dueDateEdited && item.contractualDueDate !== suggested ? "Fecha contractual ajustada manualmente" : `Calculado con plazo predeterminado de ${gap.cycleDays} dias`}</div></div>
        <input aria-label="Referencia" maxLength={MAX_REFERENCE_LENGTH} value={item.reference} onChange={(e) => update(index, { reference: e.target.value })} placeholder="Referencia" className="rounded border px-2 py-1" />
        <input aria-label="Intereses conocidos" type="number" min="0" step="0.01" value={item.expectedInterestEur} onChange={(e) => update(index, { expectedInterestEur: e.target.value })} placeholder="Intereses (opcional)" className="rounded border px-2 py-1" />
        <input aria-label="Comisiones conocidas" type="number" min="0" step="0.01" value={item.expectedFeesEur} onChange={(e) => update(index, { expectedFeesEur: e.target.value })} placeholder="Comisiones (opcional)" className="rounded border px-2 py-1" />
        <div className="flex gap-1"><input aria-label="Notas" maxLength={MAX_NOTES_LENGTH} value={item.notes} onChange={(e) => update(index, { notes: e.target.value })} placeholder="Notas" className="min-w-0 flex-1 rounded border px-2 py-1" /><button type="button" onClick={() => setItems((current) => current.filter((_, i) => i !== index))} disabled={items.length === 1}>Quitar</button></div>
      </div>;
    })}
    {rowLimitReached ? <div className="text-xs text-amber-800">Se ha alcanzado el máximo de 500 disposiciones.</div> : null}
    {error ? <div className="text-xs text-rose-700">{error}</div> : null}
    <div className="flex justify-end gap-2"><button type="button" disabled={rowLimitReached} onClick={() => {
      if (rowLimitReached) { setError("No se pueden añadir más de 500 disposiciones."); return; }
      setItems((current) => [...current, blank()]);
    }}>Añadir disposición</button><button type="button" onClick={onCancel}>Cancelar</button><button type="submit" disabled={!valid || saving} className="rounded bg-amber-700 px-3 py-1.5 text-white disabled:opacity-40">{saving ? "Guardando..." : "Confirmar"}</button></div>
  </form>;
}

export function CreditLineMaturitiesSection({
  cashAccounts,
  creditLines,
  onRepaid,
}: {
  cashAccounts: FinanceCashAccount[];
  creditLines: FinanceCreditLine[];
  onRepaid: (message: string) => Promise<void>;
}) {
  const [data, setData] = useState<CreditLineMaturitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CreditLineMaturityFilter>("all");
  const [selected, setSelected] = useState<CreditLineMaturity | null>(null);
  const [refinancing, setRefinancing] = useState<CreditLineMaturity | null>(null);
  const [regularizing, setRegularizing] = useState<string | null>(null);

  const load = useCallback(async (status: CreditLineMaturityFilter) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/credit-lines/maturities?status=${status}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Error cargando vencimientos");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const summary = data?.summary;
  const maturities = data?.maturities ?? [];
  const legacyGaps = data?.legacyGaps ?? [];

  const emptyHint = useMemo(() => {
    if (loading || error) return null;
    if (maturities.length > 0) return null;
    return "No hay vencimientos abiertos para este filtro.";
  }, [loading, error, maturities.length]);

  return (
    <section className="rounded-xl border border-indigo-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Vencimientos de lineas</h2>
          <p className="text-xs text-slate-500">
            Deuda real pagable desde caja EUR. Independiente del horizonte mensual de 6 meses.
          </p>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as CreditLineMaturityFilter)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
        >
          {MATURITY_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {summary ? (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2">
          {[
            { label: "Vencido", value: summary.overdueAmountEur, count: summary.overdueCount },
            { label: "7 dias", value: summary.next7AmountEur, count: summary.next7Count },
            { label: "15 dias", value: summary.next15AmountEur, count: summary.next15Count },
            { label: "Este mes", value: summary.thisMonthAmountEur, count: summary.thisMonthCount },
            { label: "Total pendiente", value: summary.totalPendingAmountEur, count: summary.totalCount },
          ].map((card) => (
            <div key={card.label} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="text-[11px] text-slate-500">{card.label}</div>
              <div className="text-sm font-semibold text-slate-900">{eur(card.value)}</div>
              <div className="text-[10px] text-slate-400">{card.count} vencimientos</div>
            </div>
          ))}
        </div>
      ) : null}

      {legacyGaps.length > 0 ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Saldo inicial pendiente de regularizar</div>
              <ul className="mt-1 space-y-1">
                {legacyGaps.map((gap) => (
                  <li key={gap.creditLineId}>
                    {gap.bankName} / {gap.lineName}: {eur(gap.unexplainedAmount)} sin grupo pagable
                    (used {eur(gap.usedAmount)} · explicado {eur(gap.explainedRemaining)}).
                    No se regulariza automaticamente.
                    {data?.permissions.canManageCreditLineRegularizations ? <button type="button" onClick={() => setRegularizing(gap.creditLineId)} className="ml-2 underline">Regularizar saldo inicial</button> : null}
                    {regularizing === gap.creditLineId ? <LegacyRegularizationForm gap={gap} onSaved={async (message) => {
                      await load(filter);
                      await onRepaid(message);
                    }} onCancel={() => setRegularizing(null)} /> : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4 text-sm text-slate-500">Cargando vencimientos...</div>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      ) : null}
      {emptyHint ? <div className="mt-4 text-sm text-slate-500">{emptyHint}</div> : null}

      <div className="mt-4 space-y-3">
        {maturities.map((maturity) => (
          <article
            key={maturity.id}
            className="rounded-lg border border-slate-200 border-l-4 border-l-indigo-400 bg-white p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-slate-500">
                  {dateLabel(maturity.dueDate)} · {daysLabel(maturity.daysUntilDue)}
                </div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {maturity.bankName} / {maturity.lineName}
                </h3>
                {!maturity.lineAllowsDrawdown ? (
                  <p className="text-[11px] text-amber-800">
                    {creditLineNonDrawdownDebtLabel(maturity.lineStatus)}
                  </p>
                ) : null}
                {maturity.isLegacyOpeningBalance ? (
                  <p className="text-[11px] text-amber-700">Saldo inicial regularizado (legacy)</p>
                ) : null}
              </div>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${visualClass(maturity.visualStatus)}`}>
                {visualLabel(maturity.visualStatus)}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div>
                <div className="text-slate-400">Principal</div>
                <div className="font-semibold text-slate-800">{eur(maturity.originalAmountEur)}</div>
              </div>
              <div>
                <div className="text-slate-400">Pagado</div>
                <div className="font-semibold text-slate-800">{eur(maturity.paidAmountEur)}</div>
              </div>
              <div>
                <div className="text-slate-400">Pendiente</div>
                <div className="font-semibold text-slate-800">{eur(maturity.remainingAmountEur)}</div>
              </div>
              <div>
                <div className="text-slate-400">Estado grupo</div>
                <div className="font-semibold text-slate-800">{displayStatusLabel(maturity)}</div>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <div>
                {maturity.movementCount} disposiciones
                {maturity.financedOrderCount > 0
                  ? ` · Ordenes: ${maturity.financedOrderCodes.join(", ")}`
                  : " · Sin ordenes vinculadas"}
              </div>
              {data?.permissions.canExecuteCreditLineRepayments && maturity.canRepay ? (
                <div className="flex gap-2"><button
                  type="button"
                  onClick={() => setSelected(maturity)}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                >
                  <Banknote className="h-3.5 w-3.5" />
                  Pagar linea
                </button>
                <button type="button" onClick={() => setRefinancing(maturity)} className="rounded-lg border border-indigo-300 px-2.5 py-1.5 text-xs font-medium text-indigo-700">Refinanciar</button></div>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      {selected ? (
        <CreditLineRepaymentModal
          maturity={selected}
          cashAccounts={cashAccounts}
          onClose={() => setSelected(null)}
          onSaved={async (message) => {
            await load(filter);
            await onRepaid(message);
          }}
        />
      ) : null}
      {refinancing ? <CreditLineRefinancingModal maturity={refinancing} creditLines={creditLines} onClose={() => setRefinancing(null)} onSaved={async (message) => { await load(filter); await onRepaid(message); }} /> : null}
    </section>
  );
}
