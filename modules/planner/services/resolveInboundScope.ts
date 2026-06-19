export type InboundScopeChannel = "FBA" | "FBM" | "OWN_WAREHOUSE" | "UNKNOWN";

export type InboundScope = {
  country: string | null;
  channel: InboundScopeChannel;
  isFba: boolean;
  warning?: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export function resolveInboundScope(params: {
  destinoOrden: string | null;
  tipoContenedor?: string | null;
  puertoLlegada?: string | null;
  transitario?: string | null;
}): InboundScope {
  const destino = normalizeText(params.destinoOrden);
  const puertoLlegada = normalizeText(params.puertoLlegada);

  const isValencia =
    destino.includes("VALENCIA") || puertoLlegada.includes("VALENCIA");

  if (isValencia) {
    return {
      country: "ES",
      channel: "OWN_WAREHOUSE",
      isFba: false,
    };
  }

  if (
    destino.includes("ALEMANIA") ||
    destino.includes("GERMANY") ||
    /\bDE\b/.test(destino)
  ) {
    return { country: "DE", channel: "FBA", isFba: true };
  }

  if (
    destino.includes("FRANCIA") ||
    destino.includes("FRANCE") ||
    /\bFR\b/.test(destino)
  ) {
    return { country: "FR", channel: "FBA", isFba: true };
  }

  if (
    destino.includes("ITALIA") ||
    destino.includes("ITALY") ||
    /\bIT\b/.test(destino)
  ) {
    return { country: "IT", channel: "FBA", isFba: true };
  }

  if (
    destino.includes("ESPAÑA") ||
    destino.includes("SPAIN") ||
    destino.includes("AMAZON ES") ||
    /\bES\b/.test(destino)
  ) {
    return { country: "ES", channel: "FBA", isFba: true };
  }

  if (
    destino.includes("REINO UNIDO") ||
    destino.includes("UNITED KINGDOM") ||
    destino.includes("UK") ||
    destino.includes("GB")
  ) {
    return { country: "GB", channel: "FBA", isFba: true };
  }

  if (
    destino.includes("POLONIA") ||
    destino.includes("POLAND") ||
    /\bPL\b/.test(destino)
  ) {
    return { country: "PL", channel: "FBA", isFba: true };
  }

  if (
    destino.includes("SUECIA") ||
    destino.includes("SWEDEN") ||
    /\bSE\b/.test(destino)
  ) {
    return { country: "SE", channel: "FBA", isFba: true };
  }

  if (
    destino.includes("PAISES BAJOS") ||
    destino.includes("NETHERLANDS") ||
    destino.includes("HOLANDA") ||
    /\bNL\b/.test(destino)
  ) {
    return { country: "NL", channel: "FBA", isFba: true };
  }

  if (destino.includes("BELGICA") || destino.includes("BELGIUM") || /\bBE\b/.test(destino)) {
    return { country: "BE", channel: "FBA", isFba: true };
  }

  return {
    country: null,
    channel: "UNKNOWN",
    isFba: false,
    warning: `No se pudo resolver país/canal para destino: ${params.destinoOrden ?? ""}`,
  };
}

export function mapInboundScopeToForecastChannel(
  channel: InboundScopeChannel,
): "FBA" | "FBM" | "OWN_WAREHOUSE" | "UNKNOWN" {
  return channel;
}
