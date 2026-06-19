import { resolveInboundScope } from "@/modules/planner/services/resolveInboundScope";

export type ResolvedArrivalDestination = {
  destination: string | null;
  destinationBadge: string;
  destinationCountry: string | null;
  destinationChannel: string | null;
};

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveCountryFromPort(
  port: string | null | undefined,
  portCountryByPort: Map<string, string>,
): string | null {
  if (!port?.trim()) return null;
  return portCountryByPort.get(port.trim().toLowerCase()) ?? null;
}

export function resolveArrivalDestination(params: {
  puertoLlegada?: string | null;
  destinoOrden?: string | null;
  tipoContenedor?: string | null;
  portCountryByPort?: Map<string, string>;
}): ResolvedArrivalDestination {
  const puertoLlegada = params.puertoLlegada?.trim() || null;
  const destinoOrden = params.destinoOrden?.trim() || null;
  const portCountry = resolveCountryFromPort(puertoLlegada, params.portCountryByPort ?? new Map());

  const scope = resolveInboundScope({
    destinoOrden: destinoOrden ?? puertoLlegada,
    tipoContenedor: params.tipoContenedor ?? null,
    puertoLlegada,
  });

  const destination =
    puertoLlegada
    ?? destinoOrden
    ?? (scope.country ? scope.country : null)
    ?? null;

  if (scope.channel === "FBA" && scope.country) {
    return {
      destination: destination ?? `FBA · ${scope.country}`,
      destinationBadge: "FBA",
      destinationCountry: scope.country,
      destinationChannel: "FBA",
    };
  }

  if (scope.channel === "OWN_WAREHOUSE") {
    return {
      destination: destination ?? "ES · Almacén propio",
      destinationBadge: "ES",
      destinationCountry: "ES",
      destinationChannel: "OWN_WAREHOUSE",
    };
  }

  if (scope.country) {
    return {
      destination: destination ?? scope.country,
      destinationBadge: scope.country,
      destinationCountry: scope.country,
      destinationChannel: scope.channel,
    };
  }

  if (portCountry) {
    return {
      destination: destination ?? puertoLlegada,
      destinationBadge: portCountry,
      destinationCountry: portCountry,
      destinationChannel: null,
    };
  }

  if (destination) {
    return {
      destination,
      destinationBadge: titleCase(destination).slice(0, 12),
      destinationCountry: null,
      destinationChannel: null,
    };
  }

  return {
    destination: null,
    destinationBadge: "Sin destino",
    destinationCountry: null,
    destinationChannel: null,
  };
}
