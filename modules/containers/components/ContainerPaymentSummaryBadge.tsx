/**
 * Módulo      : containers
 * Archivo     : components/ContainerPaymentSummaryBadge.tsx
 * Responsabilidad: mostrar un resumen compacto de pagos proveedor ya persistidos.
 * No debe     : calcular, crear, actualizar ni sincronizar pagos.
 */

import type { ContainerPaymentSummary } from "@/modules/containers/types/containerUiTypes";

export type ContainerPaymentSummaryBadgeProps = {
  pagos?: ContainerPaymentSummary;
  align?: "left" | "right";
};

function formatCurrency(value: number): string {
  return `${Number(value ?? 0).toLocaleString("es-ES", { maximumFractionDigits: 0 })} €`;
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
 * Renderiza el resumen de pagos de un contenedor cuando existe información en finance_supplier_payments.
 * @param pagos - Resumen agregado de pagos persistidos.
 * @param align - Alineación visual para tabla desktop o card móvil.
 */
export function ContainerPaymentSummaryBadge({
  pagos,
  align = "left",
}: ContainerPaymentSummaryBadgeProps) {
  if (!pagos) return <span className="text-xs text-slate-300">-</span>;

  return (
    <div
      className={`max-w-full space-y-0.5 text-[11px] leading-snug ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <div className="font-semibold text-emerald-700">
        Pagado: {formatCurrency(pagos.pagadoImporteEur)}
        {pagos.pagadoFecha ? ` · ${formatDate(pagos.pagadoFecha)}` : ""}
      </div>
      <div className="font-semibold text-amber-700">
        Pendiente: {formatCurrency(pagos.pendienteImporteEur)}
        {pagos.pendienteFechaPrevista ? ` · ${formatDate(pagos.pendienteFechaPrevista)}` : ""}
      </div>
    </div>
  );
}
