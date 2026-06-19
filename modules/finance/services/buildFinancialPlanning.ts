import { findFinancialPlanningData } from "../repositories/financialPlanningRepository";
import { backfillMissingSupplierPayments } from "./syncSupplierPaymentsForOrder";
import {
  recommendCreditLineForAmount,
} from "./syncCreditLineDueFromSupplierPayment";
import { SUPPLIER_PAYMENT_TYPE_LABELS } from "../types/supplierPayments.types";
import type {
  FinanceCashAccount,
  FinanceCreditLine,
  FinanceEventStatus,
  FinancePlanningEvent,
  FinancePlanningQuery,
  FinancePlanningResponse,
  FinancePlanningRawData,
} from "../types/planning.types";

const MONTH_LABELS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

import { LOGISTICS_LABELS } from "../utils/logisticsLabels";

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateToMonth(date: string | null): string | null {
  return date ? date.slice(0, 7) : null;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function monthLabel(month: string): string {
  const d = new Date(`${month}-01T00:00:00`);
  return MONTH_LABELS[d.getMonth()] ?? month;
}

function statusFromRow(
  status: string | null,
  paidAt: string | null,
  date: string | null,
): FinanceEventStatus {
  if (paidAt || status === "pagado") return "pagado";
  if (status === "vencido") return "vencido";
  if (date && date < new Date().toISOString().slice(0, 10)) return "vencido";
  return "pendiente";
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function linkedOrders(container: Record<string, unknown>): Record<string, unknown>[] {
  const links = (container["contenedor_ordenes"] as Record<string, unknown>[] | null) ?? [];
  return links
    .map((link) => firstRelation(link["ordenes_compra"] as Record<string, unknown> | Record<string, unknown>[] | null))
    .filter((order): order is Record<string, unknown> => Boolean(order));
}

function agentContact(order: Record<string, unknown> | null): string | null {
  if (!order) return null;
  const agent = firstRelation(
    order["agentes_compra"] as { contacto?: string | null } | Array<{ contacto?: string | null }> | null,
  );
  return agent?.contacto?.trim() || null;
}

function logisticsLabel(value: string | null | undefined): "AGL" | "PROPIO" | "SIN_DEFINIR" {
  const v = (value ?? "SIN_DEFINIR").toUpperCase();
  if (v === "AGL" || v === "AMAZON_AGL") return "AGL";
  if (v === "PROPIO") return "PROPIO";
  return "SIN_DEFINIR";
}

function buildSupplierPaymentEvents(
  raw: FinancePlanningRawData,
  creditLines: FinanceCreditLine[],
  cashBalance: number,
): FinancePlanningEvent[] {
  const events: FinancePlanningEvent[] = [];

  for (const payment of raw.supplierPayments) {
    const order = firstRelation(
      payment["ordenes_compra"] as Record<string, unknown> | Record<string, unknown>[] | null,
    );
    const container = firstRelation(
      payment["contenedores"] as Record<string, unknown> | Record<string, unknown>[] | null,
    );
    const paymentType = asString(payment["payment_type"]);
    const dueDate = asString(payment["due_date"]);
    const amountEur = asNumber(payment["amount_eur"]);
    const recommendation = recommendCreditLineForAmount(amountEur, creditLines, cashBalance);
    const logisticsType = logisticsLabel(asString(payment["logistics_type"]));
    const title =
      paymentType === "DEPOSITO_30"
        ? SUPPLIER_PAYMENT_TYPE_LABELS.DEPOSITO_30
        : paymentType === "BALANCE_70"
          ? SUPPLIER_PAYMENT_TYPE_LABELS.BALANCE_70
          : "Pago proveedor";

    const notes = asString(payment["notes"]);
    const reason = notes ?? recommendation.reason;

    events.push({
      id: String(payment["id"]),
      type: paymentType === "DEPOSITO_30" ? "supplier_deposit" : "supplier_balance",
      title,
      date: dueDate,
      month: dateToMonth(dueDate),
      isPendingDate: !dueDate,
      status: statusFromRow(
        asString(payment["status"]),
        asString(payment["paid_at"]),
        dueDate,
      ),
      containerId: asString(container?.["id"]) ?? asString(payment["contenedor_id"]),
      containerCode: asString(container?.["identificador_embarque"]),
      orderId: asString(order?.["id"]) ?? asString(payment["orden_id"]),
      orderCode: asString(order?.["numero_orden"]),
      numeroPedidoAgente: asString(order?.["numero_pedido_agente"]),
      agentContact: agentContact(order),
      logisticsType,
      originalAmount: asNumber(payment["amount_original"]),
      originalCurrency: asString(payment["original_currency"]) ?? "USD",
      plannedFxRate: asNumber(payment["planned_fx_rate"], 0) || null,
      plannedFxSource: "order",
      plannedAmountEur: amountEur,
      paidAmountEur: payment["paid_at"] ? amountEur : null,
      recommendedSource: recommendation.source,
      recommendationReason: reason,
      canMarkPaid: true,
    });
  }

  return events;
}

function buildContainerLogisticsEvents(
  raw: FinancePlanningRawData,
  creditLines: FinanceCreditLine[],
  cashBalance: number,
): FinancePlanningEvent[] {
  const events: FinancePlanningEvent[] = [];

  for (const container of raw.containers) {
    const order = linkedOrders(container)[0] ?? null;
    const agent = agentContact(order);
    const type = logisticsLabel(asString(container["tipo_contenedor"]));
    const containerCode = asString(container["identificador_embarque"]);
    const orderCode = asString(order?.["numero_orden"]);
    const numeroPedidoAgente = asString(order?.["numero_pedido_agente"]);
    const eta = asString(container["fecha_eta_estimada"]);

    const common = {
      containerId: asString(container["id"]),
      containerCode,
      orderId: asString(order?.["id"]),
      orderCode,
      numeroPedidoAgente,
      agentContact: agent,
      logisticsType: type,
      originalCurrency: "EUR",
      plannedFxRate: null,
      plannedFxSource: "not_configured" as const,
    };

    for (const extra of [
      { key: "costo_flete_total_eur", type: "container_freight" as const, title: "Flete" },
      { key: "gastos_llegada_puerto_eur", type: "container_arrival_expense" as const, title: "Gastos llegada puerto" },
      { key: "costo_transito_total_eur", type: "container_transit" as const, title: "Transito / seguro" },
      { key: "comision_bancaria_eur", type: "container_bank_fee" as const, title: "Comision bancaria" },
    ]) {
      const amount = asNumber(container[extra.key], 0);
      if (amount <= 0) continue;
      const recommendation = recommendCreditLineForAmount(amount, creditLines, cashBalance);
      events.push({
        ...common,
        id: `${container["id"]}-${extra.key}`,
        type: extra.type,
        title: extra.title,
        date: eta,
        month: dateToMonth(eta),
        isPendingDate: !eta,
        status: statusFromRow(null, null, eta),
        originalAmount: amount,
        plannedAmountEur: amount,
        paidAmountEur: null,
        recommendedSource: recommendation.source,
        recommendationReason: recommendation.reason,
        canMarkPaid: false,
      });
    }
  }

  return events;
}

function isSupplierOrContainerPayment(type: string): boolean {
  return type.startsWith("supplier_") || type.startsWith("container_");
}

/**
 * Construye la planificacion visual mensual sin decidir por coste de linea.
 */
export async function buildFinancialPlanning(
  query: FinancePlanningQuery,
): Promise<FinancePlanningResponse> {
  console.log("[finance/planning] buildFinancialPlanning start");
  const backfillResult = await backfillMissingSupplierPayments();
  console.log("[finance/planning] backfill completed", backfillResult);
  const raw = await findFinancialPlanningData(query);
  const creditLines: FinanceCreditLine[] = raw.creditLines.map((row) => ({
    id: String(row["id"]),
    bankName: String(row["bank_name"] ?? ""),
    lineName: String(row["line_name"] ?? ""),
    creditLimit: asNumber(row["credit_limit"]),
    availableAmount: asNumber(row["available_amount"]),
    usedAmount: asNumber(row["used_amount"]),
    cycleDays: row["cycle_days"] == null ? null : asNumber(row["cycle_days"]),
    repaymentMode: String(row["repayment_mode"] ?? ""),
    priority: row["priority"] == null ? null : asNumber(row["priority"]),
    status: String(row["status"] ?? "activa"),
    notes: asString(row["notes"]),
  }));
  const cashAccounts: FinanceCashAccount[] = raw.cashAccounts.map((row) => ({
    id: String(row["id"]),
    name: String(row["name"] ?? ""),
    balance: asNumber(row["balance"]),
    currency: String(row["currency"] ?? "EUR"),
  }));
  const cashBalance = cashAccounts.reduce((sum, account) => sum + account.balance, 0);
  const globalFxRaw = raw.settings.find((row) => row["key"] === "planned_usd_eur_rate")?.["value"];
  const globalFxRate = globalFxRaw ? asNumber(globalFxRaw, 0) || null : null;
  const totalCreditAvailable = creditLines.reduce((sum, line) => sum + line.availableAmount, 0);

  const events = [
    ...buildSupplierPaymentEvents(raw, creditLines, cashBalance),
    ...buildContainerLogisticsEvents(raw, creditLines, cashBalance),
  ];

  for (const movement of raw.creditLineMovements) {
    const line = creditLines.find((item) => item.id === movement["credit_line_id"]);
    const date = asString(movement["due_date"]);
    const amount = asNumber(movement["amount"]);
    const movementType = asString(movement["movement_type"]);
    const isRelease = movementType === "vencimiento_linea" || movementType === "periodic_release";
    events.push({
      id: String(movement["id"]),
      type: "credit_line_release",
      title: isRelease
        ? `Vencimiento línea ${line?.bankName ?? "línea"}`
        : `Liberacion ${line?.bankName ?? "linea"}`,
      date,
      month: dateToMonth(date),
      isPendingDate: !date,
      status: movement["paid_at"] ? "pagado" : statusFromRow(null, null, date),
      containerId: null,
      containerCode: null,
      orderId: null,
      orderCode: null,
      numeroPedidoAgente: null,
      agentContact: null,
      logisticsType: "SIN_DEFINIR",
      originalAmount: amount,
      originalCurrency: "EUR",
      plannedFxRate: null,
      plannedFxSource: "not_configured",
      plannedAmountEur: amount,
      paidAmountEur: movement["paid_at"] ? amount : null,
      recommendedSource: "cash",
      recommendationReason: "Una linea no paga otra linea; se libera con caja propia.",
      canMarkPaid: false,
      creditLineBank: line?.bankName ?? null,
      sourcePaymentId: asString(movement["source_id"]),
    } as FinancePlanningEvent);
  }

  for (const income of raw.amazonIncomeForecasts) {
    const date = asString(income["forecast_date"]);
    const amount = asNumber(income["amount_eur"]);
    events.push({
      id: String(income["id"]),
      type: "amazon_income",
      title: asString(income["description"]) ?? "Ingreso Amazon previsto",
      date,
      month: dateToMonth(date),
      isPendingDate: !date,
      status: "previsto",
      containerId: null,
      containerCode: null,
      orderId: null,
      orderCode: null,
      numeroPedidoAgente: null,
      agentContact: null,
      logisticsType: "SIN_DEFINIR",
      originalAmount: amount,
      originalCurrency: "EUR",
      plannedFxRate: null,
      plannedFxSource: "not_configured",
      plannedAmountEur: amount,
      paidAmountEur: null,
      recommendedSource: null,
      recommendationReason: "Ingreso manual/configurable.",
      canMarkPaid: false,
    });
  }

  const fromMonth = query.fromMonth ?? new Date().toISOString().slice(0, 7);
  const monthsCount = query.months ?? 6;
  let projectedCash = cashBalance;
  let projectedCredit = totalCreditAvailable;
  const months = Array.from({ length: monthsCount }, (_, index) => {
    const d = addMonths(new Date(`${fromMonth}-01T00:00:00`), index);
    const month = d.toISOString().slice(0, 7);
    const monthEvents = events
      .filter((event) => event.month === month)
      .sort((a, b) => (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31"));
    const datedEvents = monthEvents.filter((event) => !event.isPendingDate);
    const pendingDateEvents = monthEvents.filter((event) => event.isPendingDate);

    for (const event of datedEvents) {
      if (event.type === "amazon_income") projectedCash += event.plannedAmountEur;
      if (event.type === "credit_line_release") {
        projectedCash -= event.plannedAmountEur;
        projectedCredit += event.plannedAmountEur;
      }
      if (isSupplierOrContainerPayment(event.type) && event.recommendedSource === "cash") {
        projectedCash -= event.plannedAmountEur;
      }
      if (isSupplierOrContainerPayment(event.type) && event.recommendedSource && event.recommendedSource !== "cash") {
        projectedCredit -= event.plannedAmountEur;
      }
    }

    return {
      month,
      label: monthLabel(month),
      totalPendingPayments: datedEvents
        .filter((event) => event.status === "pendiente" || event.status === "vencido")
        .reduce((sum, event) => sum + event.plannedAmountEur, 0),
      totalPaidPayments: datedEvents
        .filter((event) => event.status === "pagado")
        .reduce((sum, event) => sum + event.plannedAmountEur, 0),
      totalIncome: datedEvents
        .filter((event) => event.type === "amazon_income")
        .reduce((sum, event) => sum + event.plannedAmountEur, 0),
      totalCreditReleases: datedEvents
        .filter((event) => event.type === "credit_line_release")
        .reduce((sum, event) => sum + event.plannedAmountEur, 0),
      projectedCashBalance: projectedCash,
      projectedCreditAvailable: projectedCredit,
      events: datedEvents,
      pendingDateEvents,
    };
  });

  return {
    ok: true,
    summary: {
      totalCreditLimit: creditLines.reduce((sum, line) => sum + line.creditLimit, 0),
      totalCreditUsed: creditLines.reduce((sum, line) => sum + line.usedAmount, 0),
      totalCreditAvailable,
      cashBalance,
      pendingPayments: events
        .filter((event) => event.status === "pendiente" || event.status === "vencido")
        .reduce((sum, event) => sum + event.plannedAmountEur, 0),
      paidPayments: events
        .filter((event) => event.status === "pagado")
        .reduce((sum, event) => sum + event.plannedAmountEur, 0),
      plannedIncome: events
        .filter((event) => event.type === "amazon_income")
        .reduce((sum, event) => sum + event.plannedAmountEur, 0),
      plannedUsdEurRate: globalFxRate,
      plannedUsdEurRateSource: globalFxRate ? "global_setting" : "not_configured",
    },
    creditLines,
    cashAccounts,
    months,
  };
}
