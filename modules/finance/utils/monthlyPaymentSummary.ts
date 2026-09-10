import type { FinancePlanningEvent, FinanceMonthlyBreakdown } from "../types/planning.types";

export function paymentCategory(event: FinancePlanningEvent): keyof Omit<FinanceMonthlyBreakdown, "total"> {
  if (event.obligationCategory) return event.obligationCategory;
  if (["credit_line_maturity", "credit_line_planned_maturity", "credit_line_repayment_settlement"].includes(event.type)) return "lines";
  if (event.type === "supplier_deposit") return "deposits";
  if (event.type === "supplier_balance") return "balances";
  return "others";
}

/** Missing FX is an unvalued debt, never a zero debt. Amounts stay separate by currency. */
export function unvaluedPayments(events: FinancePlanningEvent[], category?: string) {
  const amounts: Record<string, number> = {};
  for (const event of events) {
    if (!event.plannedFxPending || event.isInformational
      || !["pendiente", "parcial", "vencido"].includes(event.status)
      || (category && paymentCategory(event) !== category)) continue;
    amounts[event.originalCurrency] = (amounts[event.originalCurrency] ?? 0)
      + (event.pendingAmountOriginal ?? event.originalAmount ?? 0);
  }
  return amounts;
}

export function resolvePlannedFx(currency: string, paymentRate: unknown, orderRate: unknown, orderCurrency: unknown) {
  const positive = (value: unknown) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  };
  if (currency === "EUR") return { rate: 1, source: "order" as const };
  const payment = positive(paymentRate);
  if (payment) return { rate: payment, source: "payment" as const };
  const order = currency === String(orderCurrency ?? "").toUpperCase() ? positive(orderRate) : null;
  return { rate: order, source: order ? "order" as const : "not_configured" as const };
}
