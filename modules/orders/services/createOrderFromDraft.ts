/**
 * Fase 1 — Persists an OrderDraft as a real borrador order in Supabase.
 *
 * Flow:
 *   OrderDraft (in-memory)
 *     → validate isReadyToSubmit
 *     → map to DB payload
 *     → insertOrderHeader  → orderId
 *     → insertOrderItems   → if fails, rollback (deleteOrderById)
 *     → return { ok, orden, items }
 *
 * Transaction strategy:
 *   Supabase JS client does not expose BEGIN/COMMIT/ROLLBACK via PostgREST.
 *   We implement manual rollback: if item insertion fails after a successful
 *   header insert, we delete the header (ON DELETE CASCADE removes any items).
 *
 * Triggers handled by DB (do NOT set these fields):
 *   ordenes_compra : numero_orden, cbm_total, coste_total_usd, coste_total_eur,
 *                    fecha_pago_balance, updated_at
 *   orden_items    : cbm_total (GENERATED ALWAYS AS cantidad*cbm_unitario STORED)
 */

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { OrderDraft, OrderDraftWarning } from "../types/order.types";
import {
  deleteOrderById,
  insertOrderHeader,
  insertOrderItems,
  type InsertOrderHeaderInput,
  type InsertOrderItemInput,
  type OrdenCompraRow,
  type OrdenItemRow,
} from "../repositories/ordersRepository";

// ─────────────────────────────────────────────────────────────────────────────
// Error codes
// ─────────────────────────────────────────────────────────────────────────────

export type OrderCreateErrorCode =
  | "ORDER_DRAFT_NOT_READY"
  | "ORDER_HEADER_INSERT_FAILED"
  | "ORDER_ITEMS_INSERT_FAILED";

// ─────────────────────────────────────────────────────────────────────────────
// Result type (discriminated union)
// ─────────────────────────────────────────────────────────────────────────────

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
// Mapper: OrderDraft → InsertOrderHeaderInput
// ─────────────────────────────────────────────────────────────────────────────

