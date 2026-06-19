/**
 * Módulo      : containers
 * Archivo     : services/getContainerDetailService.ts
 * Responsabilidad: orquestación del detalle completo de un contenedor:
 *                  datos, órdenes vinculadas con ítems, estado de stock,
 *                  previsión de costes y warnings.
 * No debe     : gestionar autenticación ni respuestas HTTP.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchContainerById,
  fetchContainerDetailOrderLinks,
  fetchOrderItemsForOrders,
} from "@/modules/containers/repositories/containersRepository";
import { getContainerStockOperationalStatus } from "@/modules/containers/services/applyContainerStock";
import { calculateContainerCbmCostAllocation } from "@/modules/containers/services/calculateContainerCbmCostAllocation";

// ─── Helpers de presentación de agente ───────────────────────────────────────

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function getOrderAgentContact(order: Record<string, unknown>): string | null {
  const agente = firstRelation(
    order["agentes_compra"] as
      | { contacto?: string | null }
      | Array<{ contacto?: string | null }>
      | null,
  );
  return agente?.contacto?.trim() || null;
}

/** Devuelve etiqueta del agente para el contenedor, agregando contactos únicos. */
function resolveContainerAgentLabel(orders: Record<string, unknown>[]): string | null {
  if (orders.length === 0) return null;
  const contacts = Array.from(
    new Set(
      orders.map(getOrderAgentContact).filter((c): c is string => Boolean(c)),
    ),
  );
  if (contacts.length === 0) return null;
  if (contacts.length > 1) return "Varios agentes";
  return contacts[0];
}

// ─── Resultado del servicio ───────────────────────────────────────────────────

export type ContainerDetailResult =
  | {
      ok: true;
      contenedor: Record<string, unknown>;
      ordenes: Record<string, unknown>[];
      stockStatus: Awaited<ReturnType<typeof getContainerStockOperationalStatus>>;
      costAllocationPreview: Awaited<ReturnType<typeof calculateContainerCbmCostAllocation>>;
      warnings: string[];
    }
  | { ok: false; error: string; status: number };

// ─── Servicio ─────────────────────────────────────────────────────────────────

/**
 * Devuelve el detalle completo de un contenedor: datos, órdenes con ítems,
 * estado operativo de stock y previsión de asignación de costes CBM.
 *
 * @param supabase     - Cliente Supabase autenticado.
 * @param contenedorId - ID del contenedor.
 */
export async function getContainerDetailService(
  supabase: SupabaseClient,
  contenedorId: string,
): Promise<ContainerDetailResult> {
  const cont = await fetchContainerById(supabase, contenedorId);
  if (!cont) {
    return { ok: false, error: "Contenedor no encontrado", status: 404 };
  }

  const links = await fetchContainerDetailOrderLinks(supabase, contenedorId);
  const ordenIds = links.map((l) => l.orden_id);
  const warnings: string[] = [];
  let ordenesConItems: Record<string, unknown>[] = [];

  if (ordenIds.length === 0) {
    warnings.push("container_has_no_orders");
  } else {
    const items = await fetchOrderItemsForOrders(supabase, ordenIds);
    ordenesConItems = links.map((l) => {
      const cab = (l.ordenes_compra ?? {}) as Record<string, unknown>;
      const oid = (cab["id"] ?? l.orden_id) as string;
      return {
        ...cab,
        agente_contacto: getOrderAgentContact(cab),
        id: oid,
        items: items.filter((i) => i["orden_id"] === l.orden_id),
      };
    });
  }

  let stockStatus: Awaited<ReturnType<typeof getContainerStockOperationalStatus>> = null;
  let costAllocationPreview: Awaited<
    ReturnType<typeof calculateContainerCbmCostAllocation>
  > = null;

  try {
    stockStatus = await getContainerStockOperationalStatus(contenedorId);
  } catch (err) {
    warnings.push(
      err instanceof Error ? `stock_status_error: ${err.message}` : "stock_status_error",
    );
  }

  if (ordenIds.length > 0) {
    try {
      costAllocationPreview = await calculateContainerCbmCostAllocation(contenedorId);
    } catch (err) {
      warnings.push(
        err instanceof Error ? `cost_preview_error: ${err.message}` : "cost_preview_error",
      );
    }
  }

  return {
    ok: true,
    contenedor: {
      ...cont,
      agente_contacto: resolveContainerAgentLabel(ordenesConItems),
    },
    ordenes: ordenesConItems,
    stockStatus,
    costAllocationPreview,
    warnings,
  };
}
