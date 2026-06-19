/**
 * Módulo      : containers
 * Archivo     : services/listContainersService.ts
 * Responsabilidad: orquestación del listado de contenedores con sus órdenes,
 *                  destino resuelto y badge de destino.
 * No debe     : gestionar autenticación ni respuestas HTTP.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchContainerListByEstado } from "@/modules/containers/repositories/containersRepository";
import { fetchContainerOrderLinks } from "@/modules/containers/repositories/containerOrdersRepository";
import { mapContainerListRows } from "@/modules/containers/utils/mapContainerListRows";
import { fetchPortCountryMap } from "@/modules/planner/repositories/plannerDestinationsRepository";
import { resolveArrivalDestination } from "@/modules/planner/utils/resolveArrivalDestination";

/**
 * Devuelve la lista de contenedores enriquecida con órdenes vinculadas y destino resuelto.
 * @param supabase - Cliente Supabase autenticado.
 * @param estado   - Filtro de estado. Pasar "ALL" o undefined para sin filtro.
 */
export async function listContainersService(
  supabase: SupabaseClient,
  estado?: string | null,
): Promise<Record<string, unknown>[]> {
  const contenedores = await fetchContainerListByEstado(supabase, estado);
  if (contenedores.length === 0) return [];

  const ids = contenedores.map((c) => c["id"] as string);
  const [links, portCountryByPort] = await Promise.all([
    fetchContainerOrderLinks(supabase, ids),
    fetchPortCountryMap(supabase),
  ]);

  return mapContainerListRows(contenedores, links).map((row) => {
    const ordenes = (row.ordenes as Array<{ destino?: string | null }> | undefined) ?? [];
    const resolved = resolveArrivalDestination({
      puertoLlegada: (row.puerto_llegada as string | null) ?? null,
      destinoOrden: ordenes[0]?.destino ?? null,
      tipoContenedor: (row.tipo_contenedor as string | null) ?? null,
      portCountryByPort,
    });
    return {
      ...row,
      destino_label: resolved.destination ?? "Sin destino definido",
      destino_badge:
        resolved.destination === null ? "Sin destino definido" : resolved.destinationBadge,
    };
  });
}
