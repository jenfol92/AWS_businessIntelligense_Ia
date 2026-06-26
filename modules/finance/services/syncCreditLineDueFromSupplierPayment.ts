import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { SupplierPaymentRow } from "@/modules/finance/types/supplierPayments.types";
import type { FinanceCreditLine, FinancePaymentSource } from "@/modules/finance/types/planning.types";

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function mapBankToPaymentSource(bankName: string): FinancePaymentSource {
  const lower = bankName.toLowerCase();
  if (lower.includes("rural")) return "caja_rural";
  if (lower.includes("caixa")) return "la_caixa";
  if (lower.includes("bbva")) return "bbva";
  return "manual";
}

export function recommendCreditLineForAmount(
  amount: number,
  creditLines: FinanceCreditLine[],
  cashBalance: number,
): { line: FinanceCreditLine | null; source: FinancePaymentSource | null; reason: string } {
  const availableLines = creditLines.filter((line) => line.availableAmount >= amount);
  if (availableLines.length > 0) {
    const selected = availableLines[0];
    return {
      line: selected,
      source: mapBankToPaymentSource(selected.bankName),
      reason: `${selected.bankName}: disponibilidad suficiente (${selected.availableAmount.toLocaleString("es-ES")} €). Coste pendiente de configurar.`,
    };
  }

  if (cashBalance >= amount) {
    return {
      line: null,
      source: "cash",
      reason: "Caja propia suficiente; se reserva para pagos no financiables si no hay línea disponible.",
    };
  }

  return {
    line: null,
    source: null,
    reason: "Sin disponibilidad suficiente en líneas ni caja propia.",
  };
}

/**
 * @deprecated No usar para generar vencimientos de lineas.
 * El modelo oficial es finance_create_credit_line_drawdown + finance_credit_line_repayment_groups.
 * Este servicio queda solo como compatibilidad legacy hasta eliminar usos antiguos.
 */
export async function syncCreditLineDueFromSupplierPayment(
  supplierPaymentId: string,
): Promise<void> {
  const supabase = createSupabaseRouteClient();

  const { data: payment, error: paymentError } = await supabase
    .from("finance_supplier_payments")
    .select("*")
    .eq("id", supplierPaymentId)
    .maybeSingle();

  if (paymentError) throw new Error(paymentError.message);
  if (!payment) return;

  const row = payment as SupplierPaymentRow;
  if (row.status === "pagado" || !row.due_date || row.amount_eur <= 0) return;

  const { data: lines, error: linesError } = await supabase
    .from("finance_credit_lines")
    .select("*")
    .eq("status", "activa")
    .order("priority", { ascending: true, nullsFirst: false });

  if (linesError) throw new Error(linesError.message);

  const creditLines: FinanceCreditLine[] = (lines ?? []).map((line) => ({
    id: String(line.id),
    bankName: String(line.bank_name ?? ""),
    lineName: String(line.line_name ?? ""),
    creditLimit: asNumber(line.credit_limit),
    availableAmount: asNumber(line.available_amount),
    usedAmount: asNumber(line.used_amount),
    cycleDays: line.cycle_days == null ? null : asNumber(line.cycle_days),
    maturityDate: typeof line.maturity_date === "string" ? line.maturity_date : null,
    repaymentMode: String(line.repayment_mode ?? ""),
    priority: line.priority == null ? null : asNumber(line.priority),
    status: String(line.status ?? "activa"),
    notes: null,
  }));

  const { data: cashRows } = await supabase.from("finance_cash_accounts").select("balance");
  const cashBalance = (cashRows ?? []).reduce((sum, account) => sum + asNumber(account.balance), 0);

  const recommendation = recommendCreditLineForAmount(row.amount_eur, creditLines, cashBalance);
  if (!recommendation.line?.cycleDays) return;

  const dueDate = addDays(row.due_date, recommendation.line.cycleDays);
  const paymentTypeLabel = row.payment_type === "DEPOSITO_30" ? "Depósito 30 %" : "Balance 70 %";

  const movementPayload = {
    credit_line_id: recommendation.line.id,
    movement_type: "vencimiento_linea",
    description: `Vencimiento línea ${recommendation.line.bankName} · ${paymentTypeLabel}`,
    due_date: dueDate,
    amount: row.amount_eur,
    status: "pendiente",
    source_type: "supplier_payment",
    source_id: row.id,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from("finance_credit_line_movements")
    .select("id, paid_at")
    .eq("credit_line_id", recommendation.line.id)
    .eq("source_type", "supplier_payment")
    .eq("source_id", row.id)
    .maybeSingle();

  if (existing?.paid_at) return;

  if (existing?.id) {
    await supabase
      .from("finance_credit_line_movements")
      .update(movementPayload)
      .eq("id", existing.id);
    return;
  }

  await supabase.from("finance_credit_line_movements").insert(movementPayload);
}
