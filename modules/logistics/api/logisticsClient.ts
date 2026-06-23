import type { OriginPort, DestinationPort } from "@/modules/logistics/types/ports.types";

export type PortsCatalog = {
  originPorts: OriginPort[];
  destinationPorts: DestinationPort[];
};

/**
 * Carga puertos de origen (China) y destino desde GET /api/logistics/ports.
 * Nunca lanza: devuelve arrays vacíos si falla para no bloquear la UI.
 */
export async function fetchPortsCatalog(): Promise<PortsCatalog> {
  try {
    const res  = await fetch("/api/logistics/ports");
    const json = await res.json();
    if (json.ok) {
      return {
        originPorts:      json.originPorts      ?? [],
        destinationPorts: json.destinationPorts ?? [],
      };
    }
  } catch {
    // No bloquear la UI si falla la carga de puertos
  }
  return { originPorts: [], destinationPorts: [] };
}
