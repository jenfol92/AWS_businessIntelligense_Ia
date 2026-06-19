import type { SupplierRow } from "../types/supplier.types";

/** Motivos legibles cuando faltan datos críticos para el planner. */
export function getSupplierIncompleteReasons(row: SupplierRow): string[] {
  const reasons: string[] = [];

  const hasPort =
    (row.puerto_preferido_id != null && row.puerto_preferido_id !== "") ||
    (row.puerto_preferido != null && row.puerto_preferido.trim() !== "");

  if (!hasPort) reasons.push("Sin puerto");

  if (row.latitud == null || row.longitud == null) {
    reasons.push("Sin coordenadas");
  }

  if (row.agente_id == null || row.agente_id === "") {
    reasons.push("Sin agente");
  }

  const prod = row.dias_produccion_estandar;
  const trans = row.dias_transito_estandar;
  if (
    prod == null ||
    trans == null ||
    prod < 0 ||
    trans < 0 ||
    (prod === 0 && trans === 0)
  ) {
    reasons.push("Sin tiempos logísticos");
  }

  return reasons;
}

export function isSupplierIncomplete(row: SupplierRow): boolean {
  return getSupplierIncompleteReasons(row).length > 0;
}
