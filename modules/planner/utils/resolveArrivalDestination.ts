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
      destination: destination ?? scope.country,
      destinationBadge: scope.country,
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

const INVALID_DESTINATION_LABELS = new Set([
  "FBA",
  "FBM",
  "Amazon AGL",
  "Sin destino",
  "Sin destino definido",
]);

function normalizeCountryCode(value: string | null | undefined): string | null {
  const code = String(value ?? "").trim().toUpperCase();
  if (!code) return null;
  if (code === "UK") return "GB";
  if (/^[A-Z]{2,3}$/.test(code)) return code;
  return null;
}

/**
 * Etiqueta visible de destino: código país o texto limpio. Nunca FBA ni Amazon AGL.
 */
export function resolveDestinationLabel(
  resolved: ResolvedArrivalDestination,
  amazonDestinationCountry?: string | null,
): string {
  const fromCountry =
    normalizeCountryCode(resolved.destinationCountry)
    ?? normalizeCountryCode(amazonDestinationCountry);
  if (fromCountry) return fromCountry;

  const badge = resolved.destinationBadge?.trim() ?? "";
  if (badge && !INVALID_DESTINATION_LABELS.has(badge) && !badge.toLowerCase().includes("amazon")) {
    const badgeCode = normalizeCountryCode(badge);
    if (badgeCode) return badgeCode;
  }

  const destText = resolved.destination?.trim();
  if (destText) {
    const scope = resolveInboundScope({
      destinoOrden: destText,
      tipoContenedor: null,
    });
    const inferred = normalizeCountryCode(scope.country);
    if (inferred) return inferred;

    const upper = destText.toUpperCase();
    if (!upper.includes("FBA") && !upper.includes("AMAZON AGL")) {
      return destText;
    }
  }

  return "Destino pendiente";
}
