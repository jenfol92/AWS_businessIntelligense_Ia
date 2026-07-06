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

export function arrivalLogisticsLabel(order: Pick<ArrivalOrder, "logisticsKind" | "amazonInbound" | "tipoEnvio">): string {
  if (order.logisticsKind === "amazon_inbound") {
    const route = amazonInboundRouteLabel(order.amazonInbound?.logistics_flow ?? null);
    const transport = amazonInboundTransportLabel(
      order.amazonInbound?.transport_provider ?? null,
      order.tipoEnvio,
    );
    return transport ? `${route} · ${transport}` : route;
  }

  if (order.logisticsKind === "contenedor_propio") {
    return "Contenedor propio";
  }

  if (order.tipoEnvio === "amazon_agl") {
    return "Amazon AGL pendiente vínculo";
  }

  return "Sin logística vinculada";
}
