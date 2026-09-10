import type { FinancePlanningEvent } from "../types/planning.types";

export function buildRecurringPaymentEvents(rows: Record<string, unknown>[]): FinancePlanningEvent[] {
  return rows.map(row => {
    const amount = Number(row.amount_eur);
    const date = String(row.date);
    const displayDate = String(row.display_date ?? row.date);
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !["pendiente", "parcial", "vencido", "pagado"].includes(String(row.status))) throw new Error("INVALID_RECURRING_CALENDAR");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(displayDate) || displayDate < date) throw new Error("INVALID_RECURRING_CALENDAR");
    const paid = row.status === "pagado";
    return {
      id: `unlinked:${row.id}`, type: paid ? "unlinked_payment_settlement" : "unlinked_obligation",
      title: String(row.concept), date, displayDate, month: displayDate.slice(0, 7), isPendingDate: false,
      status: row.status as FinancePlanningEvent["status"], obligationCategory: "others",
      containerId: null, containerCode: null, orderId: null, orderCode: null, numeroPedidoAgente: null,
      agentContact: null, logisticsType: "SIN_DEFINIR", originalCurrency: "EUR", originalAmount: amount,
      plannedFxRate: 1, plannedFxSource: "order", plannedAmountEur: paid ? 0 : amount,
      paidAmountEur: paid ? amount : null, actualAmountEur: paid ? amount : null,
      recommendedSource: "cash", recommendationReason: "Pago recurrente con cargo a la cuenta elegida.", canMarkPaid: Boolean(row.can_pay),
      unlinkedInstallmentId: row.installment_id ? String(row.installment_id) : undefined,
      unlinkedTemplateId: row.template_id ? String(row.template_id) : undefined,
      paymentCashAccountId: row.cash_account_id ? String(row.cash_account_id) : null,
      paymentTypeName: row.payment_type ? String(row.payment_type) : "Otros",
    };
  });
}
