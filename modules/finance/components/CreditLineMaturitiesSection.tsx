"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Banknote, AlertTriangle } from "lucide-react";
import type { FinanceCashAccount } from "../types/planning.types";
import type {
  CreditLineMaturitiesResponse,
  CreditLineMaturity,
  CreditLineMaturityFilter,
  CreditLineMaturityVisualStatus,
} from "../types/creditLineMaturities.types";

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
  const [amount, setAmount] = useState(String(maxAmount));
  const [movementDate, setMovementDate] = useState(today);
  const [cashAccountId, setCashAccountId] = useState("");
  const [bankReference, setBankReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const selectedAccount = eurAccounts.find((account) => account.id === cashAccountId) ?? null;

  const submit = async (e: FormEvent<HTMLFormElement>, mode: "full" | "partial") => {
    e.preventDefault();
    setError(null);

    const amountNumber = mode === "full" ? maxAmount : Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setError("El importe debe ser mayor que 0.");
      return;
    }
    if (amountNumber > maxAmount) {
      setError("El importe no puede superar el saldo pendiente.");
      return;
    }
    if (!movementDate || !/^\d{4}-\d{2}-\d{2}$/.test(movementDate)) {
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
    if (selectedAccount.balance < amountNumber) {
      setError("Saldo de caja insuficiente.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/finance/credit-lines/${maturity.creditLineId}/repay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountNumber,
          movementDate,
          cashAccountId,
          repaymentGroupId: maturity.repaymentGroupId,
          bankReference: bankReference.trim() ? bankReference.trim() : null,
          notes: notes.trim() ? notes.trim() : null,
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
              {!maturity.lineAllowsDrawdown
                ? ` · Linea ${maturity.lineStatus || "inactiva"} (deuda pagable)`
                : null}
            </p>
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
            Importe a devolver
            <input
              type="number"
              min="0.01"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>

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
              value={movementDate}
              onChange={(e) => setMovementDate(e.target.value)}
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
              onClick={(e) => submit(e as unknown as FormEvent<HTMLFormElement>, "full")}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Pagar saldo completo"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function CreditLineMaturitiesSection({
  cashAccounts,
  onRepaid,
}: {
  cashAccounts: FinanceCashAccount[];
  onRepaid: (message: string) => Promise<void>;
}) {
  const [data, setData] = useState<CreditLineMaturitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CreditLineMaturityFilter>("all");
  const [selected, setSelected] = useState<CreditLineMaturity | null>(null);

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
                  <p className="text-[11px] text-slate-600">
                    Linea {maturity.lineStatus || "inactiva"} · sin nuevas disposiciones · deuda pagable
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
              {maturity.canRepay ? (
                <button
                  type="button"
                  onClick={() => setSelected(maturity)}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                >
                  <Banknote className="h-3.5 w-3.5" />
                  Pagar linea
                </button>
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
    </section>
  );
}
