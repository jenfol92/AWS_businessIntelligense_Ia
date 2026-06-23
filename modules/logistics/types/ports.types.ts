/**
 * Tipos de puertos de origen y destino.
 * Coinciden con la respuesta de GET /api/logistics/ports.
 * Definidos aquí para no importar desde rutas app/api.
 */

export type OriginPort = {
  id: string;
  name: string;
  code: string | null;
  pais: string | null;
};

export type DestinationPort = {
  id: string;
  name: string;
  country: string | null;
  code: string | null;
};
