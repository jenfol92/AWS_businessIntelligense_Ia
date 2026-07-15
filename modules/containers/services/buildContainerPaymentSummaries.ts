/**
 * Módulo      : containers
 * Archivo     : services/buildContainerPaymentSummaries.ts
 * Responsabilidad: agregar pagos proveedor ya persistidos para mostrarlos en listados de logística.
 * No debe     : recalcular, crear, actualizar ni sincronizar pagos.
 */

import type { SupplierPaymentRow } from "@/modules/finance/types/supplierPayments.types";

export type ContainerPaymentSummary = {
  pagadoImporteEur: number;
  pagadoFecha: string | null;
  pendienteImporteEur: number;
  pendienteFechaPrevista: string | null;
  supplierOriginalCurrency: string | null;
  supplierTotalOriginal: number | null;
  supplierPaidOriginal: number | null;
  supplierPendingOriginal: number | null;
  supplierPaidRealEur: number | null;
  supplierPlannedEur: number | null;
};

export type ContainerPaymentOrderLink = {
  contenedor_id: string;
  orden_id: string;
  ordenes_compra?: Record<string, unknown> | Record<string, unknown>[] | null;
};

function amountEur(value: number | null | undefined): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function amount(value: number | null | undefined): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function dateOnly(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

function isPaid(payment: Pick<SupplierPaymentRow, "status" | "paid_at">): boolean {
  return payment.status === "pagado" || Boolean(payment.paid_at);
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeCurrency(value: unknown): string | null {
  const currency = typeof value === "string" ? value.trim().toUpperCase() : "";
  return currency || null;
}

function orderItemsTotalOriginal(order: Record<string, unknown> | null): number {
  const items = (order?.["orden_items"] as Array<Record<string, unknown>> | null | undefined) ?? [];
  return items.reduce(
    (sum, item) => sum + amount(item["cantidad"] as number | null) * amount(item["coste_unitario_moneda"] as number | null),
    0,
  );
}

function resolvePendingDueDate(dueDates: string[]): string | null {
  if (dueDates.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...dueDates].sort((a, b) => a.localeCompare(b));
  const future = sorted.find((date) => date >= today);
  return future ?? sorted[0] ?? null;
}

function resolveOrderTotalOriginal(
  order: Record<string, unknown> | null,
  orderPayments: SupplierPaymentRow[],
  currency: string,
): number {
  const itemsTotal = orderItemsTotalOriginal(order);
  if (itemsTotal > 0) return itemsTotal;

  if (currency === "EUR") {
    const costEur = amount(order?.["coste_total_eur"] as number | null);
    if (costEur > 0) return costEur;
  }

  const plannedOriginal = orderPayments.reduce(
    (sum, payment) => sum + amount(payment.amount_original),
    0,
  );
  return plannedOriginal > 0 ? plannedOriginal : 0;
}

function paidOriginalAmount(payment: SupplierPaymentRow): number {
  const actual = amount(payment.actual_amount_original);
  return actual > 0 ? actual : amount(payment.amount_original);
}

function paidRealEurAmount(payment: SupplierPaymentRow): number {
  const actual = amount(payment.actual_amount_eur);
  return actual > 0 ? actual : amount(payment.amount_eur);
}

/**
 * Construye un resumen por contenedor a partir de pagos existentes en finance_supplier_payments.
 *
 * @param links - Vínculos contenedor/orden usados para asignar pagos leídos por orden_id.
 * @param payments - Pagos persistidos, sin recalcular importes ni fechas.
 * @returns Mapa contenedor_id -> resumen de importes pagados y pendientes.
 */
export function buildContainerPaymentSummaries(
  links: ContainerPaymentOrderLink[],
  payments: SupplierPaymentRow[],
): Map<string, ContainerPaymentSummary> {
  const containerByOrder = new Map(links.map((link) => [link.orden_id, link.contenedor_id]));
  const orderById = new Map(
    links.map((link) => [link.orden_id, firstRelation(link.ordenes_compra)]),
  );
  const paymentsByOrder = new Map<string, SupplierPaymentRow[]>();
  for (const payment of payments) {
    const rows = paymentsByOrder.get(payment.orden_id) ?? [];
    rows.push(payment);
    paymentsByOrder.set(payment.orden_id, rows);
  }

  const summaries = new Map<string, ContainerPaymentSummary>();
  const paidDatesByContainer = new Map<string, string[]>();
  const pendingDatesByContainer = new Map<string, string[]>();

  for (const link of links) {
    const containerId = link.contenedor_id;
    if (!containerId) continue;

    const summary = summaries.get(containerId) ?? {
      pagadoImporteEur: 0,
      pagadoFecha: null,
      pendienteImporteEur: 0,
      pendienteFechaPrevista: null,
      supplierOriginalCurrency: null,
      supplierTotalOriginal: 0,
      supplierPaidOriginal: 0,
      supplierPendingOriginal: 0,
      supplierPaidRealEur: 0,
      supplierPlannedEur: 0,
    };
    const order = orderById.get(link.orden_id) ?? null;
    const orderPayments = paymentsByOrder.get(link.orden_id) ?? [];
    const currency =
      normalizeCurrency(order?.["moneda_compra"]) ??
      normalizeCurrency(orderPayments.find((payment) => payment.original_currency)?.original_currency) ??
      "USD";
    const sameCurrency =
      summary.supplierOriginalCurrency == null || summary.supplierOriginalCurrency === currency;

    if (sameCurrency) {
      summary.supplierOriginalCurrency = currency;
      const totalOriginal = resolveOrderTotalOriginal(order, orderPayments, currency);
      const paidOriginal = orderPayments
        .filter(isPaid)
        .reduce((sum, payment) => sum + paidOriginalAmount(payment), 0);
      const paidRealEur = orderPayments
        .filter(isPaid)
        .reduce((sum, payment) => sum + paidRealEurAmount(payment), 0);
      const plannedEur =
        amount(order?.["coste_total_eur"] as number | null) ||
        orderPayments.reduce((sum, payment) => sum + amountEur(payment.amount_eur), 0);

      summary.supplierTotalOriginal = (summary.supplierTotalOriginal ?? 0) + totalOriginal;
      summary.supplierPaidOriginal = (summary.supplierPaidOriginal ?? 0) + paidOriginal;
      summary.supplierPendingOriginal =
        (summary.supplierPendingOriginal ?? 0) + Math.max(0, totalOriginal - paidOriginal);
      summary.supplierPaidRealEur = (summary.supplierPaidRealEur ?? 0) + paidRealEur;
      summary.supplierPlannedEur = (summary.supplierPlannedEur ?? 0) + plannedEur;
    } else {
      summary.supplierOriginalCurrency = null;
      summary.supplierTotalOriginal = null;
      summary.supplierPaidOriginal = null;
      summary.supplierPendingOriginal = null;
      summary.supplierPlannedEur = null;
      summary.supplierPaidRealEur =
        (summary.supplierPaidRealEur ?? 0) +
        orderPayments.filter(isPaid).reduce((sum, payment) => sum + paidRealEurAmount(payment), 0);
    }

    for (const payment of orderPayments) {
      if (isPaid(payment)) {
        summary.pagadoImporteEur += paidRealEurAmount(payment);
      const paidDate = dateOnly(payment.paid_at);
      if (paidDate) {
        const paidDates = paidDatesByContainer.get(containerId) ?? [];
        paidDates.push(paidDate);
        paidDatesByContainer.set(containerId, paidDates);
      }
    } else {
      summary.pendienteImporteEur += amountEur(payment.amount_eur);
      const dueDate = dateOnly(payment.due_date);
      if (dueDate) {
        const pendingDates = pendingDatesByContainer.get(containerId) ?? [];
        pendingDates.push(dueDate);
        pendingDatesByContainer.set(containerId, pendingDates);
      }
    }
    }

    summaries.set(containerId, summary);
  }

  for (const payment of payments) {
    const containerId = payment.contenedor_id ?? containerByOrder.get(payment.orden_id);
    if (!containerId || summaries.has(containerId)) continue;

    const summary = {
      pagadoImporteEur: isPaid(payment) ? paidRealEurAmount(payment) : 0,
      pagadoFecha: dateOnly(payment.paid_at),
      pendienteImporteEur: isPaid(payment) ? 0 : amountEur(payment.amount_eur),
      pendienteFechaPrevista: isPaid(payment) ? null : dateOnly(payment.due_date),
      supplierOriginalCurrency: normalizeCurrency(payment.original_currency),
      supplierTotalOriginal: amount(payment.amount_original),
      supplierPaidOriginal: isPaid(payment) ? paidOriginalAmount(payment) : 0,
      supplierPendingOriginal: isPaid(payment) ? 0 : amount(payment.amount_original),
      supplierPaidRealEur: isPaid(payment) ? paidRealEurAmount(payment) : 0,
      supplierPlannedEur: amountEur(payment.amount_eur),
    };
    summaries.set(containerId, summary);
  }

  for (const [containerId, summary] of Array.from(summaries.entries())) {
    const paidDates = paidDatesByContainer.get(containerId) ?? [];
    summary.pagadoFecha = paidDates.length > 0 ? paidDates.sort((a, b) => b.localeCompare(a))[0] : null;
    summary.pendienteFechaPrevista = resolvePendingDueDate(
      pendingDatesByContainer.get(containerId) ?? [],
    );
  }

  return summaries;
}
