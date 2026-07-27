import { findFinancialPlanningData } from "../repositories/financialPlanningRepository";
import { backfillMissingSupplierPayments } from "./syncSupplierPaymentsForOrder";
import {
  recommendCreditLineForAmount,
} from "./syncCreditLineDueFromSupplierPayment";
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

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function isActiveCreditLineStatus(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "activa" || normalized === "activo" || normalized === "active";
}

function isDeletedCreditLineStatus(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (
    normalized === "eliminada"
    || normalized === "deleted"
    || normalized === "cancelled"
    || normalized === "cancelada"
  );
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
    const plannedAmountEur = asNumber(payment["amount_eur"]);
    const plannedOriginalAmount = asNumber(payment["amount_original"]);
    const allocationStats = purchasePaymentAllocationStats(payment);
    const allocatedOriginal = allocationStats.count > 0
      ? allocationStats.allocatedOriginal
      : paidRealAmountOriginal(payment);
    const pendingOriginal = Math.max(0, plannedOriginalAmount - allocatedOriginal);
    const originalCurrency = (asString(payment["original_currency"]) ?? "USD").toUpperCase();
    const plannedFxRate = asNumber(payment["planned_fx_rate"], 0) || (originalCurrency === "EUR" ? 1 : null);
    const actualAmountEur = (allocationStats.count > 0
      ? allocationStats.allocatedEur
      : paidRealAmountEur(payment)) || null;
    const actualAmountOriginal = allocatedOriginal || null;
    const actualFxRate = allocationStats.weightedFxRate
      ?? (asNumber(payment["actual_fx_rate"], 0) || null);
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
      : plannedOriginalAmount > 0
        ? plannedAmountEur * (pendingOriginal / plannedOriginalAmount)
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
      plannedFxSource: plannedFxRate != null ? "legacy" : "not_configured",
      plannedAmountEur: displayAmountEur,
      paidAmountEur: null,
      actualAmountOriginal,
      actualAmountEur,
      actualFxRate,
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
      });
    }

    for (const { allocation, batch } of allocationStats.active) {
      const settlementPaidAt = asString(batch["paid_at"]);
      const settlementDate = settlementPaidAt ? settlementPaidAt.slice(0, 10) : null;
      const settlementEur = asNumber(allocation["allocated_amount_eur"]);
      events.push({
        id: `${String(payment["id"])}:${String(batch["id"])}`,
        type: "supplier_payment_settlement",
        title: `${title} pagado`,
        date: settlementDate,
        month: dateToMonth(settlementDate),
        isPendingDate: !settlementDate,
        status: "pagado",
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
        // Las comisiones pertenecen al batch, no se repiten por allocation.
        bankFeeEur: null,
        ffFeeEur: null,
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

  for (const group of raw.creditLineRepaymentGroups) {
    const creditLineId = asString(group["credit_line_id"]);
    const line = creditLines.find((item) => item.id === creditLineId);
    const dueDate = asString(group["due_date"]);
    const remainingAmount = asNumber(group["remaining_amount"]);
    const originalAmount = asNumber(group["amount"]);
    const paidAmount = asNumber(group["paid_amount"]);
    const groupStatus = asString(group["status"]);
    if (!line || remainingAmount <= 0) continue;
    if (groupStatus !== "open" && groupStatus !== "partially_paid") continue;

    const overdue = Boolean(dueDate && dueDate < today);
    const status: FinanceEventStatus =
      groupStatus === "partially_paid"
        ? overdue
          ? "vencido"
          : "parcial"
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
      title: "Vencimiento de linea de credito",
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
      isInformational: false,
    });
  }

  return events;
}

