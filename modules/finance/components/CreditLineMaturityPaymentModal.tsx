"use client";

import { useRef, useState, type FormEvent } from "react";
import type { CreditLineMaturity } from "../types/creditLineMaturities.types";
import type { FinanceCashAccount, FinanceCreditLine } from "../types/planning.types";

type PaymentSource = "cash" | "credit_line";

const eur = (value: number) => new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
}).format(value);

export function CreditLineMaturityPaymentModal({ maturity, cashAccounts, creditLines, onClose, onSaved }: {
  maturity: CreditLineMaturity;
  cashAccounts: FinanceCashAccount[];
  creditLines: FinanceCreditLine[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const eurAccounts = cashAccounts.filter((account) => account.currency.trim().toUpperCase() === "EUR");
  const fundingLines = creditLines.filter((line) => line.id !== maturity.creditLineId
    && ["activa", "activo", "active"].includes(line.status.toLowerCase()));
  const [source, setSource] = useState<PaymentSource>("cash");
  const [principalEur, setPrincipalEur] = useState(String(maturity.remainingAmountEur));
  const [interestEur, setInterestEur] = useState(String(maturity.expectedInterestEur ?? 0));
  const [feesEur, setFeesEur] = useState(String(maturity.expectedFeesEur ?? 0));
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [cashAccountId, setCashAccountId] = useState("");
  const [fundingCreditLineId, setFundingCreditLineId] = useState("");
  const [manualDueDate, setManualDueDate] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const account = eurAccounts.find((item) => item.id === cashAccountId) ?? null;
  const fundingLine = fundingLines.find((item) => item.id === fundingCreditLineId) ?? null;
  const principal = Number(principalEur);
  const interest = Number(interestEur);
  const fees = Number(feesEur);
  const combinedAmount = principal + interest + fees;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (![principal, interest, fees, combinedAmount].every(Number.isFinite)
      || principal <= 0 || interest < 0 || fees < 0 || principal > maturity.remainingAmountEur) {
      setError("Los importes no son validos.");
      return;
    }
    if (!effectiveDate) {
      setError("Indica una fecha de pago valida.");
      return;
    }
    if (source === "cash" && (!account || account.balance < combinedAmount)) {
      setError(account ? "Saldo de caja insuficiente." : "Selecciona una cuenta EUR.");
      return;
    }
    if (source === "credit_line" && !fundingLine) {
      setError("Selecciona una linea financiadora.");
      return;
    }
    if (source === "credit_line" && fundingLine && combinedAmount > fundingLine.availableAmount) {
      setError(`Disponible real insuficiente. Disponible actual: ${eur(fundingLine.availableAmount)}. Las liberaciones previstas no pueden utilizarse anticipadamente.`);
      return;
    }
    if (source === "credit_line" && fundingLine?.cycleDays == null && !manualDueDate) {
      setError("La linea requiere fecha manual de vencimiento.");
      return;
    }

    const payload = source === "cash"
      ? { repaymentGroupId: maturity.repaymentGroupId, cashAccountId, principalPaidEur: principal,
          interestPaidEur: interest, feesPaidEur: fees, effectiveDate,
          bankReference: reference.trim() || null, notes: null }
      : { sourceRepaymentGroupId: maturity.repaymentGroupId, fundingCreditLineId, effectiveDate,
          principalEur: principal, interestEur: interest, feesEur: fees,
          fundingManualDueDate: fundingLine?.cycleDays == null ? manualDueDate : null,
          reference: reference.trim() || null };
    const fingerprint = JSON.stringify({ source, ...payload });
    const idempotencyKey = attempt.current?.fingerprint === fingerprint
      ? attempt.current.key : crypto.randomUUID();
    attempt.current = { fingerprint, key: idempotencyKey };
    setSaving(true);
    try {
      const url = source === "cash"
        ? `/api/finance/credit-lines/${maturity.creditLineId}/repay`
        : "/api/finance/credit-lines/refinance";
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, idempotencyKey }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error ?? "No se pudo pagar el vencimiento");
      await onSaved(source === "cash"
        ? "Pago de vencimiento registrado correctamente."
        : `Refinanciacion registrada. Nuevo vencimiento ${json.data.fundingDueDate}.`);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/40 p-4">
      <form onSubmit={submit} className="my-10 w-full max-w-xl rounded-xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="font-semibold">Pagar vencimiento</h2><p className="text-xs text-slate-500">{maturity.bankName} / {maturity.lineName} · pendiente {eur(maturity.remainingAmountEur)}</p></div>
          <button type="button" onClick={onClose}>Cerrar</button>
        </div>
        <fieldset className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <legend className="mb-1 text-xs font-medium text-slate-600">Fuente del pago</legend>
          <label className="rounded border p-3"><input type="radio" name="source" checked={source === "cash"} onChange={() => setSource("cash")} /> Caja propia</label>
          <label className="rounded border p-3"><input type="radio" name="source" checked={source === "credit_line"} onChange={() => setSource("credit_line")} /> Linea de credito</label>
        </fieldset>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          {source === "cash" ? (
            <label className="col-span-2">Cuenta EUR<select value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value)} className="mt-1 w-full rounded border p-2"><option value="">Seleccionar</option>{eurAccounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {eur(item.balance)}</option>)}</select></label>
          ) : (
            <><label className="col-span-2">Linea financiadora<select value={fundingCreditLineId} onChange={(e) => { setFundingCreditLineId(e.target.value); setManualDueDate(""); }} className="mt-1 w-full rounded border p-2"><option value="">Seleccionar</option>{fundingLines.map((line) => <option key={line.id} value={line.id}>{line.bankName} · disponible real {eur(line.availableAmount)}</option>)}</select></label>{fundingLine ? <div className="col-span-2 rounded bg-sky-50 p-2 text-xs text-sky-800">Disponible real: {eur(fundingLine.availableAmount)}. Liberaciones previstas: {eur(fundingLine.plannedReleaseDuringHorizon ?? 0)} (no utilizables).</div> : null}</>
          )}
          <label>Principal<input type="number" min="0" step="0.01" value={principalEur} onChange={(e) => setPrincipalEur(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
          <label>Fecha<input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
          <label>Intereses<input type="number" min="0" step="0.01" value={interestEur} onChange={(e) => setInterestEur(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
          <label>Comisiones<input type="number" min="0" step="0.01" value={feesEur} onChange={(e) => setFeesEur(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
          {source === "credit_line" && fundingLine?.cycleDays == null ? <label className="col-span-2">Vencimiento manual<input type="date" min={effectiveDate} value={manualDueDate} onChange={(e) => setManualDueDate(e.target.value)} className="mt-1 w-full rounded border p-2" /></label> : null}
          <label className="col-span-2">Referencia<input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
        </div>
        <div className="mt-3 rounded bg-slate-50 p-3 text-xs">Salida de caja/credito: {eur(Number.isFinite(combinedAmount) ? combinedAmount : 0)}. Solo el principal ({eur(Number.isFinite(principal) ? principal : 0)}) libera credito de la linea origen.</div>
        {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onClose}>Cancelar</button><button disabled={saving} className="rounded bg-indigo-600 px-3 py-2 text-white disabled:opacity-60">{saving ? "Guardando..." : "Pagar y liberar"}</button></div>
      </form>
    </div>
  );
}
