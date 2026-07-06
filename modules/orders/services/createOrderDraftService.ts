/**
 * Módulo      : orders
 * Archivo     : services/createOrderDraftService.ts
 * Responsabilidad: orquestación de la creación de una orden en estado borrador:
 *   1. Valida que el draft esté listo para persistirse.
 *   2. Mapea el draft in-memory al formato de cabecera DB.
 *   3. Inserta la cabecera vía repository.
 *   4. Prepara las líneas (CBM y costes congelados) vía prepareOrderItemsForPersistence.
 *   5. Inserta las líneas vía repository.
 *   6. En caso de fallo de líneas, revierte la cabecera (rollback manual).
 * No debe     : usar createSupabaseRouteClient ni supabase.from directamente.
 *               Gestionar autenticación ni construir respuestas HTTP.
 *
 * ADVERTENCIA DE TRANSACCIONALIDAD:
 *   La inserción de cabecera y líneas se realiza en dos operaciones separadas.
 *   No existe transacción real (BEGIN/COMMIT). Si el INSERT de líneas falla tras
 *   el INSERT de cabecera exitoso, se ejecuta un rollback manual (DELETE cabecera).
 *   El comportamiento es idéntico al código original de createOrderFromDraft.ts.
 *   Pendiente para FASE B: migrar a una RPC transaccional en Postgres.
 */

import { prepareOrderItemsForPersistence } from "@/modules/orders/services/prepareOrderItemsForPersistence";
import {
  insertOrderDraftHeader,
  insertOrderDraftItemRows,
  deleteOrderDraftById,
} from "@/modules/orders/repositories/orderDraftRepository";
import type { OrderDraft, OrderDraftWarning } from "@/modules/orders/types/order.types";
import type {
  InsertOrderHeaderInput,
  InsertOrderItemInput,
  OrdenCompraRow,
  OrdenItemRow,
} from "@/modules/orders/types/orderPersistence.types";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de resultado (exportados para re-uso en createOrderFromDraft.ts y wrapper)
// ─────────────────────────────────────────────────────────────────────────────

export type OrderCreateErrorCode =
  | "ORDER_DRAFT_NOT_READY"
  | "ORDER_HEADER_INSERT_FAILED"
  | "ORDER_ITEMS_INSERT_FAILED";

export type CreateOrderFromDraftResult =
  | {
      ok: true;
      orden: OrdenCompraRow;
      items: OrdenItemRow[];
    }
  | {
      ok: false;
      code: OrderCreateErrorCode;
      message: string;
      /** Populated when code === ORDER_DRAFT_NOT_READY */
      warnings?: OrderDraftWarning[];
    };

// ─────────────────────────────────────────────────────────────────────────────
// Mappers (privados)
// ─────────────────────────────────────────────────────────────────────────────

function mapDraftToHeaderInput(
  draft: OrderDraft,
  createdBy: string | null,
): InsertOrderHeaderInput {
  return {
    estado: draft.estado,
    tipo_envio: draft.tipoEnvio === "amazon_agl" ? "amazon_agl" : "propio",

    fob_puerto: draft.fobPuerto ?? null,
    destino: draft.destino ?? null,

    fecha_orden: draft.fechaOrden,
    eta: draft.eta ?? null,
    etd: draft.etd ?? null,

    lead_time_produccion: draft.leadTimeProduccion ?? null,
    lead_time_transito: draft.leadTimeTransito ?? null,

    cbm_limite: draft.cbmLimite,

    deposito_porcentaje: draft.paymentSchedule.depositPercentage,
    balance_dias_antes_eta: draft.paymentSchedule.balanceDaysBeforeArrival,
    balance_condiciones_texto: draft.paymentSchedule.balanceConditionsText,

    notas: null,
    created_by: createdBy,
  };
}

function mapDraftItemsToInsertInputs(
  draft: OrderDraft,
): Omit<InsertOrderItemInput, "orden_id">[] {
  return draft.items.map((item) => ({
    producto_id: item.productId,
    proveedor_id: item.supplierId ?? null,
    cantidad: item.quantity,
    cbm_unitario: item.cbmPerUnit ?? 0,
    coste_unitario_usd: null,
    coste_unitario_eur: item.unitCostEur ?? null,
    lote_producto: null,
    notas: null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Service público
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persiste un OrderDraft como orden borrador en Supabase.
 *
 * @param draft     - El borrador in-memory producido por createOrderDraftFromGroup.
 * @param createdBy - UUID del usuario autenticado (obtenido por el llamador vía auth).
 * @returns CreateOrderFromDraftResult — unión discriminada ok/error.
 */
export async function createOrderDraftService(
  draft: OrderDraft,
  createdBy: string | null,
): Promise<CreateOrderFromDraftResult> {
  // ── 1. Validación de negocio ─────────────────────────────────────────────
  if (!draft.isReadyToSubmit) {
    return {
      ok: false,
      code: "ORDER_DRAFT_NOT_READY",
      message:
        "El borrador tiene errores bloqueantes que deben resolverse antes de crear el pedido.",
      warnings: draft.warnings,
    };
  }

  // ── 2. Insertar cabecera ─────────────────────────────────────────────────
  const headerInput = mapDraftToHeaderInput(draft, createdBy);
  let orden: OrdenCompraRow;

  try {
    orden = await insertOrderDraftHeader(headerInput);
  } catch (err) {
    return {
      ok: false,
      code: "ORDER_HEADER_INSERT_FAILED",
      message:
        err instanceof Error
          ? err.message
          : "Error al insertar la cabecera del pedido en la base de datos.",
    };
  }

  // ── 3. Preparar e insertar líneas ────────────────────────────────────────
  // (ver advertencia de transaccionalidad en el encabezado del archivo)
  const itemInputs = mapDraftItemsToInsertInputs(draft);
  let items: OrdenItemRow[];

  try {
    const { rows } = await prepareOrderItemsForPersistence(orden.id, itemInputs);
    items = await insertOrderDraftItemRows(rows);
  } catch (err) {
    // ── 3a. Rollback manual — borrar cabecera (CASCADE elimina líneas) ─────
    try {
      await deleteOrderDraftById(orden.id);
    } catch (rollbackErr) {
      // El rollback falló: la cabecera huérfana queda en estado borrador sin
      // líneas. Un administrador puede limpiarla desde el dashboard de Supabase.
      console.error(
        `[createOrderDraftService] Rollback failed for orderId=${orden.id}:`,
        rollbackErr instanceof Error ? rollbackErr.message : rollbackErr,
      );
    }

    return {
      ok: false,
      code: "ORDER_ITEMS_INSERT_FAILED",
      message:
        err instanceof Error
          ? err.message
          : "Error al insertar las líneas del pedido. Se ha revertido la cabecera.",
    };
  }

  // ── 4. Devolver orden persistida ─────────────────────────────────────────
  // Nota: el objeto `orden` refleja el estado previo a los triggers (cbm_total,
  // coste_total_eur, coste_total_usd, fecha_pago_balance se calculan tras
  // insertar las líneas). Si el llamador necesita los valores finales debe
  // hacer fetchOrderAfterDraftUpdate(orden.id).
  return { ok: true, orden, items };
}
