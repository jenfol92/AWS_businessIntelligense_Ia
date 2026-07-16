/**
 * Módulo      : orders
 * Archivo     : repositories/orderDraftRepository.ts
 * Responsabilidad: operaciones CRUD de Supabase sobre ordenes_compra y orden_items
 *                  usadas durante la creación y actualización de borradores.
 * No debe     : contener lógica de negocio, cálculos de costes/CBM ni preparar payloads.
 */

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type {
  OrdenCompraRow,
  OrdenItemRow,
  InsertOrderHeaderInput,
  UpdateOrderDraftInput,
} from "@/modules/orders/types/orderPersistence.types";

// ─────────────────────────────────────────────────────────────────────────────
// Creación de borrador
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inserta la cabecera de una nueva orden de compra en estado borrador.
 * Devuelve la fila completa incluyendo numero_orden e id generados por trigger.
 * Throws on Supabase error.
 */
export async function insertOrderDraftHeader(
  input: InsertOrderHeaderInput,
): Promise<OrdenCompraRow> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("ordenes_compra")
    .insert(input)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as OrdenCompraRow;
}

/**
 * Elimina hard una orden de compra por su id.
 * ON DELETE CASCADE en orden_items elimina automáticamente las líneas.
 * Usado exclusivamente como rollback cuando la inserción de líneas falla.
 * Throws on Supabase error.
 */
export async function deleteOrderDraftById(orderId: string): Promise<void> {
  const supabase = createSupabaseRouteClient();

  const { error } = await supabase
    .from("ordenes_compra")
    .delete()
    .eq("id", orderId);

  if (error) throw new Error(`Rollback failed: ${error.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Actualización de borrador
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Actualiza la cabecera de una orden en estado borrador.
 * El filtro estado=borrador garantiza que una orden ya confirmada no se modifica.
 * Throws on Supabase error.
 */
export async function updateOrderDraftHeader(
  orderId: string,
  header: UpdateOrderDraftInput,
): Promise<void> {
  const supabase = createSupabaseRouteClient();

  const { error } = await supabase
    .from("ordenes_compra")
    .update({ ...header, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("estado", "borrador");

  if (error) throw new Error(error.message);
}

/**
 * Elimina todas las líneas de una orden.
 * Usado antes de reinsertar líneas actualizadas.
 * Throws on Supabase error.
 */
export async function deleteOrderItemsByOrderId(orderId: string): Promise<void> {
  const supabase = createSupabaseRouteClient();

  const { error } = await supabase
    .from("orden_items")
    .delete()
    .eq("orden_id", orderId);

  if (error) throw new Error(`Error eliminando líneas anteriores: ${error.message}`);
}

/**
 * Inserta las filas de líneas ya preparadas en orden_items.
 * No aplica lógica de negocio; las filas deben llegar sanitizadas (sin cbm_total,
 * con orden_id adjunto) desde el service que llame a esta función.
 * Devuelve las filas insertadas (con id y cbm_total generados por Postgres).
 * Throws on Supabase error.
 */
export async function insertOrderDraftItemRows(
  rows: Record<string, unknown>[],
): Promise<OrdenItemRow[]> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("orden_items")
    .insert(rows)
    .select(
      "id, orden_id, producto_id, proveedor_id, cantidad, cbm_unitario, cbm_total, " +
      "coste_unitario_moneda, coste_unitario_usd, coste_unitario_eur, moneda_coste, lote_producto, notas, created_at",
    );

  if (error) throw new Error(`Error insertando nuevas líneas: ${error.message}`);
  return (data ?? []) as unknown as OrdenItemRow[];
}

/**
 * Lee la cabecera de la orden tras la actualización.
 * En este punto los triggers DB habrán recalculado cbm_total, coste_total_eur y coste_total_usd.
 * Throws on Supabase error.
 */
export async function fetchOrderAfterDraftUpdate(
  orderId: string,
): Promise<OrdenCompraRow> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("ordenes_compra")
    .select("*")
    .eq("id", orderId)
    .single();

  if (error) throw new Error(error.message);
  return data as OrdenCompraRow;
}
