import type { OrderLogisticsType } from "@/modules/finance/types/supplierPayments.types";

function normalizeTipo(value: string | null | undefined): OrderLogisticsType | null {
  if (!value?.trim()) return null;
  const v = value.trim().toLowerCase();
  if (v === "amazon_agl" || v === "agl") return "amazon_agl";
  if (v === "propio") return "propio";
  return null;
}

/**
 * Fuente única: contenedores.tipo_contenedor (via contenedor_ordenes).
 * Si no hay contenedor vinculado, devuelve sin_definir.
 */
export function resolveOrderLogisticsType(params: {
  containerTipoContenedor?: string | null;
}): OrderLogisticsType {
  return normalizeTipo(params.containerTipoContenedor) ?? "sin_definir";
}

export function logisticsTypeToPlanningLabel(type: OrderLogisticsType): "AGL" | "PROPIO" | "SIN_DEFINIR" {
  if (type === "amazon_agl") return "AGL";
  if (type === "propio") return "PROPIO";
  return "SIN_DEFINIR";
}
