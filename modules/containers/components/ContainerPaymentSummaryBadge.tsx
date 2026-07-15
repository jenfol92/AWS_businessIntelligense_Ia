/**
 * Modulo      : containers
 * Archivo     : components/ContainerPaymentSummaryBadge.tsx
 * Responsabilidad: mostrar resumen compacto de pagos proveedor ya persistidos.
 * No debe     : calcular, crear, actualizar ni sincronizar pagos.
 */

import type { ContainerPaymentSummary } from "@/modules/containers/types/containerUiTypes";
import { formatEur } from "@/shared/utils/currency";

export type ContainerPaymentSummaryBadgeProps = {
  pagos?: ContainerPaymentSummary;
  align?: "left" | "right";
};

function formatOriginalCurrency(
  value: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (value == null || !Number.isFinite(Number(value))) return "-";
  const normalizedCurrency = currency?.trim().toUpperCase() || "USD";
  if (normalizedCurrency === "EUR") return formatEur(value);

  return `${Number(value).toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${normalizedCurrency}`;
}

function formatDate(value: string | null): string {
  if (!value) return "sin fecha";
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Renderiza el resumen de pagos de un contenedor cuando existe informacion en finance_supplier_payments.
 */
export function ContainerPaymentSummaryBadge({
  pagos,
  align = "left",
}: ContainerPaymentSummaryBadgeProps) {
  if (!pagos) return <span className="text-xs text-slate-300">-</span>;

  const currency = pagos.supplierOriginalCurrency;
  const paidOriginal = pagos.supplierPaidOriginal ?? 0;
  const pendingOriginal = pagos.supplierPendingOriginal;
  const paidLabel =
    paidOriginal > 0 && currency
      ? formatOriginalCurrency(paidOriginal, currency)
      : "-";
  const pendingLabel =
    pendingOriginal != null && currency
      ? formatOriginalCurrency(pendingOriginal, currency)
      : "-";
  const showRealEur =
    currency !== "EUR" && pagos.supplierPaidRealEur != null && pagos.supplierPaidRealEur > 0;

  return (
    <div
      className={`max-w-full space-y-0.5 text-[11px] leading-snug ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <div className="font-semibold text-emerald-700">
        Pagado: {paidLabel}
        {pagos.pagadoFecha ? ` · ${formatDate(pagos.pagadoFecha)}` : ""}
      </div>
      {showRealEur ? (
        <div className="text-slate-500">
          EUR real pagado: {formatEur(pagos.supplierPaidRealEur)}
        </div>
      ) : null}
      <div className="font-semibold text-amber-700">
        Pendiente: {pendingLabel}
        {pagos.pendienteFechaPrevista ? ` · ${formatDate(pagos.pendienteFechaPrevista)}` : ""}
      </div>
    </div>
  );
}

export function ContainerSupplierCostSummary({
  pagos,
  fallbackEur,
  align = "left",
}: {
  pagos?: ContainerPaymentSummary;
  fallbackEur: number | null | undefined;
  align?: "left" | "right";
}) {
  const currency = pagos?.supplierOriginalCurrency;
  const totalOriginal = pagos?.supplierTotalOriginal;
  const plannedEur = pagos?.supplierPlannedEur ?? fallbackEur ?? null;

  if (currency && totalOriginal != null) {
    const isEur = currency === "EUR";
    return (
      <div className={`space-y-0.5 text-[11px] leading-snug ${align === "right" ? "text-right" : "text-left"}`}>
        <div className="font-semibold text-slate-800">
          {formatOriginalCurrency(totalOriginal, currency)}
        </div>
        {!isEur && plannedEur != null ? (
          <div className="text-slate-500">Prev. {formatEur(plannedEur)}</div>
        ) : null}
      </div>
    );
  }

  return (
    <span className="text-xs font-semibold text-slate-800 tabular-nums">
      {formatEur(fallbackEur ?? 0)}
    </span>
  );
}
