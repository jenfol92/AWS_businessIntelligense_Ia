/**
 * Módulo      : orders
 * Archivo     : services/updateOrderDraftService.ts
 * Responsabilidad: orquestación de la actualización de una orden en borrador:
 *   1. Actualiza la cabecera (solo si estado = borrador) vía repository.
 *   2. Si se proporcionan líneas, borra las anteriores y las reinserta preparadas
 *      (CBM y costes congelados desde catálogo, cbm_total eliminado).
 *   3. Devuelve la cabecera actualizada con totales recalculados por trigger DB.
 * No debe     : usar createSupabaseRouteClient ni supabase.from directamente.
 *               Gestionar autenticación ni respuestas HTTP.
 *
 * ADVERTENCIA DE TRANSACCIONALIDAD:
 *   El borrado e inserción de líneas se realiza en dos operaciones independientes.
 *   No existe transacción real (BEGIN/COMMIT). Si el INSERT de líneas nuevas falla
 *   tras el DELETE de las anteriores, la orden queda sin líneas hasta la siguiente
 *   edición exitosa. Comportamiento idéntico al código original.
 *   Pendiente para FASE B: migrar a una RPC transaccional en Postgres.
 */

import { prepareOrderItemsForPersistence } from "@/modules/orders/services/prepareOrderItemsForPersistence";
import {
  updateOrderDraftHeader,
  deleteOrderItemsByOrderId,
  insertOrderDraftItemRows,
  fetchOrderAfterDraftUpdate,
} from "@/modules/orders/repositories/orderDraftRepository";
import type {
  InsertOrderItemInput,
  UpdateOrderDraftInput,
  UpdateOrderDraftResult,
  OrderItemCostWarning,
} from "@/modules/orders/types/orderPersistence.types";

/**
 * Actualiza la cabecera de una orden en estado borrador y, opcionalmente,
 * reemplaza todas sus líneas (borra anteriores e inserta nuevas preparadas).
 *
 * Solo actúa sobre órdenes en estado "borrador". Si la orden ya está confirmada,
 * el UPDATE con filtro estado=borrador no modifica ninguna fila → se trata como
 * error de negocio.
 *
 * @param orderId - UUID de la orden a actualizar.
 * @param header  - Campos de cabecera a modificar.
 * @param items   - Nuevas líneas (opcional). Si se omite, las líneas no cambian.
 * @returns La cabecera de la orden actualizada con totales recalculados por trigger.
 * @throws Error si la orden no existe, no está en borrador, o falla cualquier operación.
 */
export async function updateOrderDraftService(
  orderId: string,
  header: UpdateOrderDraftInput,
  items?: Omit<InsertOrderItemInput, "orden_id">[],
): Promise<UpdateOrderDraftResult> {
  let costWarnings: OrderItemCostWarning[] = [];

  // Actualizar cabecera — el filtro estado=borrador protege órdenes ya confirmadas
  await updateOrderDraftHeader(orderId, header);

  // Reemplazar líneas si se proporcionan
  // (ver advertencia de transaccionalidad en el encabezado del archivo)
  if (items !== undefined) {
    await deleteOrderItemsByOrderId(orderId);

    if (items.length > 0) {
      const { rows, warnings } = await prepareOrderItemsForPersistence(orderId, items);
      costWarnings = warnings;
      await insertOrderDraftItemRows(rows);
    }
  }

  // Leer la cabecera actualizada — los triggers habrán recalculado
  // ordenes_compra.cbm_total, coste_total_eur y coste_total_usd
  const orden = await fetchOrderAfterDraftUpdate(orderId);
  return { orden, warnings: costWarnings };
}
