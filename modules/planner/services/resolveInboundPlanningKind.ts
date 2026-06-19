import type {
  ForecastInboundItem,
  ForecastInboundItemRaw,
  ForecastInboundScheduleEntry,
} from "../types/forecastInbound.types";

export type InboundPlanningKind =
  | "CONTAINER_CONFIRMED"
  | "PURCHASE_ORDER_CONFIRMED"
  | "PURCHASE_ORDER_PROVISIONAL";

export function resolveInboundPlanningKind(
  row: Pick<
    ForecastInboundItemRaw,
    "has_contenedor" | "confidence" | "fecha_eta_estimada" | "unidades_pendientes"
  >,
): InboundPlanningKind {
  if (row.unidades_pendientes <= 0) {
    return "PURCHASE_ORDER_PROVISIONAL";
  }
  if (row.has_contenedor) {
    return "CONTAINER_CONFIRMED";
  }
  const eta = row.fecha_eta_estimada?.slice(0, 10) ?? null;
  // En v_forecast_inbound_items, confidence='provisional' = orden confirmada sin contenedor.
  if (eta && row.confidence === "provisional") {
    return "PURCHASE_ORDER_CONFIRMED";
  }
  if (row.confidence === "confirmed") {
    return "CONTAINER_CONFIRMED";
  }
  if (eta) {
    return "PURCHASE_ORDER_CONFIRMED";
  }
  return "PURCHASE_ORDER_PROVISIONAL";
}

export function usableForPlanning(kind: InboundPlanningKind): boolean {
  return (
    kind === "CONTAINER_CONFIRMED" || kind === "PURCHASE_ORDER_CONFIRMED"
  );
}

export function inboundPlanningKindLabel(kind: InboundPlanningKind): string {
  switch (kind) {
    case "CONTAINER_CONFIRMED":
      return "Contenedor confirmado";
    case "PURCHASE_ORDER_CONFIRMED":
      return "Orden confirmada sin contenedor";
    case "PURCHASE_ORDER_PROVISIONAL":
      return "Orden provisional";
    default:
      return kind;
  }
}

/** Etiqueta legacy UI: confirmed | provisional */
export function legacyInboundConfidence(
  kind: InboundPlanningKind,
): "confirmed" | "provisional" {
  return usableForPlanning(kind) ? "confirmed" : "provisional";
}

export function buildForecastInboundScheduleEntry(
  item: ForecastInboundItem,
): ForecastInboundScheduleEntry | null {
  const eta = item.fecha_eta_estimada?.slice(0, 10) ?? null;
  if (!eta || item.unidades_pendientes <= 0) return null;

  const planningKind = resolveInboundPlanningKind(item);
  return {
    eta,
    units: item.unidades_pendientes,
    confidence: legacyInboundConfidence(planningKind),
    planningKind,
    usableForPlanning: usableForPlanning(planningKind),
    ordenId: item.orden_id,
    numeroOrden: item.numero_orden,
    forecastCountry: item.forecast_country,
    forecastChannel: item.forecast_channel,
  };
}

export function aggregateScheduleByEta(
  entries: ForecastInboundScheduleEntry[],
): ForecastInboundScheduleEntry[] {
  const byKey = new Map<string, ForecastInboundScheduleEntry>();

  for (const entry of entries) {
    const key = [
      entry.eta.slice(0, 10),
      entry.planningKind,
      entry.forecastCountry ?? "",
      entry.forecastChannel ?? "",
    ].join("|");

    const existing = byKey.get(key);
    if (existing) {
      existing.units += entry.units;
    } else {
      byKey.set(key, { ...entry });
    }
  }

  return Array.from(byKey.values()).sort((a, b) =>
    a.eta.localeCompare(b.eta),
  );
}

export function scheduleEntryUsableForPlanning(
  entry: ForecastInboundScheduleEntry,
): boolean {
  if (entry.usableForPlanning != null) return entry.usableForPlanning;
  return entry.confidence === "confirmed";
}
