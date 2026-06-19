/**
 * Mapeo ordenes_compra → campos de contenedores.
 *
 * Columnas reales en ordenes_compra (ver ordersRepository / sql):
 *   etd          → fecha_salida del contenedor
 *   eta          → fecha_eta_estimada del contenedor
 *   fob_puerto   → puerto_salida
 *   destino      → puerto_llegada
 *   agente_contacto (join agentes_compra.contacto) → transitario
 */

export type OrderContainerSource = {
  etd?: string | null;
  eta?: string | null;
  fob_puerto?: string | null;
  destino?: string | null;
  agente_contacto?: string | null;
  lead_time_produccion?: number | null;
  lead_time_transito?: number | null;
};

export type ContainerFieldsFromOrder = {
  fecha_salida: string | null;
  fecha_eta_estimada: string | null;
  puerto_salida: string | null;
  puerto_llegada: string | null;
  transitario: string | null;
};

export const CONTAINER_FIELDS_FROM_ORDER_KEYS = [
  "fecha_salida",
  "fecha_eta_estimada",
  "puerto_salida",
  "puerto_llegada",
  "transitario",
] as const satisfies ReadonlyArray<keyof ContainerFieldsFromOrder>;

export type ContainerFieldFromOrderKey = (typeof CONTAINER_FIELDS_FROM_ORDER_KEYS)[number];

export function normalizeOrderDateField(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 10);
}

export function estimateEtaFromOrderLeadTime(order: OrderContainerSource): string | null {
  const etd = normalizeOrderDateField(order.etd);
  if (!etd) return null;

  const production = Number(order.lead_time_produccion);
  const transit = Number(order.lead_time_transito);
  const productionDays = Number.isFinite(production) && production > 0 ? Math.round(production) : 30;
  const transitDays = Number.isFinite(transit) && transit > 0 ? Math.round(transit) : 35;

  const date = new Date(`${etd}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + productionDays + transitDays);
  return date.toISOString().slice(0, 10);
}

/** ETA del contenedor: orden.eta directa; si no hay, ETD + lead times. */
export function resolveContainerEtaFromOrder(order: OrderContainerSource): string | null {
  const directEta = normalizeOrderDateField(order.eta);
  if (directEta) return directEta;
  return estimateEtaFromOrderLeadTime(order);
}

export function mapOrderToContainerFields(order: OrderContainerSource): ContainerFieldsFromOrder {
  return {
    fecha_salida: normalizeOrderDateField(order.etd),
    fecha_eta_estimada: resolveContainerEtaFromOrder(order),
    puerto_salida: order.fob_puerto?.trim() || null,
    puerto_llegada: order.destino?.trim() || null,
    transitario: order.agente_contacto?.trim() || null,
  };
}

/** Combina varias órdenes: primera con dato gana en puertos/agente; ETD más temprana; ETA más tardía. */
export function mergeOrdersToContainerFields(
  orders: OrderContainerSource[],
): ContainerFieldsFromOrder {
  const empty: ContainerFieldsFromOrder = {
    fecha_salida: null,
    fecha_eta_estimada: null,
    puerto_salida: null,
    puerto_llegada: null,
    transitario: null,
  };

  if (orders.length === 0) return empty;

  const mapped = orders.map(mapOrderToContainerFields);

  const etds = mapped.map((m) => m.fecha_salida).filter((v): v is string => Boolean(v));
  const etas = mapped.map((m) => m.fecha_eta_estimada).filter((v): v is string => Boolean(v));

  return {
    fecha_salida: etds.length > 0 ? [...etds].sort()[0]! : null,
    fecha_eta_estimada: etas.length > 0 ? [...etas].sort().slice(-1)[0]! : null,
    puerto_salida: mapped.find((m) => m.puerto_salida)?.puerto_salida ?? null,
    puerto_llegada: mapped.find((m) => m.puerto_llegada)?.puerto_llegada ?? null,
    transitario: mapped.find((m) => m.transitario)?.transitario ?? null,
  };
}

export function mergeOrderFieldsIntoValues<T extends Record<ContainerFieldFromOrderKey, string>>(
  current: T,
  fromOrder: ContainerFieldsFromOrder,
  mode: "empty_only" | "force",
): T {
  const next = { ...current };
  for (const key of CONTAINER_FIELDS_FROM_ORDER_KEYS) {
    const orderValue = fromOrder[key];
    if (!orderValue) continue;
    const currentValue = current[key]?.trim() ?? "";
    if (mode === "force" || !currentValue) {
      next[key] = orderValue;
    }
  }
  return next;
}

export function orderSourceHasInheritableData(order: OrderContainerSource): boolean {
  const mapped = mapOrderToContainerFields(order);
  return CONTAINER_FIELDS_FROM_ORDER_KEYS.some((key) => Boolean(mapped[key]));
}

export function containerValuesHaveAnyInheritedField<T extends Record<ContainerFieldFromOrderKey, string>>(
  values: T,
): boolean {
  return CONTAINER_FIELDS_FROM_ORDER_KEYS.some((key) => Boolean(values[key]?.trim()));
}
