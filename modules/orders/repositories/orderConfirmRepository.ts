/**
 * Módulo      : orders
 * Archivo     : repositories/orderConfirmRepository.ts
 * Responsabilidad: operaciones CRUD de Supabase sobre ordenes_compra y orden_items
 *                  usadas exclusivamente durante la confirmación de una orden.
 * No debe     : contener lógica de negocio, defaults de pago ni preparar payloads.
 */

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { OrdenCompraRow } from "@/modules/orders/types/orderPersistence.types";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos internos del repository
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Patch de costes ya normalizado para una línea de orden.
 * El service es responsable de convertir "" → null antes de llamar aquí.
 */
export type NormalizedItemCostPatch = {
  item_id: string;
  coste_unitario_moneda: number | null;
  coste_unitario_usd: number | null;
  coste_unitario_eur: number | null;
  lote_producto?: string | null;
};

export type ConfirmedOrderItemCostRow = {
  id: string;
  orden_id: string;
  producto_id: string;
  coste_unitario_moneda: number | null;
};

/**
 * Payload de confirmación de cabecera ya construido por el service.
 * Incluye todos los campos que deben persistirse en ordenes_compra al confirmar.
 */
export type ConfirmOrderHeaderPayload = {
  estado: "confirmado";
  fecha_confirmacion: string;
  eta: string;
  etd: string | null;
  eta_real: string | null;
  lead_time_produccion: number | null;
  lead_time_transito: number | null;
  numero_pedido_agente: string | null;
  agente_id: string | null;
  moneda_compra: string | null;
  tipo_cambio_moneda_eur: number | null;
  tipo_cambio_usd_eur: number | null;
  deposito_porcentaje: number;
  balance_dias_antes_eta: number;
  balance_condiciones_texto: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// CRUD puro
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Actualiza costes y lote de las líneas de una orden antes de confirmarla.
 * Cada patch se aplica a la línea identificada por item_id + orden_id.
 * Throws on Supabase error.
 */
export async function updateOrderItemCostsForConfirmation(
  orderId: string,
  patches: NormalizedItemCostPatch[],
): Promise<ConfirmedOrderItemCostRow[]> {
  if (patches.length === 0) return [];

  const supabase = createSupabaseRouteClient();
  const updatedRows: ConfirmedOrderItemCostRow[] = [];

  for (const patch of patches) {
    const row: Record<string, unknown> = {
      coste_unitario_moneda: patch.coste_unitario_moneda,
      coste_unitario_usd: patch.coste_unitario_usd,
      coste_unitario_eur: patch.coste_unitario_eur,
    };

    if (patch.lote_producto !== undefined) {
      row.lote_producto = patch.lote_producto;
    }

    const { data, error } = await supabase
      .from("orden_items")
      .update(row)
      .eq("id", patch.item_id)
      .eq("orden_id", orderId)
      .select("id, orden_id, producto_id, coste_unitario_moneda")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      throw new Error(
        `No se pudo actualizar la linea ${patch.item_id}: no pertenece a la orden ${orderId}.`,
      );
    }
    updatedRows.push(data as ConfirmedOrderItemCostRow);
  }

  return updatedRows;
}

export async function fetchOrderHeaderForConfirmation(
  orderId: string,
): Promise<OrdenCompraRow | null> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("ordenes_compra")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as OrdenCompraRow | null) ?? null;
}

/**
 * Confirma la cabecera de la orden: cambia estado borrador → confirmado y
 * persiste todos los campos logísticos/comerciales/pago.
 *
 * El filtro .eq("estado", "borrador") garantiza que una orden ya confirmada
 * no se sobreescriba accidentalmente.
 *
 * Throws on Supabase error, or if no row matched (order not found or not draft).
 */
export async function confirmOrderHeader(
  orderId: string,
  payload: ConfirmOrderHeaderPayload,
): Promise<OrdenCompraRow> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("ordenes_compra")
    .update(payload)
    .eq("id", orderId)
    .eq("estado", "borrador")   // garantía: solo confirma borradores
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      error?.message ?? "No se pudo confirmar la orden (¿ya estaba confirmada?)",
    );
  }

  return data as OrdenCompraRow;
}
