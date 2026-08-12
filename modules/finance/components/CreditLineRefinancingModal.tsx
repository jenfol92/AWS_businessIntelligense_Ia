"use client";

import { useRef, useState, type FormEvent } from "react";
import type { CreditLineMaturity } from "../types/creditLineMaturities.types";
import type { FinanceCreditLine } from "../types/planning.types";

const eur = (value: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value);

export function CreditLineRefinancingModal({ maturity, creditLines, onClose, onSaved }: {
  maturity: CreditLineMaturity;
  creditLines: FinanceCreditLine[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const candidates = creditLines.filter((line) => line.id !== maturity.creditLineId && ["activa", "activo", "active"].includes(line.status.toLowerCase()));
  const [fundingCreditLineId, setFundingCreditLineId] = useState("");
  const [principalEur, setPrincipalEur] = useState(String(maturity.remainingAmountEur));
  const [interestEur, setInterestEur] = useState("0");
  const [feesEur, setFeesEur] = useState("0");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [manualDueDate, setManualDueDate] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const selected = candidates.find((line) => line.id === fundingCreditLineId);
  const principal = Number(principalEur);
  const interest = Number(interestEur);
  const fees = Number(feesEur);
  const total = principal + interest + fees;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!selected) return setError("Selecciona una linea financiadora.");
    if (![principal, interest, fees, total].every(Number.isFinite) || principal <= 0 || interest < 0 || fees < 0 || principal > maturity.remainingAmountEur) return setError("Los importes no son validos.");
    if (total > selected.availableAmount) return setError(`Disponible real insuficiente. Disponible actual: ${eur(selected.availableAmount)}. Proximas liberaciones previstas: ${eur(selected.plannedReleaseDuringHorizon ?? 0)} (solo informacion; no pueden utilizarse anticipadamente).`);
    if (selected.cycleDays == null && !manualDueDate) return setError("La linea requiere fecha manual de vencimiento.");

    const payload = { sourceRepaymentGroupId: maturity.repaymentGroupId, fundingCreditLineId, effectiveDate, principalEur: principal, interestEur: interest, feesEur: fees, fundingManualDueDate: selected.cycleDays == null ? manualDueDate : null, reference: reference || null };
    const fingerprint = JSON.stringify(payload);
    const idempotencyKey = attempt.current?.fingerprint === fingerprint ? attempt.current.key : crypto.randomUUID();
    attempt.current = { fingerprint, key: idempotencyKey };
    setSaving(true);
    try {
      const response = await fetch("/api/finance/credit-lines/refinance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, idempotencyKey }) });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error ?? "No se pudo refinanciar");
      await onSaved(`Refinanciacion registrada. Nuevo vencimiento ${json.data.fundingDueDate}.`);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><form onSubmit={submit} className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"><h3 className="font-semibold">Pagar vencimiento con otra linea</h3><p className="mt-1 text-xs text-slate-500">Origen: {maturity.bankName} · pendiente {eur(maturity.remainingAmountEur)}</p><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><label className="col-span-2">Linea financiadora<select value={fundingCreditLineId} onChange={(e) => { setFundingCreditLineId(e.target.value); setManualDueDate(""); }} className="mt-1 w-full rounded border p-2"><option value="">Seleccionar</option>{candidates.map((line) => <option key={line.id} value={line.id}>{line.bankName} · disponible real {eur(line.availableAmount)}</option>)}</select></label>{selected ? <div className="col-span-2 rounded bg-sky-50 p-2 text-xs text-sky-800">Disponible real: {eur(selected.availableAmount)}. Liberaciones previstas: {eur(selected.plannedReleaseDuringHorizon ?? 0)} (no utilizables hasta su amortizacion real).</div> : null}<label>Principal<input type="number" min="0" step="0.01" value={principalEur} onChange={(e) => setPrincipalEur(e.target.value)} className="mt-1 w-full rounded border p-2" /></label><label>Fecha<input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="mt-1 w-full rounded border p-2" /></label><label>Intereses<input type="number" min="0" step="0.01" value={interestEur} onChange={(e) => setInterestEur(e.target.value)} className="mt-1 w-full rounded border p-2" /></label><label>Comisiones<input type="number" min="0" step="0.01" value={feesEur} onChange={(e) => setFeesEur(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>{selected?.cycleDays == null ? <label className="col-span-2">Vencimiento manual<input type="date" min={effectiveDate} value={manualDueDate} onChange={(e) => setManualDueDate(e.target.value)} className="mt-1 w-full rounded border p-2" /></label> : null}<label className="col-span-2">Referencia<input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 w-full rounded border p-2" /></label></div><div className="mt-3 rounded bg-slate-50 p-3 text-xs">Preview: nueva disposicion {eur(Number.isFinite(total) ? total : 0)}. Solo el principal origen ({eur(Number.isFinite(principal) ? principal : 0)}) libera credito; intereses y comisiones son coste.</div>{error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}<div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onClose}>Cancelar</button><button disabled={saving} className="rounded bg-indigo-600 px-3 py-2 text-white disabled:opacity-60">{saving ? "Guardando..." : "Confirmar refinanciacion"}</button></div></form></div>;
}
