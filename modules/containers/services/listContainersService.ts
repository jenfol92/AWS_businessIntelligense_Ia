/**
 * Módulo      : containers
 * Archivo     : services/listContainersService.ts
 * Responsabilidad: orquestación del listado de contenedores con sus órdenes,
 *                  destino resuelto y badge de destino.
 * No debe     : gestionar autenticación ni respuestas HTTP.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchContainerListByEstado,
  fetchOrderItemSearchRows,
} from "@/modules/containers/repositories/containersRepository";
import { fetchContainerOrderLinks } from "@/modules/containers/repositories/containerOrdersRepository";
import { buildContainerPaymentSummaries } from "@/modules/containers/services/buildContainerPaymentSummaries";
import { mapContainerListRows } from "@/modules/containers/utils/mapContainerListRows";
import { fetchSupplierPaymentsByOrderIds } from "@/modules/finance/repositories/financeSupplierPaymentsRepository";
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
  const orderIds = Array.from(new Set(links.map((link) => link.orden_id).filter(Boolean)));
  const [searchItems, payments] = await Promise.all([
    fetchOrderItemSearchRows(supabase, orderIds),
    fetchSupplierPaymentsByOrderIds(supabase, orderIds),
  ]);
  const paymentSummaries = buildContainerPaymentSummaries(links, payments);

  return mapContainerListRows(
    contenedores,
    links,
    searchItems as Parameters<typeof mapContainerListRows>[2],
  ).map((row) => {
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
      pagos: paymentSummaries.get(String(row.id)) ?? undefined,
    };
  });
}