function mapDraftToHeaderInput(
  draft: OrderDraft,
  createdBy: string | null,
): InsertOrderHeaderInput {
  return {
    estado: draft.estado,

    // Ports
    fob_puerto: draft.fobPuerto ?? null,
    destino: draft.destino ?? null,

    // Dates — only insert what we know; trigger fills fecha_pago_balance
    fecha_orden: draft.fechaOrden,
    eta: draft.eta ?? null,
    etd: draft.etd ?? null,

    // Lead times — null at draft stage; filled on confirmation
    lead_time_produccion: draft.leadTimeProduccion ?? null,
    lead_time_transito: draft.leadTimeTransito ?? null,

    // Volume limit — triggers will compute cbm_total after items are inserted
    cbm_limite: draft.cbmLimite,

    // Payment terms — trigger computes fecha_pago_balance from eta + balance_dias_antes_eta
    deposito_porcentaje: draft.paymentSchedule.depositPercentage,
    balance_dias_antes_eta: draft.paymentSchedule.balanceDaysBeforeArrival,
    balance_condiciones_texto: draft.paymentSchedule.balanceConditionsText,

    // Misc
    notas: null,
    created_by: createdBy,

    // Fields intentionally NOT inserted:
    //   numero_orden       — trigger gen_numero_orden
    //   cbm_total          — trigger recalc_orden_totales (after items)
    //   coste_total_usd    — trigger recalc_orden_totales
    //   coste_total_eur    — trigger recalc_orden_totales
    //   fecha_pago_balance — trigger calcular_fecha_pago_balance
    //   fecha_confirmacion — set on confirmOrden (Fase 2)
    //   eta_real           — set on confirmOrden or logistics update
    //   numero_pedido_agente — set on confirmOrden
    //   tipo_cambio_usd_eur  — set on confirmOrden
    //   proforma_firmada_url — set on uploadProforma (Fase 2)
    //   proforma_firmada_at  — set on uploadProforma

    // TODO: Insert these fields when confirmed to exist in the DB schema:
    //   recommendedOrderDate → fecha_recomendada_pedido (column not yet in schema)
    //   sourcePlanGroupKey   → source_plan_group_key   (column not yet in schema)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapper: OrderDraftItem[] → InsertOrderItemInput[]
// ─────────────────────────────────────────────────────────────────────────────

function mapDraftItemsToInsertInputs(
  draft: OrderDraft,
): Omit<InsertOrderItemInput, "orden_id">[] {
  return draft.items.map((item) => ({
    producto_id: item.productId,
    proveedor_id: item.supplierId ?? null,
    cantidad: item.quantity,

    // cbm_unitario is needed so the GENERATED cbm_total column computes correctly.
    // When null, Postgres defaults it to 0, which is acceptable for draft stage.
    cbm_unitario: item.cbmPerUnit ?? 0,

    coste_unitario_usd: null,           // USD cost unknown at draft stage
    coste_unitario_eur: item.unitCostEur ?? null,

    lote_producto: null,                // assigned later when order is confirmed

    notas: null,

    // Fields intentionally NOT inserted:
    //   cbm_total  — GENERATED ALWAYS AS (cantidad * cbm_unitario) STORED
    //                Postgres throws "cannot insert into a generated column"
    //   id         — generated by gen_random_uuid()
    //   created_at — default now()
    //   orden_id   — injected by insertOrderItems()
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Public service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persists an OrderDraft as a borrador order in Supabase.
 *
 * @param draft - The in-memory OrderDraft produced by createOrderDraftFromGroup.
 * @returns CreateOrderFromDraftResult — discriminated union ok/error.
 *
 * Business rules enforced:
 *   1. draft.isReadyToSubmit must be true (no blocking warnings).
 *   2. Header is inserted first; on failure returns ORDER_HEADER_INSERT_FAILED.
 *   3. Items are inserted after; on failure the header is rolled back.
 *   4. created_by is set from the authenticated Supabase session.
 */
export async function createOrderFromDraft(
  draft: OrderDraft,
): Promise<CreateOrderFromDraftResult> {
  // ── 1. Business validation ──────────────────────────────────────────────
  if (!draft.isReadyToSubmit) {
    return {
      ok: false,
      code: "ORDER_DRAFT_NOT_READY",
      message:
        "El borrador tiene errores bloqueantes que deben resolverse antes de crear el pedido.",
      warnings: draft.warnings,
    };
  }

  // ── 2. Resolve current user (for created_by) ────────────────────────────
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const createdBy = user?.id ?? null;

  // ── 3. Insert order header ───────────────────────────────────────────────
  const headerInput = mapDraftToHeaderInput(draft, createdBy);
  let orden: OrdenCompraRow;

  try {
    orden = await insertOrderHeader(headerInput);
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

  // ── 4. Insert order items ────────────────────────────────────────────────
  const itemInputs = mapDraftItemsToInsertInputs(draft);
  let items: OrdenItemRow[];

  try {
    const inserted = await insertOrderItems(orden.id, itemInputs);
    items = inserted.rows;
  } catch (err) {
    // ── 4a. Manual rollback — delete header (CASCADE removes items) ───────
    try {
      await deleteOrderById(orden.id);
    } catch (rollbackErr) {
      // Rollback itself failed — log but still return the original error.
      // The orphaned header (without items) will have estado='borrador'
      // and zero totals. An admin can clean it up via Supabase dashboard.
      console.error(
        `[createOrderFromDraft] Rollback failed for orderId=${orden.id}:`,
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

  // ── 5. Return persisted order ────────────────────────────────────────────
  // Note: at this point DB triggers have already recalculated:
  //   ordenes_compra.cbm_total, coste_total_eur, coste_total_usd,
  //   ordenes_compra.fecha_pago_balance
  // The `orden` object returned here reflects the state BEFORE those triggers
  // ran (it was returned by the header INSERT, not a subsequent SELECT).
  // If the caller needs the final computed values, they should call getOrderById(orden.id).
  return {
    ok: true,
    orden,
    items,
  };
}
