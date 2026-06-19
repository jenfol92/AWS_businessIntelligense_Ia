import type { OrderLogisticsType } from "@/modules/finance/types/supplierPayments.types";

function normalizeDate(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return value.trim().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function resolveDepositDueDate(order: {
  fecha_confirmacion?: string | null;
  fecha_orden?: string | null;
}): string | null {
  return normalizeDate(order.fecha_confirmacion) ?? normalizeDate(order.fecha_orden);
}

export function resolveBalanceDueDate(params: {
  logisticsType: OrderLogisticsType;
  order: {
    etd?: string | null;
    eta?: string | null;
    eta_real?: string | null;
    balance_dias_antes_eta?: number | null;
    fecha_pago_balance?: string | null;
  };
  container?: {
    fecha_salida?: string | null;
    fecha_eta_estimada?: string | null;
  } | null;
}): string | null {
  const { logisticsType, order, container } = params;

  if (logisticsType === "amazon_agl") {
    return (
      normalizeDate(container?.fecha_salida)
      ?? normalizeDate(order.etd)
      ?? null
    );
  }

  if (logisticsType === "propio") {
    const balanceDays = Math.max(0, Number(order.balance_dias_antes_eta ?? 10));
    const eta =
      normalizeDate(container?.fecha_eta_estimada)
      ?? normalizeDate(order.eta_real)
      ?? normalizeDate(order.eta);
    if (eta) return addDays(eta, balanceDays);
    return normalizeDate(order.fecha_pago_balance);
  }

  return normalizeDate(order.fecha_pago_balance);
}