function buildCreditLineInformationalEvents(
  creditLines: FinanceCreditLine[],
  repaymentGroupEvents: FinancePlanningEvent[],
): FinancePlanningEvent[] {
  const linesWithPendingGroups = new Set(
    repaymentGroupEvents
      .map((event) => event.creditLineBank && event.creditLineName
        ? `${event.creditLineBank}::${event.creditLineName}`
        : null)
      .filter((key): key is string => Boolean(key)),
  );

  return creditLines
    .filter((line) => !linesWithPendingGroups.has(`${line.bankName}::${line.lineName}`))
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
): Promise<FinancePlanningResponse> {
  console.log("[finance/planning] buildFinancialPlanning start");
  const backfillResult = await backfillMissingSupplierPayments();
  console.log("[finance/planning] backfill completed", backfillResult);
  const raw = await findFinancialPlanningData(query);
  const allCreditLines: FinanceCreditLine[] = raw.creditLines
    .filter((row) => !isDeletedCreditLineStatus(row["status"]))
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
      status: String(row["status"] ?? "activa"),
      notes: asString(row["notes"]),
    }));
  /** Solo lineas activas: disponibilidad usable para nuevas disposiciones. */
  const creditLines = allCreditLines.filter((line) => isActiveCreditLineStatus(line.status));
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

  // Maturities include inactive lines with open debt; drawdown recommendations stay active-only.
  const repaymentGroupEvents = buildCreditLineRepaymentGroupEvents(raw, allCreditLines);
  const creditLineInfoEvents = buildCreditLineInformationalEvents(creditLines, repaymentGroupEvents);

  const events = [
    ...buildSupplierPaymentEvents(raw, creditLines, cashBalance),
    ...buildContainerLogisticsEvents(raw, creditLines, cashBalance),
    ...repaymentGroupEvents,
    ...creditLineInfoEvents,
  ];

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
  const {
    pendingDateEvents,
    datedEvents: datedPlanningEvents,
  } = partitionFinanceEventsByDate(events);
  let projectedCash = cashBalance;
  let projectedCredit = totalCreditAvailable;
  const months = Array.from({ length: monthsCount }, (_, index) => {
    const d = addMonths(new Date(`${fromMonth}-01T00:00:00`), index);
    const month = d.toISOString().slice(0, 7);
    const monthEvents = datedPlanningEvents
      .filter((event) => event.month === month)
      .sort((a, b) => (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31"));
    const datedEvents = monthEvents.filter((event) => !event.isPendingDate);

    for (const event of datedEvents) {
      if (event.isInformational) continue;
      const effectiveAmountEur = effectiveEventAmountEur(event);
      if (event.type === "amazon_income") projectedCash += event.plannedAmountEur;
      if (event.type === "credit_line_maturity" || event.type === "credit_line_release") {
        if (event.type === "credit_line_maturity") {
          projectedCash -= event.plannedAmountEur;
          projectedCredit += event.plannedAmountEur;
        }
      }
      // Los saldos iniciales ya incluyen settlements ejecutados. Solo se proyectan salidas futuras;
      // los pagados se agrupan por paid_at para histórico y el due_date permanece en el detalle.
      if (event.status === "pagado") continue;
      if (isSupplierOrContainerPayment(event.type) && event.recommendedSource === "cash") {
        projectedCash -= effectiveAmountEur;
      }
      if (isSupplierOrContainerPayment(event.type) && event.recommendedSource && event.recommendedSource !== "cash") {
        projectedCredit -= effectiveAmountEur;
      }
    }

    return {
      month,
      label: monthLabel(month),
      totalPendingPayments: datedEvents
        .filter((event) => !event.isInformational && ["pendiente", "parcial", "vencido"].includes(event.status))
        .reduce((sum, event) => sum + event.plannedAmountEur, 0),
      totalPaidPayments: datedEvents
        .filter((event) => !event.isInformational)
        .reduce((sum, event) => sum + paidEventAmountEur(event), 0),
      totalIncome: datedEvents
        .filter((event) => !event.isInformational && event.type === "amazon_income")
        .reduce((sum, event) => sum + event.plannedAmountEur, 0),
      totalCreditReleases: datedEvents
        .filter((event) => !event.isInformational && event.type === "credit_line_maturity")
        .reduce((sum, event) => sum + event.plannedAmountEur, 0),
      projectedCashBalance: projectedCash,
      projectedCreditAvailable: projectedCredit,
      events: datedEvents,
      pendingDateEvents: [],
    };
  });
  // El summary comparte exactamente el horizonte de los buckets visibles.
  // Un historico global requeriria un campo separado y explicitamente etiquetado.
  const horizonEvents = months.flatMap((month) => month.events);

  return {
    ok: true,
    summary: {
      totalCreditLimit: creditLines.reduce((sum, line) => sum + line.creditLimit, 0),
      totalCreditUsed: creditLines.reduce((sum, line) => sum + line.usedAmount, 0),
      totalCreditAvailable,
      cashBalance,
      pendingPayments: horizonEvents
        .filter((event) => !event.isInformational && ["pendiente", "parcial", "vencido"].includes(event.status))
        .reduce((sum, event) => sum + event.plannedAmountEur, 0),
      paidPayments: horizonEvents
        .filter((event) => !event.isInformational)
        .reduce((sum, event) => sum + paidEventAmountEur(event), 0),
      plannedIncome: horizonEvents
        .filter((event) => !event.isInformational && event.type === "amazon_income")
        .reduce((sum, event) => sum + event.plannedAmountEur, 0),
      plannedUsdEurRate: globalFxRate,
      plannedUsdEurRateSource: globalFxRate ? "global_setting" : "not_configured",
    },
    creditLines,
    cashAccounts,
    months,
    pendingDateEvents,
  };
}
