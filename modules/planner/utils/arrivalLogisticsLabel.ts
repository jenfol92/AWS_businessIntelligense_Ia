import type { ArrivalOrder } from "@/modules/planner/types/arrivals.types";

export function amazonInboundRouteLabel(flow: string | null | undefined): string {
  if (flow === "fabrica_a_amazon" || flow === "proveedor_a_amazon") return "Fábrica → Amazon";
  if (flow === "almacen_a_amazon") return "Almacén → Amazon";
  return "Amazon inbound";
}

export function amazonInboundTransportLabel(
  provider: string | null | undefined,
  tipoEnvioOrden?: string | null,
): string | null {
  if (provider === "amazon_agl") return "Amazon AGL";
  if (provider === "propio") return "Logística propia";
  if (tipoEnvioOrden === "amazon_agl") return "Amazon AGL";
  return null;
}

export type ResolveLogisticsLabelParams = {
  logisticsKind?: ArrivalOrder["logisticsKind"] | null;
  tipoEnvio?: string | null;
  hasAmazonInbound?: boolean;
  hasContainer?: boolean;
};

/**
 * Etiqueta logística canónica para cards y listados.
 * Valores: Amazon AGL | Envío propio | Sin logística vinculada
 */
export function resolveLogisticsLabel(params: ResolveLogisticsLabelParams): string {
  if (params.hasAmazonInbound || params.logisticsKind === "amazon_inbound") {
    return "Amazon AGL";
  }
  if (params.hasContainer || params.logisticsKind === "contenedor_propio") {
    return "Envío propio";
  }

  const tipo = String(params.tipoEnvio ?? "").trim().toLowerCase();
  if (tipo === "amazon_agl" || tipo === "agl") return "Amazon AGL";
  if (tipo === "propio" || tipo === "envio_propio" || tipo === "own_container") {
    return "Envío propio";
  }

  return "Sin logística vinculada";
}

export function resolveLogisticsLabelFromArrivalOrder(
  order: Pick<ArrivalOrder, "logisticsKind" | "tipoEnvio">,
): string {
  return resolveLogisticsLabel({
    logisticsKind: order.logisticsKind,
    tipoEnvio: order.tipoEnvio,
    hasAmazonInbound: order.logisticsKind === "amazon_inbound",
    hasContainer: order.logisticsKind === "contenedor_propio",
  });
}

/** Detalle operativo ruta + transporte (Pedidos / modal inbound). */
export function arrivalLogisticsDetailLabel(
  order: Pick<ArrivalOrder, "logisticsKind" | "amazonInbound" | "tipoEnvio">,
): string {
  if (order.logisticsKind === "amazon_inbound") {
    const route = amazonInboundRouteLabel(order.amazonInbound?.logistics_flow ?? null);
    const transport = amazonInboundTransportLabel(
      order.amazonInbound?.transport_provider ?? null,
      order.tipoEnvio,
    );
    return transport ? `${route} · ${transport}` : route;
  }

  return resolveLogisticsLabelFromArrivalOrder(order);
}

/** Alias canónico: misma etiqueta que resolveLogisticsLabelFromArrivalOrder. */
export function arrivalLogisticsLabel(
  order: Pick<ArrivalOrder, "logisticsKind" | "amazonInbound" | "tipoEnvio">,
): string {
  return resolveLogisticsLabelFromArrivalOrder(order);
}

export function resolveLogisticsLabelFromOrder(params: {
  tipoEnvio?: string | null;
  hasAmazonInbound?: boolean;
  hasContainer?: boolean;
}): string {
  return resolveLogisticsLabel({
    tipoEnvio: params.tipoEnvio,
    hasAmazonInbound: params.hasAmazonInbound,
    hasContainer: params.hasContainer,
  });
}
