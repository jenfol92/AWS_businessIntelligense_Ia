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
};

export type ContainerPaymentOrderLink = {
  contenedor_id: string;
  orden_id: string;
};

function amountEur(value: number | null | undefined): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function dateOnly(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

function isPaid(payment: Pick<SupplierPaymentRow, "status" | "paid_at">): boolean {
  return payment.status === "pagado" || Boolean(payment.paid_at);
}

function resolvePendingDueDate(dueDates: string[]): string | null {
  if (dueDates.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...dueDates].sort((a, b) => a.localeCompare(b));
  const future = sorted.find((date) => date >= today);
  return future ?? sorted[0] ?? null;
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
  const summaries = new Map<string, ContainerPaymentSummary>();
  const paidDatesByContainer = new Map<string, string[]>();
  const pendingDatesByContainer = new Map<string, string[]>();

  for (const payment of payments) {
    const containerId = payment.contenedor_id ?? containerByOrder.get(payment.orden_id);
    if (!containerId) continue;

    const summary = summaries.get(containerId) ?? {
      pagadoImporteEur: 0,
      pagadoFecha: null,
      pendienteImporteEur: 0,
      pendienteFechaPrevista: null,
    };

    if (isPaid(payment)) {
      summary.pagadoImporteEur += amountEur(payment.amount_eur);
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
