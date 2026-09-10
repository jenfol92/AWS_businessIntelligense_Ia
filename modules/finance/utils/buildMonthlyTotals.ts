import type { FinancePlanningEvent } from "../types/planning.types";

function eventCategory(event: FinancePlanningEvent): "lines" | "deposits" | "balances" | "others" {
  if (event.obligationCategory) return event.obligationCategory;
  if (["credit_line_maturity", "credit_line_planned_maturity", "credit_line_repayment_settlement"].includes(event.type)) return "lines";
  if (event.type === "supplier_deposit") return "deposits";
  if (event.type === "supplier_balance") return "balances";
  return "others";
}

export function buildMonthlyTotals(events: FinancePlanningEvent[]) {
  const empty = { lines: 0, deposits: 0, balances: 0, others: 0, total: 0 };
  const pending = { ...empty };
  const paid = { ...empty };
  for (const event of events) {
    if (event.isInformational || event.type === "amazon_income") continue;
    const category = eventCategory(event);
    if (["pendiente", "parcial", "vencido"].includes(event.status)
      || (event.type === "credit_line_planned_maturity" && event.status === "previsto")) {
      pending[category] += event.plannedAmountEur;
    }
    if (event.status === "pagado") paid[category] += paidEventAmountEur(event);
  }
  pending.total = pending.lines + pending.deposits + pending.balances + pending.others;
  paid.total = paid.lines + paid.deposits + paid.balances + paid.others;
  return { totalPendingPayments: pending.total, totalPaidPayments: paid.total, pendingBreakdown: pending, paidBreakdown: paid };
}

function paidEventAmountEur(event: FinancePlanningEvent): number {
  if (event.type === "unlinked_payment_settlement") return event.paidAmountEur ?? 0;
  if (event.type === "supplier_payment_settlement") return event.allocatedAmountEur ?? 0;
  if (event.type === "supplier_deposit" || event.type === "supplier_balance") return 0;
  return event.status === "pagado" ? event.plannedAmountEur : 0;
}
