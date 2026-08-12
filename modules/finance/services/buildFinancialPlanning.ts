import { findFinancialPlanningData } from "../repositories/financialPlanningRepository";
import {
  isActiveCreditLineStatus,
  isDeletedCreditLineStatus,
} from "@/modules/finance/utils/creditLineStatus";
import { recommendCreditLineForAmount } from "./syncCreditLineDueFromSupplierPayment";
import { getSupplierPaymentPercentLabel } from "../types/supplierPayments.types";
import type { SupplierPaymentType } from "../types/supplierPayments.types";
import type {
  FinanceCashAccount,
  FinanceCreditLine,
  FinanceEventStatus,
  FinancePaymentSource,
  FinancePlanningEvent,
  FinancePlanningQuery,
  FinancePlanningResponse,
  FinancePlanningRawData,
  FinanceSupplierPaymentSourceType,
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
import { partitionFinanceEventsByDate } from "../utils/partitionFinanceEventsByDate";
import { resolveLegacySupplierPaymentSettlement } from "../utils/legacySupplierPaymentSettlement";
import { createCreditReleaseTracker } from "../utils/creditLinePlannedRelease";
import { evaluateTreasury, type TreasuryEvent } from "./treasuryEngine";
import { buildMarketplaceCashCards, summarizeAmazonCashByMonth, type AmazonCashItem } from "./amazonCashForecast";

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sumKnown(values: Array<number | null | undefined>): number | null {
  const known = values.filter((value): value is number => value != null && Number.isFinite(value));
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
}

function eventCategory(event: FinancePlanningEvent): "lines" | "deposits" | "balances" | "others" {
  if (event.obligationCategory) return event.obligationCategory;
  if (["credit_line_maturity", "credit_line_planned_maturity", "credit_line_repayment_settlement"].includes(event.type)) return "lines";
  if (event.type === "supplier_deposit") return "deposits";
  if (event.type === "supplier_balance") return "balances";
  return "others";
}

function buildMonthlyTotals(events: FinancePlanningEvent[]) {
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

function paidRealAmountEur(payment: Record<string, unknown>): number {
  const actual = asNumber(payment["actual_amount_eur"], NaN);
  if (Number.isFinite(actual) && actual > 0) return actual;
  return 0;
}

function paidRealAmountOriginal(payment: Record<string, unknown>): number {
  const actual = asNumber(payment["actual_amount_original"], NaN);
  if (Number.isFinite(actual) && actual > 0) return actual;

  const isLegacyPaid = Boolean(asString(payment["paid_at"])) || asString(payment["status"]) === "pagado";
  return isLegacyPaid ? asNumber(payment["amount_original"]) : 0;
}

function purchasePaymentAllocationStats(payment: Record<string, unknown>) {
  const rows = (payment["finance_purchase_payment_allocations"] as Record<string, unknown>[] | null) ?? [];
  const active = rows
    .map((allocation) => {
      const batch = firstRelation(
        allocation["finance_purchase_payment_batches"] as Record<string, unknown> | Record<string, unknown>[] | null,
      );
      return batch && asString(batch["status"]) !== "reversed" ? { allocation, batch } : null;
    })
    .filter((row): row is { allocation: Record<string, unknown>; batch: Record<string, unknown> } => Boolean(row))
    .sort((a, b) => (asString(b.batch["paid_at"]) ?? "").localeCompare(asString(a.batch["paid_at"]) ?? ""));
  const sources = new Set(active.map((row) => asString(row.batch["source_type"])).filter(Boolean));
  const allocatedOriginal = active.reduce(
    (sum, row) => sum + asNumber(row.allocation["allocated_amount_original"]),
    0,
  );
  const allocatedEur = active.reduce(
    (sum, row) => sum + asNumber(row.allocation["allocated_amount_eur"]),
    0,
  );
  const latest = active[0]?.batch ?? null;
  return {
    active,
    allocatedOriginal,
    allocatedEur,
    count: active.length,
    latest,
    sourceType: sources.size === 1
      ? supplierPaymentSourceType(Array.from(sources)[0])
      : null,
    mixedSources: sources.size > 1,
    weightedFxRate: allocatedOriginal > 0 ? allocatedEur / allocatedOriginal : null,
  };
}

function buildOrderPaymentStats(payments: Record<string, unknown>[]) {
  const stats = new Map<string, {
    totalOriginal: number;
    paidRealOriginal: number;
    paidRealEur: number;
  }>();

  for (const payment of payments) {
    const order = firstRelation(
      payment["ordenes_compra"] as Record<string, unknown> | Record<string, unknown>[] | null,
    );
    const orderId = asString(order?.["id"]) ?? asString(payment["orden_id"]);
    if (!orderId) continue;

    const current = stats.get(orderId) ?? {
      totalOriginal: 0,
      paidRealOriginal: 0,
      paidRealEur: 0,
    };
    const paidReal = paidRealAmountEur(payment);
    const paidRealOriginal = paidRealAmountOriginal(payment);
    if (paidReal > 0 || paidRealOriginal > 0) {
      current.paidRealEur += paidReal;
      current.paidRealOriginal += paidRealOriginal;
    }

    stats.set(orderId, current);
  }

  for (const [orderId, current] of Array.from(stats.entries())) {
    if (current.totalOriginal <= 0) {
      const orderPayments = payments.filter((payment) => {
        const order = firstRelation(
          payment["ordenes_compra"] as Record<string, unknown> | Record<string, unknown>[] | null,
        );
        return (asString(order?.["id"]) ?? asString(payment["orden_id"])) === orderId;
      });
      current.totalOriginal = orderPayments.reduce((sum, payment) => sum + asNumber(payment["amount_original"]), 0);
    }
  }

  return stats;
}

function supplierPaymentSourceType(value: unknown): FinanceSupplierPaymentSourceType | null {
  if (value === "cash_account" || value === "credit_line") {
    return value;
  }
  // Legacy de solo lectura: no se propaga como fuente operativa nueva.
  if (value === "manual") {
    return null;
  }
  return null;
}

function supplierPaymentSource(value: unknown): FinancePaymentSource | null {
  if (value === "cash" || value === "caja_rural" || value === "la_caixa" || value === "bbva") {
    return value;
  }
  return null;
}

function dateToMonth(date: string | null): string | null {
  return date ? date.slice(0, 7) : null;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
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
  if (status === "parcial") return "parcial";
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

function supplierPaymentEventType(
  paymentType: string | null,
): { paymentType: SupplierPaymentType; eventType: "supplier_deposit" | "supplier_balance" } | null {
  if (paymentType === "DEPOSITO_30") {
    return { paymentType, eventType: "supplier_deposit" };
  }

  if (paymentType === "BALANCE_70") {
    return { paymentType, eventType: "supplier_balance" };
  }

  return null;
}

function buildSupplierPaymentEvents(
  raw: FinancePlanningRawData,
  creditLines: FinanceCreditLine[],
  cashBalance: number,
): FinancePlanningEvent[] {
  const events: FinancePlanningEvent[] = [];
  const orderPaymentStats = buildOrderPaymentStats(raw.supplierPayments);
  const batchesWithRecordedFees = new Set<string>();

  for (const payment of raw.supplierPayments) {
    const order = firstRelation(
      payment["ordenes_compra"] as Record<string, unknown> | Record<string, unknown>[] | null,
    );
    const rawStatus = asString(payment["status"]);
    const container = firstRelation(
      payment["contenedores"] as Record<string, unknown> | Record<string, unknown>[] | null,
    );
    const paymentType = asString(payment["payment_type"]);
    const mappedPaymentType = supplierPaymentEventType(paymentType);
    if (!mappedPaymentType) continue;

    const dueDate = asString(payment["due_date"]);
    const storedPlannedAmountEur = asNumber(payment["amount_eur"]);
    const plannedOriginalAmount = asNumber(payment["amount_original"]);
    const allocationStats = purchasePaymentAllocationStats(payment);
    const allocatedOriginal = allocationStats.count > 0
      ? allocationStats.allocatedOriginal
      : paidRealAmountOriginal(payment);
    const pendingOriginal = Math.max(0, plannedOriginalAmount - allocatedOriginal);
    const originalCurrency = (asString(payment["original_currency"]) ?? "USD").toUpperCase();
    const plannedFxForeignPerEur = originalCurrency === "EUR"
      ? 1
      : (asNumber(payment["planned_fx_foreign_per_eur"], 0) || null);
    const plannedFxPending = originalCurrency !== "EUR" && plannedFxForeignPerEur == null;
    const plannedFxRate = asNumber(payment["planned_fx_rate"], 0) || (originalCurrency === "EUR" ? 1 : null);
    const actualAmountEur = (allocationStats.count > 0
      ? allocationStats.allocatedEur
      : paidRealAmountEur(payment)) || null;
    const actualAmountOriginal = allocatedOriginal || null;
    const actualFxRate = allocationStats.weightedFxRate
      ?? (asNumber(payment["actual_fx_rate"], 0) || null);
    const actualFxForeignPerEur = asNumber(allocationStats.latest?.["actual_fx_foreign_per_eur"],0)
      || asNumber(payment["actual_fx_foreign_per_eur"],0) || null;
    const paidAt = asString(allocationStats.latest?.["paid_at"]) ?? asString(payment["paid_at"]);
    const paymentSource = supplierPaymentSource(payment["payment_source"]);
    const bankReference = asString(allocationStats.latest?.["bank_reference"])
      ?? asString(payment["bank_reference"]);
    const bankFeeEur = asNumber(allocationStats.latest?.["bank_fee_eur"], 0)
      || asNumber(payment["bank_fee_eur"], 0)
      || null;
    const ffFeeEur = asNumber(allocationStats.latest?.["ff_fee_eur"], 0)
      || asNumber(payment["ff_fee_eur"], 0)
      || null;
    const orderId = asString(order?.["id"]) ?? asString(payment["orden_id"]);
    const orderStats = orderId ? orderPaymentStats.get(orderId) : null;
    const orderTotalEur = null;
    const orderTotalOriginal = orderStats?.totalOriginal && orderStats.totalOriginal > 0
      ? orderStats.totalOriginal
      : null;
    const orderPaidRealOriginal = orderStats?.paidRealOriginal ?? 0;
    const orderPendingRealOriginal = orderTotalOriginal != null
      ? Math.max(0, orderTotalOriginal - orderPaidRealOriginal)
      : null;
    const orderPaidRealEur = orderStats?.paidRealEur ?? 0;
    const orderPendingRealEur = null;
    const displayOriginalAmount = plannedOriginalAmount;
    const displayAmountEur = originalCurrency === "EUR"
      ? pendingOriginal
      : plannedFxForeignPerEur != null
        ? pendingOriginal / plannedFxForeignPerEur
        : 0;
    const recommendation = recommendCreditLineForAmount(displayAmountEur, creditLines, cashBalance);
    const logisticsType = logisticsLabel(asString(payment["logistics_type"]));
    const depositPercent = asNumber(order?.["deposito_porcentaje"], 30);
    const balancePercent = 100 - depositPercent;
    const title = getSupplierPaymentPercentLabel(
      mappedPaymentType.paymentType,
      order ? depositPercent : null,
    );

    const notes = asString(payment["notes"]);
    const isLegacyManual = asString(payment["payment_source_type"]) === "manual";
    const legacyManualMessage =
      "Obligación legacy manual de solo lectura. Debe regularizarse antes de operar.";
    const reason = isLegacyManual ? legacyManualMessage : notes ?? recommendation.reason;
    const canonicalStatus = allocationStats.count > 0
      ? allocatedOriginal >= plannedOriginalAmount - 0.0001
        ? "pagado"
        : allocatedOriginal > 0.0001
          ? "parcial"
          : null
      : null;
    const status = statusFromRow(
      canonicalStatus ?? rawStatus,
      canonicalStatus === "pagado" || (!canonicalStatus && rawStatus === "pagado")
        ? paidAt
        : null,
      dueDate,
    );
    const displayStatus = status === "pagado" ? "pagado" : status;

    if (pendingOriginal > 0.0001) events.push({
      id: String(payment["id"]),
      type: mappedPaymentType.eventType,
      title,
      date: dueDate,
      month: dateToMonth(dueDate),
      isPendingDate: !dueDate,
      status: displayStatus === "pagado" ? "parcial" : displayStatus,
      containerId: asString(container?.["id"]) ?? asString(payment["contenedor_id"]),
      containerCode: asString(container?.["identificador_embarque"]),
      orderId,
      orderCode: asString(order?.["numero_orden"]),
      numeroPedidoAgente: asString(order?.["numero_pedido_agente"]),
      agentContact: agentContact(order),
      logisticsType,
      originalAmount: displayOriginalAmount,
      allocatedAmountOriginal: allocatedOriginal,
      pendingAmountOriginal: pendingOriginal,
      allocatedAmountEur: allocationStats.allocatedEur,
      linkedBatchCount: allocationStats.count,
      latestBatchId: asString(allocationStats.latest?.["id"]),
      latestBatchReference: bankReference,
      hasMixedPaymentSources: allocationStats.mixedSources,
      originalCurrency,
      depositPercent,
      balancePercent,
      plannedFxRate,
      plannedFxForeignPerEur,
      plannedFxPending,
      estimatedPendingEur: plannedFxPending ? null : displayAmountEur,
      provisionalCostEur: plannedFxPending ? null : (actualAmountEur ?? 0) + displayAmountEur,
      plannedFxSource: plannedFxRate != null ? "legacy" : "not_configured",
      plannedAmountEur: displayAmountEur,
      paidAmountEur: null,
      actualAmountOriginal,
      actualAmountEur,
      actualFxRate,
      actualFxForeignPerEur,
      actualFxRateIsWeighted: allocationStats.count > 1,
      paidAt,
      paymentSource,
      bankReference,
      bankFeeEur: allocationStats.count > 0 ? null : bankFeeEur,
      ffFeeEur: allocationStats.count > 0 ? null : ffFeeEur,
      orderTotalEur,
      orderPaidRealOriginal,
      orderPendingRealOriginal,
      orderPaidRealEur,
      orderPendingRealEur,
      recommendedSource: isLegacyManual ? null : recommendation.source,
      recommendationReason: reason,
      canMarkPaid: !isLegacyManual,
      obligationCategory: mappedPaymentType.eventType === "supplier_deposit" ? "deposits" : "balances",
      paymentSourceType: allocationStats.count > 0
        ? allocationStats.sourceType
        : supplierPaymentSourceType(payment["payment_source_type"]),
      paymentCashAccountId: asString(payment["cash_account_id"]),
      paymentCreditLineId: asString(payment["credit_line_id"]),
    });

    const legacySettlement = resolveLegacySupplierPaymentSettlement(payment, allocationStats.count);
    if (legacySettlement) {
      events.push({
        id: legacySettlement.id,
        type: "supplier_payment_settlement",
        title: `${title} pagado (legacy)`,
        date: legacySettlement.date,
        month: dateToMonth(legacySettlement.date),
        isPendingDate: !legacySettlement.date,
        status: "pagado",
        containerId: asString(container?.["id"]) ?? asString(payment["contenedor_id"]),
        containerCode: asString(container?.["identificador_embarque"]),
        orderId,
        orderCode: asString(order?.["numero_orden"]),
        numeroPedidoAgente: asString(order?.["numero_pedido_agente"]),
        agentContact: agentContact(order),
        logisticsType,
        originalAmount: legacySettlement.originalAmount,
        allocatedAmountOriginal: legacySettlement.originalAmount,
        pendingAmountOriginal: null,
        allocatedAmountEur: legacySettlement.amountEur,
        linkedBatchCount: 0,
        latestBatchId: null,
        latestBatchReference: asString(payment["bank_reference"]),
        hasMixedPaymentSources: false,
        originalCurrency,
        depositPercent,
        balancePercent,
        plannedFxRate: asNumber(payment["actual_fx_rate"], 0) || null,
        plannedFxSource: "not_configured",
        plannedAmountEur: 0,
        paidAmountEur: legacySettlement.amountEur,
        actualAmountOriginal: legacySettlement.originalAmount,
        actualAmountEur: legacySettlement.amountEur,
        actualFxRate: asNumber(payment["actual_fx_rate"], 0) || null,
        actualFxRateIsWeighted: false,
        paidAt: legacySettlement.paidAt,
        paymentSource: supplierPaymentSource(payment["payment_source"]),
        bankReference: asString(payment["bank_reference"]),
        bankFeeEur: asNumber(payment["bank_fee_eur"], 0) || null,
        ffFeeEur: asNumber(payment["ff_fee_eur"], 0) || null,
        recommendedSource: null,
        recommendationReason: isLegacyManual
          ? legacyManualMessage
          : "Settlement legacy histórico; el movimiento ya está incluido en saldos actuales.",
        canMarkPaid: false,
        paymentSourceType: supplierPaymentSourceType(payment["payment_source_type"]),
        sourcePaymentId: String(payment["id"]),
        obligationCategory: mappedPaymentType.eventType === "supplier_deposit" ? "deposits" : "balances",
      });
    }

    for (const { allocation, batch } of allocationStats.active) {
      const batchId = String(batch["id"]);
      const includeBatchFees = !batchesWithRecordedFees.has(batchId);
      batchesWithRecordedFees.add(batchId);
      const settlementPaidAt = asString(batch["paid_at"]);
      const settlementDate = settlementPaidAt ? settlementPaidAt.slice(0, 10) : null;
      const settlementEur = asNumber(allocation["allocated_amount_eur"]);
      events.push({
        id: `${String(payment["id"])}:${batchId}`,
        type: "supplier_payment_settlement",
        title: `${title} pagado`,
        date: settlementDate,
        month: dateToMonth(settlementDate),
        isPendingDate: !settlementDate,
        status: "pagado",
        obligationCategory: mappedPaymentType.eventType === "supplier_deposit" ? "deposits" : "balances",
        containerId: asString(container?.["id"]) ?? asString(payment["contenedor_id"]),
        containerCode: asString(container?.["identificador_embarque"]),
        orderId,
        orderCode: asString(order?.["numero_orden"]),
        numeroPedidoAgente: asString(order?.["numero_pedido_agente"]),
        agentContact: agentContact(order),
        logisticsType,
        originalAmount: asNumber(allocation["allocated_amount_original"]),
        allocatedAmountOriginal: asNumber(allocation["allocated_amount_original"]),
        pendingAmountOriginal: null,
        allocatedAmountEur: settlementEur,
        linkedBatchCount: 1,
        latestBatchId: asString(batch["id"]),
        latestBatchReference: asString(batch["bank_reference"]),
        hasMixedPaymentSources: false,
        originalCurrency,
        depositPercent,
        balancePercent,
        plannedFxRate: asNumber(batch["actual_fx_rate"], 0) || null,
        plannedFxSource: "not_configured",
        plannedAmountEur: 0,
        paidAmountEur: settlementEur,
        actualAmountOriginal: asNumber(allocation["allocated_amount_original"]),
        actualAmountEur: settlementEur,
        actualFxRate: asNumber(batch["actual_fx_rate"], 0) || null,
        actualFxRateIsWeighted: false,
        paidAt: settlementPaidAt,
        paymentSource: null,
        bankReference: asString(batch["bank_reference"]),
        // Las comisiones pertenecen al batch y se cuentan una sola vez aunque tenga varias allocations.
        bankFeeEur: includeBatchFees ? asNumber(batch["bank_fee_eur"], 0) : null,
        ffFeeEur: includeBatchFees ? asNumber(batch["ff_fee_eur"], 0) : null,
        recommendedSource: null,
        recommendationReason: "Settlement historico; el movimiento ya esta incluido en saldos actuales.",
        canMarkPaid: false,
        paymentSourceType: supplierPaymentSourceType(batch["source_type"]),
        sourcePaymentId: String(payment["id"]),
      });
    }
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

function buildCreditLineRepaymentGroupEvents(
  raw: FinancePlanningRawData,
  creditLines: FinanceCreditLine[],
): FinancePlanningEvent[] {
  const events: FinancePlanningEvent[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const legacyCosts = new Map(raw.creditLineLegacyRegularizationItems.map((item) => [
    asString(item["repayment_group_id"]),
    {
      interest: item["expected_interest_eur"] == null ? null : asNumber(item["expected_interest_eur"]),
      fees: item["expected_fees_eur"] == null ? null : asNumber(item["expected_fees_eur"]),
    },
  ]));

  for (const group of raw.creditLineRepaymentGroups) {
    const creditLineId = asString(group["credit_line_id"]);
    const line = creditLines.find((item) => item.id === creditLineId);
    const dueDate = asString(group["due_date"]);
    const remainingAmount = asNumber(group["remaining_amount"]);
    const originalAmount = asNumber(group["amount"]);
    const paidAmount = asNumber(group["paid_amount"]);
    const groupStatus = asString(group["status"]);
    const isLegacyOpeningBalance = group["group_origin_type"] === "legacy_regularization";
    const knownCosts = legacyCosts.get(asString(group["id"]));
    if (!line || remainingAmount <= 0) continue;
    if (groupStatus !== "open" && groupStatus !== "partially_paid") continue;

    const overdue = Boolean(dueDate && dueDate < today);
    const status: FinanceEventStatus =
      groupStatus === "partially_paid"
        ? "parcial"
        : overdue
          ? "vencido"
          : "pendiente";

    const daysUntilDue = dueDate
      ? Math.round(
          (Date.parse(`${dueDate}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`))
            / 86400000,
        )
      : null;

    events.push({
      id: String(group["id"]),
      type: "credit_line_maturity",
      title: isLegacyOpeningBalance ? "Deuda inicial" : "Vencimiento de linea de credito",
      date: dueDate,
      month: dateToMonth(dueDate),
      isPendingDate: !dueDate,
      status,
      containerId: null,
      containerCode: null,
      orderId: null,
      orderCode: null,
      numeroPedidoAgente: null,
      agentContact: null,
      logisticsType: "SIN_DEFINIR",
      originalAmount: originalAmount,
      originalCurrency: "EUR",
      plannedFxRate: null,
      plannedFxSource: "not_configured",
      plannedAmountEur: remainingAmount,
      paidAmountEur: paidAmount,
      recommendedSource: "cash",
      recommendationReason: "Devolucion de linea con saldo pendiente real.",
      canMarkPaid: false,
      creditLineId: line.id,
      creditLineBank: line.bankName,
      creditLineName: line.lineName,
      paidLineAmountEur: paidAmount,
      repaymentGroupId: asString(group["id"]),
      repaymentGroupStatus: groupStatus,
      originalAmountEur: originalAmount,
      remainingAmountEur: remainingAmount,
      daysUntilDue,
      canRepay: remainingAmount > 0,
      isLegacyOpeningBalance,
      expectedInterestEur: knownCosts?.interest ?? null,
      expectedFeesEur: knownCosts?.fees ?? null,
      isInformational: false,
    });
  }

  return events;
}

function buildCreditLineRepaymentSettlementEvents(
  raw: FinancePlanningRawData,
): FinancePlanningEvent[] {
  return raw.creditLineRepaymentMovements.map((row) => {
    const relation = row["finance_credit_lines"] as Record<string, unknown> | Record<string, unknown>[] | null;
    const line = Array.isArray(relation) ? relation[0] : relation;
    const paidAt = asString(row["effective_date"]);
    const principal = asNumber(row["principal_paid_eur"]);
    const interest = asNumber(row["interest_paid_eur"]);
    const fees = asNumber(row["fees_paid_eur"]);
    const amount = asNumber(row["total_cash_out_eur"], principal + interest + fees);
    const groupRelation = row["finance_credit_line_repayment_groups"] as Record<string, unknown> | Record<string, unknown>[] | null;
    const repaymentGroup = Array.isArray(groupRelation) ? groupRelation[0] : groupRelation;
    const isLegacyOpeningBalance = repaymentGroup?.["group_origin_type"] === "legacy_regularization";
    return {
      id: `credit-repayment-${String(row["id"])}`,
      type: "credit_line_repayment_settlement" as const,
      title: isLegacyOpeningBalance ? "Deuda inicial pagada" : "Devolucion de credito pagada",
      date: paidAt?.slice(0, 10) ?? null,
      month: dateToMonth(paidAt?.slice(0, 10) ?? null),
      isPendingDate: !paidAt,
      status: "pagado" as const,
      containerId: null, containerCode: null, orderId: null, orderCode: null,
      numeroPedidoAgente: null, agentContact: null, logisticsType: "SIN_DEFINIR" as const,
      originalAmount: amount, originalCurrency: "EUR", plannedFxRate: null,
      plannedFxSource: "not_configured" as const, plannedAmountEur: amount,
      paidAmountEur: amount, recommendedSource: null,
      recommendationReason: "Amortizacion realmente ejecutada.", canMarkPaid: false,
      creditLineId: asString(row["credit_line_id"]),
      creditLineBank: asString(line?.["bank_name"]),
      creditLineName: asString(line?.["line_name"]),
      paidLineAmountEur: amount,
      plannedPrincipalEur: principal,
      expectedInterestEur: interest,
      expectedFeesEur: fees,
      repaymentGroupId: asString(row["repayment_group_id"]),
      isInformational: false,
      obligationCategory: "lines" as const,
      isLegacyOpeningBalance,
    };
  });
}

function buildCreditLinePlannedMaturityEvents(raw: FinancePlanningRawData): FinancePlanningEvent[] {
  const today = new Date().toISOString().slice(0, 10);
  return raw.creditLinePlannedMaturities.map((row) => {
    const relation = row["finance_credit_lines"] as Record<string, unknown> | Record<string, unknown>[] | null;
    const line = Array.isArray(relation) ? relation[0] : relation;
    const principal = asNumber(row["planned_principal_eur"]);
    const interest = row["expected_interest_eur"] == null ? null : asNumber(row["expected_interest_eur"]);
    const fees = row["expected_fees_eur"] == null ? null : asNumber(row["expected_fees_eur"]);
    const cashOut = principal + (interest ?? 0) + (fees ?? 0);
    const dueDate = asString(row["due_date"]);
    return {
      id: `planned-maturity-${String(row["id"])}`, type: "credit_line_planned_maturity" as const,
      title: asString(row["concept"]) ?? "Devolucion de credito", date: dueDate,
      month: dateToMonth(dueDate), isPendingDate: false, status: dueDate && dueDate < today ? "vencido" as const : "previsto" as const,
      containerId:null,containerCode:null,orderId:null,orderCode:null,numeroPedidoAgente:null,agentContact:null,logisticsType:"SIN_DEFINIR" as const,
      originalAmount:principal,originalCurrency:"EUR",plannedFxRate:null,plannedFxSource:"not_configured" as const,
      plannedAmountEur:cashOut,paidAmountEur:0,recommendedSource:"cash" as const,recommendationReason:"Vencimiento previsto; no ejecuta movimientos.",canMarkPaid:false,
      creditLineId:String(row["credit_line_id"]),creditLineBank:String(line?.["bank_name"]??""),creditLineName:String(line?.["line_name"]??""),
      plannedPrincipalEur:principal,expectedInterestEur:interest,expectedFeesEur:fees,plannedCashOutEur:cashOut,plannedCreditReleaseEur:principal,
      plannedMaturityReference:asString(row["reference"]),isInformational:false,
    };
  });
}

function buildCreditLineInformationalEvents(
  creditLines: FinanceCreditLine[],
  debtEvents: FinancePlanningEvent[],
): FinancePlanningEvent[] {
  const linesWithPendingGroups = new Set(
    debtEvents
      .map((event) => event.creditLineId ?? null)
      .filter((key): key is string => Boolean(key)),
  );

  return creditLines
    .filter((line) => !linesWithPendingGroups.has(line.id))
    .map((line) => ({
      id: `credit-line-info-${line.id}`,
      type: "credit_line_release" as const,
      title: `Linea ${line.bankName} / ${line.lineName}`,
      date: line.maturityDate,
      month: dateToMonth(line.maturityDate),
      isPendingDate: !line.maturityDate,
      status: "previsto" as const,
      containerId: null,
      containerCode: null,
      orderId: null,
      orderCode: null,
      numeroPedidoAgente: null,
      agentContact: null,
      logisticsType: "SIN_DEFINIR" as const,
      originalAmount: 0,
      originalCurrency: "EUR",
      plannedFxRate: null,
      plannedFxSource: "not_configured" as const,
      plannedAmountEur: 0,
      paidAmountEur: 0,
      recommendedSource: null,
      recommendationReason: line.maturityDate
        ? "Linea sin vencimiento pendiente generado en grupos."
        : "El vencimiento se generara cuando se use la linea.",
      canMarkPaid: false,
      creditLineId: line.id,
      creditLineBank: line.bankName,
      creditLineName: line.lineName,
      paidLineAmountEur: 0,
      repaymentGroupId: null,
      repaymentGroupStatus: null,
      isInformational: true,
    }));
}

function isSupplierOrContainerPayment(type: string): boolean {
  return type.startsWith("supplier_") || type.startsWith("container_");
}

function effectiveEventAmountEur(event: FinancePlanningEvent): number {
  return event.plannedAmountEur;
}

function paidEventAmountEur(event: FinancePlanningEvent): number {
  if (event.type === "supplier_payment_settlement") return event.allocatedAmountEur ?? 0;
  if (event.type === "supplier_deposit" || event.type === "supplier_balance") return 0;
  return event.status === "pagado" ? effectiveEventAmountEur(event) : 0;
}

/**
 * Construye la planificacion visual mensual sin decidir por coste de linea.
 */
export async function buildFinancialPlanning(
  query: FinancePlanningQuery,
  canManageCreditLineRegularizations = false,
): Promise<FinancePlanningResponse> {
  console.log("[finance/planning] buildFinancialPlanning start");
  const raw = await findFinancialPlanningData(query);
  const explainedByLine = new Map<string, number>();
  for (const group of raw.creditLineRepaymentGroups) {
    const lineId = asString(group["credit_line_id"]);
    if (!lineId) continue;
    explainedByLine.set(lineId, (explainedByLine.get(lineId) ?? 0) + asNumber(group["remaining_amount"]));
  }
  const allCreditLines: FinanceCreditLine[] = raw.creditLines
    .filter((row) => !isDeletedCreditLineStatus(String(row["status"] ?? "")))
    .map((row) => ({
      id: String(row["id"]),
      bankName: String(row["bank_name"] ?? ""),
      lineName: String(row["line_name"] ?? ""),
      creditLimit: asNumber(row["credit_limit"]),
      availableAmount: asNumber(row["available_amount"]),
      usedAmount: asNumber(row["used_amount"]),
      cycleDays: row["cycle_days"] == null ? null : asNumber(row["cycle_days"]),
      maturityDate: asString(row["maturity_date"]),
      repaymentMode: String(row["repayment_mode"] ?? ""),
      priority: row["priority"] == null ? null : asNumber(row["priority"]),
      fixedFee: row["fixed_fee"] == null ? null : asNumber(row["fixed_fee"]),
      status: String(row["status"] ?? "activa"),
      notes: asString(row["notes"]),
      legacyGap: (() => {
        const used = asNumber(row["used_amount"]);
        const explained = explainedByLine.get(String(row["id"])) ?? 0;
        const unexplained = Math.max(0, used - explained);
        return unexplained > 0.01 ? { explainedRemaining: explained, unexplainedAmount: unexplained } : null;
      })(),
    }));
  /** Solo lineas activas: disponibilidad usable para nuevas disposiciones. */
  const activeCreditLines = allCreditLines.filter((line) =>
    isActiveCreditLineStatus(line.status),
  );
  const cashAccounts: FinanceCashAccount[] = raw.cashAccounts.map((row) => ({
    id: String(row["id"]),
    name: String(row["name"] ?? ""),
    balance: asNumber(row["balance"]),
    currency: String(row["currency"] ?? "EUR"),
    isOperatingTreasury: Boolean(row["is_operating_treasury"]),
  }));
  const cashBalance = cashAccounts.filter(account=>account.isOperatingTreasury).reduce((sum, account) => sum + account.balance, 0);
  const reserveRaw=raw.settings.find(row=>row["key"]==="minimum_operating_cash_reserve_eur")?.["value"];
  const minimumOperatingReserveEur=asNumber(reserveRaw,20000);
  const globalFxRaw = raw.settings.find((row) => row["key"] === "planned_usd_eur_rate")?.["value"];
  const globalFxRate = globalFxRaw ? asNumber(globalFxRaw, 0) || null : null;
  const totalActiveCreditLimit = activeCreditLines.reduce(
    (sum, line) => sum + line.creditLimit,
    0,
  );
  const totalCreditUsed = allCreditLines.reduce((sum, line) => sum + line.usedAmount, 0);
  const totalActiveCreditAvailable = activeCreditLines.reduce(
    (sum, line) => sum + line.availableAmount,
    0,
  );

  // Maturities include inactive/cancelled lines with open debt; drawdown recommendations stay active-only.
  const repaymentGroupEvents = buildCreditLineRepaymentGroupEvents(raw, allCreditLines);
  const repaymentSettlementEvents = buildCreditLineRepaymentSettlementEvents(raw);
  const plannedMaturityEvents = buildCreditLinePlannedMaturityEvents(raw);
  const creditLineInfoEvents = buildCreditLineInformationalEvents(
    activeCreditLines,
    [...repaymentGroupEvents,...plannedMaturityEvents],
  );

  const events = [
    ...buildSupplierPaymentEvents(raw, activeCreditLines, Math.max(0,cashBalance-minimumOperatingReserveEur)),
    ...buildContainerLogisticsEvents(raw, activeCreditLines, Math.max(0,cashBalance-minimumOperatingReserveEur)),
    ...repaymentGroupEvents,
    ...repaymentSettlementEvents,
    ...plannedMaturityEvents,
    ...creditLineInfoEvents,
  ];

  const amazonExpectedNetRatioRaw = raw.settings.find((row) => row["key"] === "amazon_expected_net_ratio")?.["value"];
  const amazonExpectedNetRatio = amazonExpectedNetRatioRaw == null
    ? null
    : asNumber(amazonExpectedNetRatioRaw);
  const latestObservations=Array.from(new Map(raw.amazonTreasuryObservations
    .slice().sort((a,b)=>String(a["snapshot_at"]??"").localeCompare(String(b["snapshot_at"]??"")))
    .map(row=>[String(row["source_key"]),row])).values());
  for (const income of raw.amazonIncomeForecasts.filter(row=>!["AVAILABLE","DEFERRED","PENDING_BANK"].includes(String(row["economic_state"]??"").toUpperCase()))) {
    const incomeStatus=String(income["status"]??"projected").toLowerCase();
    const receivedAt=asString(income["received_at"]);
    const storedState=String(income["economic_state"]??"").toUpperCase();
    const amazonStatus = incomeStatus==="received" ? "RECEIVED" : ["FUTURE","DEFERRED","AVAILABLE","PENDING_BANK"].includes(storedState) ? storedState as "FUTURE"|"DEFERRED"|"AVAILABLE"|"PENDING_BANK" : incomeStatus==="confirmed" ? "LEGACY_CONFIRMED" : "FUTURE";
    const expectedBankDate=asString(income["expected_bank_date"]);
    const date = amazonStatus === "RECEIVED" ? receivedAt?.slice(0,10) ?? asString(income["forecast_date"]) : expectedBankDate;
    const amountEurRaw=income["treasury_amount_eur"];
    const amountEur=amountEurRaw==null?null:asNumber(amountEurRaw);
    const amount = amazonStatus==="RECEIVED"?asNumber(income["received_amount_eur"],asNumber(income["amount_eur"])):amountEur??0;
    const originalCurrency=String(income["original_currency"]??"EUR");const originalAmount=asNumber(income["original_amount"],amount);
    const notConsolidable=amountEur==null&&amazonStatus!=="RECEIVED";
    const excludedState=amazonStatus==="RECEIVED"||amazonStatus==="LEGACY_CONFIRMED"||(amazonStatus==="DEFERRED"&&!expectedBankDate)||amazonStatus==="AVAILABLE"&&amount<=0;
    events.push({
      id: String(income["id"]),
      type: "amazon_income",
      title: `Amazon ${amazonStatus.toLowerCase().replace("_"," ")}`,
      date,
      month: dateToMonth(date),
      isPendingDate: !date,
      status: amazonStatus==="RECEIVED" ? "pagado" : "previsto",
      amazonStatus,
      amazonConfidence:asString(income["confidence"]),amazonEstimationMethod:asString(income["estimation_method"]),
      sourceKey: asString(income["source_key"]),
      settlementId: asString(income["settlement_id"]),
      marketplace: asString(income["marketplace"]),
      dateIsEstimated:Boolean(income["date_is_estimated"]),
      isInformational:excludedState||notConsolidable,
      containerId: null,
      containerCode: null,
      orderId: null,
      orderCode: null,
      numeroPedidoAgente: null,
      agentContact: null,
      logisticsType: "SIN_DEFINIR",
      originalAmount,
      originalCurrency,
      plannedFxRate: null,
      plannedFxSource: "not_configured",
      plannedAmountEur: amount,
      paidAmountEur: amazonStatus === "RECEIVED" ? amount : null,
      recommendedSource: null,
      recommendationReason:notConsolidable?`Importe ${originalCurrency} sin conversion EUR oficial; no consolidado.`:amazonStatus==="LEGACY_CONFIRMED"?"Closed historico pendiente de clasificacion; excluido del flujo futuro.":amazonStatus==="RECEIVED"?"Ingreso recibido mediante confirmacion bancaria.":`Amazon ${amazonStatus}; contabilizado por expectedBankDate sin modificar caja bancaria.`,
      canMarkPaid: false,
    });
  }
  for(const observation of latestObservations){
    const state=String(observation["economic_state"]) as "AVAILABLE"|"DEFERRED"|"PENDING_BANK";
    const amountRaw=observation["official_amount_eur"]??observation["amount_eur"]??observation["estimated_amount_eur"];
    const amountEur=amountRaw==null?null:asNumber(amountRaw);const originalAmount=asNumber(observation["original_amount"]);const originalCurrency=String(observation["original_currency"]??"EUR");const expectedBankDate=asString(observation["expected_bank_date"]);const unresolved=String(observation["marketplace"]??"UNRESOLVED")==="UNRESOLVED";
    events.push({id:String(observation["id"]),type:"amazon_income",title:`Amazon ${state.toLowerCase().replace("_"," ")}`,date:expectedBankDate,month:dateToMonth(expectedBankDate),isPendingDate:!expectedBankDate,status:"previsto",amazonStatus:state,amazonConfidence:asString(observation["confidence"]),amazonEstimationMethod:asString(observation["estimation_method"]),sourceKey:asString(observation["source_key"]),settlementId:asString(observation["financial_event_group_id"]),marketplace:String(observation["marketplace"]??"UNRESOLVED"),dateIsEstimated:true,isInformational:unresolved||amountEur==null||state==="DEFERRED"||state==="AVAILABLE"&&originalAmount<=0,containerId:null,containerCode:null,orderId:null,orderCode:null,numeroPedidoAgente:null,agentContact:null,logisticsType:"SIN_DEFINIR",originalAmount,originalCurrency,plannedFxRate:null,plannedFxSource:"not_configured",plannedAmountEur:amountEur??0,paidAmountEur:null,recommendedSource:null,recommendationReason:unresolved?"Marketplace no resuelto; excluido del consolidado.":amountEur==null?`Importe ${originalCurrency} sin conversion EUR; excluido del consolidado.`:`Snapshot observacional ${state}; no modifica caja.`,canMarkPaid:false});
  }

  const fromMonth = query.fromMonth ?? new Date().toISOString().slice(0, 7);
  const monthsCount = query.months ?? 6;
  const amazonCashItems:AmazonCashItem[]=[...raw.amazonIncomeForecasts.filter(row=>String(row["economic_state"]??"").toUpperCase()==="FUTURE"),...latestObservations].flatMap((income)=>{
    const state=String(income["economic_state"]??"").toUpperCase();
    if(!["RECEIVED","PENDING_BANK","AVAILABLE","DEFERRED","FUTURE"].includes(state))return [];
    const officialRaw=income["official_amount_eur"]??income["official_converted_amount_eur"];const official=officialRaw==null?null:asNumber(officialRaw);
    const treasuryRaw=income["amount_eur"]??income["estimated_amount_eur"]??income["treasury_amount_eur"];const treasury=treasuryRaw==null?null:asNumber(treasuryRaw);
    return [{identity:asString(income["amazon_transaction_id"])??asString(income["settlement_id"])??String(income["source_key"]??income["id"]),marketplace:String(income["marketplace"]??"UNKNOWN"),state:state as AmazonCashItem["state"],originalCurrency:String(income["original_currency"]??"EUR"),originalAmount:asNumber(income["original_amount"]),officialAmountEur:official,estimatedAmountEur:official==null?treasury:null,expectedBankDate:asString(income["expected_bank_date"]),confidence:(asString(income["confidence"])??"unavailable") as AmazonCashItem["confidence"],estimationMethod:asString(income["estimation_method"])??"unavailable",snapshotAt:asString(income["snapshot_at"]),fxSource:asString(income["fx_source"])}];
  });
  const {
    pendingDateEvents,
    datedEvents: datedPlanningEvents,
  } = partitionFinanceEventsByDate(events);
  let projectedCash = cashBalance;
  const projectedCredit = totalActiveCreditAvailable;
  const releaseTracker=createCreditReleaseTracker(activeCreditLines);
  const months = Array.from({ length: monthsCount }, (_, index) => {
    const d = addMonths(new Date(`${fromMonth}-01T00:00:00Z`), index);
    const month = d.toISOString().slice(0, 7);
    const horizonStart = `${fromMonth}-01`;
    const monthEvents = datedPlanningEvents
      .filter((event) => event.month === month || (
        index === 0
        && event.type === "credit_line_maturity"
        && event.isLegacyOpeningBalance
        && Boolean(event.date && event.date < horizonStart)
      ))
      .sort((a, b) => (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31"));
    const datedEvents = monthEvents.filter((event) => !event.isPendingDate);

    for (const event of datedEvents) {
      if (event.isInformational) continue;
      const effectiveAmountEur = effectiveEventAmountEur(event);
      // PROJECTED/CONFIRMED are forecast inflows for treasury tension, not bank cash.
      // RECEIVED is already represented by the opening cash balance and must not be added again.
      if (event.type === "amazon_income" && event.status !== "pagado") {
        projectedCash += effectiveAmountEur;
      }
      if (event.type === "credit_line_maturity" || event.type === "credit_line_planned_maturity" || event.type === "credit_line_release") {
        if (event.type === "credit_line_maturity") {
          projectedCash -= event.plannedAmountEur + (event.expectedInterestEur ?? 0) + (event.expectedFeesEur ?? 0);
        }
        if (event.type === "credit_line_planned_maturity") {
          projectedCash -= event.plannedCashOutEur ?? event.plannedAmountEur;
        }
        if (event.type === "credit_line_maturity" || event.type === "credit_line_planned_maturity") {
          const requested = event.type === "credit_line_maturity" ? event.plannedAmountEur : event.plannedPrincipalEur ?? 0;
          const limitedRelease = releaseTracker.take(event.creditLineId,requested);
          event.plannedCreditReleaseEur=limitedRelease;
          // La liberacion es informativa: available_amount no cambia hasta la amortizacion real.
        }
      }
      // Los saldos iniciales ya incluyen settlements ejecutados. Solo se proyectan salidas futuras;
      // los pagados se agrupan por paid_at para histórico y el due_date permanece en el detalle.
      if (event.status === "pagado") continue;
      if (isSupplierOrContainerPayment(event.type) && event.recommendedSource === "cash") {
        projectedCash -= effectiveAmountEur;
      }
    }

    return {
      month,
      label: monthLabel(month),
      ...buildMonthlyTotals(datedEvents),
      pendingFxObligations:datedEvents.filter(event=>event.plannedFxPending&&["pendiente","parcial","vencido"].includes(event.status)).length,
      hasUnvaluedForeignDebt:datedEvents.some(event=>event.plannedFxPending&&["pendiente","parcial","vencido"].includes(event.status)),
      totalIncome: datedEvents
        .filter((event) => !event.isInformational && event.type === "amazon_income" && event.amazonStatus === "FUTURE")
        .reduce((sum, event) => sum + event.plannedAmountEur, 0),
      amazonExpectedEur: datedEvents.filter(event=>!event.isInformational&&event.type==="amazon_income"&&event.amazonStatus==="FUTURE").reduce((sum,event)=>sum+event.plannedAmountEur,0),
      amazonConfirmedEur: datedEvents.filter(event=>!event.isInformational&&event.type==="amazon_income"&&event.amazonStatus==="PENDING_BANK").reduce((sum,event)=>sum+event.plannedAmountEur,0),
      amazonReceivedEur: datedEvents.filter(event=>!event.isInformational&&event.type==="amazon_income"&&event.amazonStatus==="RECEIVED").reduce((sum,event)=>sum+(event.paidAmountEur??event.plannedAmountEur),0),
      amazonAvailableEur:datedEvents.filter(event=>!event.isInformational&&event.type==="amazon_income"&&event.amazonStatus==="AVAILABLE").reduce((sum,event)=>sum+event.plannedAmountEur,0),
      amazonPendingBankEur:datedEvents.filter(event=>!event.isInformational&&event.type==="amazon_income"&&event.amazonStatus==="PENDING_BANK").reduce((sum,event)=>sum+event.plannedAmountEur,0),
      amazonDeferredEur:datedEvents.filter(event=>!event.isInformational&&event.type==="amazon_income"&&event.amazonStatus==="DEFERRED").reduce((sum,event)=>sum+event.plannedAmountEur,0),
      amazonFutureEur:datedEvents.filter(event=>!event.isInformational&&event.type==="amazon_income"&&event.amazonStatus==="FUTURE").reduce((sum,event)=>sum+event.plannedAmountEur,0),
      amazonIncomes: datedEvents.filter(event=>event.type==="amazon_income").map(event=>({
        amazonExpectedEur:event.amazonStatus==="FUTURE"&&!event.isInformational?event.plannedAmountEur:0,
        amazonConfirmedEur:event.amazonStatus==="PENDING_BANK"&&!event.isInformational?event.plannedAmountEur:0,
        amazonReceivedEur:event.amazonStatus==="RECEIVED"&&!event.isInformational?(event.paidAmountEur??event.plannedAmountEur):0,
        date:event.date,marketplace:event.marketplace??null,status:event.amazonStatus??"FUTURE",
        sourceKey:event.sourceKey??null,settlementId:event.settlementId??null,dateIsEstimated:Boolean(event.dateIsEstimated),
        confidence:event.amazonConfidence??null,estimationMethod:event.amazonEstimationMethod??null,originalCurrency:event.originalCurrency,originalAmount:event.originalAmount??0,amountEur:event.isInformational?null:event.plannedAmountEur,
      })),
      totalCreditReleases: datedEvents
        .filter((event) => !event.isInformational && (event.type === "credit_line_maturity" || event.type === "credit_line_planned_maturity"))
        .reduce((sum, event) => sum + (event.plannedCreditReleaseEur ?? 0), 0),
      plannedCreditPrincipalEur: datedEvents.filter(e=>e.type==="credit_line_planned_maturity").reduce((s,e)=>s+(e.plannedPrincipalEur??0),0),
      plannedCreditInterestEur: sumKnown(datedEvents.filter(e=>e.type==="credit_line_planned_maturity").map(e=>e.expectedInterestEur)),
      plannedCreditFeesEur: sumKnown(datedEvents.filter(e=>e.type==="credit_line_planned_maturity").map(e=>e.expectedFeesEur)),
      plannedCreditCashOutEur: datedEvents.filter(e=>e.type==="credit_line_planned_maturity").reduce((s,e)=>s+(e.plannedCashOutEur??0),0),
      plannedCreditReleaseEur: datedEvents.filter(e=>e.type==="credit_line_planned_maturity").reduce((s,e)=>s+(e.plannedCreditReleaseEur??0),0),
      plannedFinancialExpenseEur: sumKnown(datedEvents.filter(e=>e.type==="credit_line_planned_maturity").flatMap(e=>[e.expectedInterestEur,e.expectedFeesEur])),
      recordedInterestEur: sumKnown(datedEvents.filter(e=>e.status==="pagado").map(e=>e.type==="credit_line_repayment_settlement" ? e.expectedInterestEur : undefined)),
      recordedFeesEur: sumKnown(datedEvents.filter(e=>e.status==="pagado").flatMap(e=>[e.bankFeeEur,e.ffFeeEur,e.type==="credit_line_repayment_settlement"?e.expectedFeesEur:undefined])),
      projectedCashBalance: projectedCash,
      projectedCreditAvailable: projectedCredit,
      events: datedEvents,
      pendingDateEvents: [],
    };
  });
  // El summary comparte exactamente el horizonte de los buckets visibles.
  // Un historico global requeriria un campo separado y explicitamente etiquetado.
  const horizonEvents = months.flatMap((month) => month.events);
  const treasuryEvents:TreasuryEvent[]=horizonEvents.filter(event=>!event.isInformational&&event.date&&event.status!=="pagado").map(event=>({id:event.id,date:event.date!,title:event.title,kind:event.type==="amazon_income"?"income":event.type.includes("maturity")?"maturity":"outflow",amountEur:event.type==="credit_line_planned_maturity"?(event.plannedCashOutEur??event.plannedAmountEur):event.type==="credit_line_maturity"?event.plannedAmountEur+(event.expectedInterestEur??0)+(event.expectedFeesEur??0):event.plannedAmountEur,amazonEconomicState:event.type==="amazon_income"?event.amazonStatus:undefined,confidence:event.amazonConfidence}));
  const treasuryEvaluation=evaluateTreasury({initialCashEur:cashBalance,reserveEur:minimumOperatingReserveEur,events:treasuryEvents,lines:activeCreditLines.map(line=>({id:line.id,name:`${line.bankName} ${line.lineName}`,availableEur:line.availableAmount,priority:line.priority,dueDate:line.maturityDate,cycleDays:line.cycleDays,knownCostEur:line.fixedFee??null}))});

  const monthKeys=months.map(month=>month.month);
  const marketplaceCards=buildMarketplaceCashCards(amazonCashItems);
  const europeItems=amazonCashItems.filter(item=>item.marketplace!=="UNRESOLVED").flatMap(item=>{const amount=item.officialAmountEur??item.estimatedAmountEur;return amount==null?[]:[{...item,identity:`EUROPE:${item.identity}`,marketplace:"EUROPE",originalCurrency:"EUR",originalAmount:amount,officialAmountEur:item.officialAmountEur,estimatedAmountEur:item.officialAmountEur==null?item.estimatedAmountEur:null}];});
  const europeCard=buildMarketplaceCashCards(europeItems)[0];
  return {
    ok: true,
    summary: {
      totalActiveCreditLimit,
      totalCreditUsed,
      totalActiveCreditAvailable,
      totalCreditLimit: totalActiveCreditLimit,
      totalCreditAvailable: totalActiveCreditAvailable,
      cashBalance,
      pendingPayments: months.reduce((sum, month) => sum + month.totalPendingPayments, 0),
      paidPayments: months.reduce((sum, month) => sum + month.totalPaidPayments, 0),
      plannedIncome: horizonEvents
        .filter((event) => !event.isInformational && event.type === "amazon_income" && event.status !== "pagado")
        .reduce((sum, event) => sum + event.plannedAmountEur, 0),
      amazonAvailable: latestObservations.filter(row=>String(row["economic_state"]??"")==="AVAILABLE"&&String(row["marketplace"]??"")!=="UNRESOLVED"&&(row["official_amount_eur"]??row["amount_eur"])!=null&&asNumber(row["original_amount"])>0).reduce((sum,row)=>sum+asNumber(row["official_amount_eur"]??row["amount_eur"]),0),
      amazonAvailableSource: "FinancialEventGroup Open.OriginalTotal; solo importes EUR oficiales.",
      amazonExpected: raw.amazonIncomeForecasts
        .filter((row) => String(row["economic_state"]??"")==="FUTURE"&&row["treasury_amount_eur"]!=null)
        .reduce((sum, row) => sum + asNumber(row["treasury_amount_eur"]), 0),
      amazonExpectedNetRatio,
      pendingFxObligations:horizonEvents.filter(event=>event.plannedFxPending&&["pendiente","parcial","vencido"].includes(event.status)).length,
      plannedUsdEurRate: globalFxRate,
      plannedUsdEurRateSource: globalFxRate ? "global_setting" : "not_configured",
      minimumOperatingReserveEur,
      operatingCashAvailableAboveReserveEur:Math.max(0,cashBalance-minimumOperatingReserveEur),
      treasuryEvaluation,
    },
    creditLines: allCreditLines.map((line) => {
      const scheduled = horizonEvents
        .filter((event) => event.creditLineId === line.id && (event.type === "credit_line_maturity" || event.type === "credit_line_planned_maturity"))
        .reduce((sum, event) => sum + (event.plannedCreditReleaseEur ?? 0), 0);
      return { ...line, plannedReleaseDuringHorizon: scheduled, scheduledExcessEur: Math.max(0, scheduled - line.usedAmount) };
    }),
    cashAccounts,
    months,
    pendingDateEvents,
    permissions: { canManageCreditLineRegularizations },
    amazonCashForecast:{marketplaceCards:europeCard?[...marketplaceCards,europeCard]:marketplaceCards,monthlyScenarios:summarizeAmazonCashByMonth(amazonCashItems,monthKeys)},
  };
}
