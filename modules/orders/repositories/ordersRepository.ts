/**
 * Módulo   : orders
 * Archivo  : modules/orders/repositories/ordersRepository.ts
 * Qué hace : Acceso directo a las tablas ordenes_compra y orden_items en Supabase.
 *            Contiene todas las operaciones CRUD sobre pedidos y sus líneas.
 * Responsabilidad : Ejecutar consultas SQL a través del cliente Supabase.
 *                   Mapear los resultados a los tipos definidos en este mismo archivo.
 * No debe          : Contener lógica de negocio, cálculos de fechas/costes ni
 *                   gestionar sesiones de usuario.
 */

/**
 * Repository for ordenes_compra + orden_items tables.
 *
 * DB schema reference:
 *   sql/tables/ordenes_compra.sql
 *   sql/migrations/ordenes_compra_payment_etd_eta.sql  (adds etd, deposito_*, balance_*, proforma_*)
 *   sql/migrations/ordenes_proforma_firmada.sql        (adds proforma_firmada_url/at)
 *   sql/migrations/fase2_lotes_coste_medio.sql         (adds orden_items.lote_producto)
 *
 * IMPORTANT — generated / trigger-managed columns never passed to INSERT:
 *   ordenes_compra : numero_orden, cbm_total*, coste_total_usd*, coste_total_eur*,
 *                    fecha_pago_balance*, created_at, updated_at
 *     (* overwritten by triggers after item insertion — safe to seed but not required)
 *   orden_items    : cbm_total (GENERATED ALWAYS AS cantidad*cbm_unitario STORED)
 *
 * Column rename applied by migration: destino_puerto → destino
 */

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { prepareOrderItemsForPersistence } from "@/modules/orders/services/prepareOrderItemsForPersistence";
import { updateOrderDraftService } from "@/modules/orders/services/updateOrderDraftService";
import type {
  OrderItemCostWarning,
  InsertOrderItemsResult,
  UpdateOrderDraftResult,
  InsertOrderHeaderInput,
  InsertOrderItemInput,
  OrdenCompraRow,
  OrdenItemRow,
  ListOrdersInput,
  OrdenItemWithProducto,
  OrdenWithItems,
  UpdateOrderDraftInput,
  ConfirmOrderInput,
} from "@/modules/orders/types/orderPersistence.types";

// Reexports temporales para mantener compatibilidad con importadores existentes.
export type {
  OrderItemCostWarning,
  InsertOrderItemsResult,
  UpdateOrderDraftResult,
  InsertOrderHeaderInput,
  InsertOrderItemInput,
  OrdenCompraRow,
  OrdenItemRow,
  ListOrdersInput,
  OrdenItemWithProducto,
  OrdenWithItems,
  UpdateOrderDraftInput,
  ConfirmOrderInput,
} from "@/modules/orders/types/orderPersistence.types";

// ─────────────────────────────────────────────────────────────────────────────
// insertOrderHeader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inserts a single row into ordenes_compra.
 * Returns the full row including trigger-generated numero_orden and id.
 * Throws on Supabase error.
 */
export async function insertOrderHeader(
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

// resolveOrderItemsCbmUnitario, resolveOrderItemsCosteUnitario y prepareOrderItemsForPersistence
// viven en modules/orders/services/prepareOrderItemsForPersistence.ts
// y se importan al inicio del archivo para uso en insertOrderItems y updateOrderDraft.

// ─────────────────────────────────────────────────────────────────────────────
// insertOrderItemRows — acceso puro a BD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inserta un array de filas ya preparadas en orden_items y devuelve las filas creadas.
 * No aplica ninguna lógica de negocio; eso es responsabilidad del service.
 * Throws on Supabase error.
 */
async function insertOrderItemRows(
  rows: Record<string, unknown>[],
): Promise<OrdenItemRow[]> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("orden_items")
    .insert(rows)
    .select(
      "id, orden_id, producto_id, proveedor_id, cantidad, cbm_unitario, cbm_total, " +
      "coste_unitario_moneda, coste_unitario_usd, coste_unitario_eur, lote_producto, notas, created_at",
    );

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OrdenItemRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// insertOrderItems
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bulk-inserts all items for a given order.
 * Returns the inserted rows (cbm_total is DB-generated and readable from result).
 *
 * Delega la preparación de líneas (CBM, costes, warnings, sanitización) en
 * prepareOrderItemsForPersistence y el INSERT puro en insertOrderItemRows.
 *
 * El trigger trg_recalc_items actualiza ordenes_compra.cbm_total / coste_total_eur
 * automáticamente tras cada INSERT.
 *
 * Throws on Supabase error.
 */
export async function insertOrderItems(
  orderId: string,
  items: Omit<InsertOrderItemInput, "orden_id">[],
): Promise<InsertOrderItemsResult> {
  if (items.length === 0) return { rows: [], warnings: [] };

  const { rows, warnings } = await prepareOrderItemsForPersistence(orderId, items);
  const insertedRows = await insertOrderItemRows(rows);

  return { rows: insertedRows, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteOrderById (used for rollback)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hard-deletes an order header.
 * orden_items are removed automatically via ON DELETE CASCADE.
 * Used exclusively for rollback when item insertion fails.
 */
export async function deleteOrderById(orderId: string): Promise<void> {
  const supabase = createSupabaseRouteClient();

  const { error } = await supabase
    .from("ordenes_compra")
    .delete()
    .eq("id", orderId);

  if (error) throw new Error(`Rollback failed: ${error.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// getOrderById
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches a single ordenes_compra row by primary key.
 * Returns null when the order does not exist.
 * Throws on Supabase errors other than PGRST116 (row not found).
 */
export async function getOrderById(
  orderId: string,
): Promise<OrdenCompraRow | null> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("ordenes_compra")
    .select("*")
    .eq("id", orderId)
    .single();

  if (error) {
    // PGRST116 = "JSON object requested, multiple (or no) rows returned"
    if (error.code === "PGRST116") return null;
    throw new Error(error.message);
  }

  return data as OrdenCompraRow;
}

// ─────────────────────────────────────────────────────────────────────────────
// listOrders
// ─────────────────────────────────────────────────────────────────────────────

// ListOrdersInput — definido en modules/orders/types/orderPersistence.types.ts

/**
 * Devuelve una lista de órdenes de compra ordenadas por fecha de creación
 * descendente. Los filtros sólo se aplican cuando tienen valor no vacío.
 *
 * La búsqueda por texto (q) cubre numero_orden y numero_pedido_agente directamente.
 * Para búsqueda por SKU/nombre de producto, la capa API resuelve los IDs y los pasa
 * como extraOrderIds, que se incluyen en el OR de la query.
 *
 * @param input - Filtros opcionales de búsqueda.
 * @returns Array de OrdenCompraRow (vacío si no hay resultados).
 * @throws Error con el mensaje de Supabase si la consulta falla.
 */
export async function listOrders(
  input: ListOrdersInput = {},
): Promise<OrdenCompraRow[]> {
  const supabase = createSupabaseRouteClient();

  const { estado, q, puerto, limit = 200, extraOrderIds = [] } = input;

  let query = supabase
    .from("ordenes_compra")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 500));

  // Filtro por estado: sólo se aplica si el valor no es "ALL"
  if (estado && estado !== "ALL") {
    query = query.eq("estado", estado);
  }

  // Filtro parcial por puerto de origen FOB
  if (puerto && puerto.trim()) {
    query = query.ilike("fob_puerto", `%${puerto.trim()}%`);
  }

  // Búsqueda por texto: numero_orden, numero_pedido_agente y/o IDs de órdenes
  // que contienen productos con ese SKU/nombre (resueltos en la capa API).
  if (q && q.trim()) {
    const orParts: string[] = [
      `numero_orden.ilike.%${q.trim()}%`,
      `numero_pedido_agente.ilike.%${q.trim()}%`,
    ];
    if (extraOrderIds.length > 0) {
      orParts.push(`id.in.(${extraOrderIds.join(",")})`);
    }
    query = query.or(orParts.join(","));
  } else if (extraOrderIds.length > 0) {
    // Si q está vacío pero hay extraOrderIds (caso improbable, por robustez)
    query = query.in("id", extraOrderIds);
  }

  const { data, error } = await query;

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as OrdenCompraRow[];
  const agentIds = Array.from(
    new Set(rows.map((row) => row.agente_id).filter((id): id is string => Boolean(id))),
  );

  if (agentIds.length === 0) return rows;

  const { data: agents, error: agentsError } = await supabase
    .from("agentes_compra")
    .select("id, contacto")
    .in("id", agentIds);

  if (agentsError) throw new Error(agentsError.message);

  const agentMap = new Map(
    ((agents ?? []) as Array<{ id: string; contacto: string | null }>).map((agent) => [
      agent.id,
      agent.contacto,
    ]),
  );

  return rows.map((row) => ({
    ...row,
    agente_contacto: row.agente_id ? agentMap.get(row.agente_id) ?? null : null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// getOrderItems
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches all orden_items rows for a given order, ordered by created_at ASC.
 * Returns an empty array when the order has no items.
 */
export async function getOrderItems(orderId: string): Promise<OrdenItemRow[]> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("orden_items")
    .select(
      "id, orden_id, producto_id, proveedor_id, cantidad, cbm_unitario, cbm_total, " +
      "coste_unitario_moneda, coste_unitario_usd, coste_unitario_eur, lote_producto, notas, created_at",
    )
    .eq("orden_id", orderId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []) as unknown as OrdenItemRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// getOrderWithItems
// ─────────────────────────────────────────────────────────────────────────────

// OrdenItemWithProducto y OrdenWithItems — definidos en modules/orders/types/orderPersistence.types.ts

/**
 * Obtiene una orden de compra junto con todas sus líneas, incluyendo el nombre
 * del producto y del proveedor en cada línea (join automático de Supabase).
 *
 * @param orderId - UUID de la orden.
 * @returns OrdenWithItems o null si la orden no existe.
 * @throws Error con el mensaje de Supabase si la consulta falla.
 */
export async function getOrderWithItems(
  orderId: string,
): Promise<OrdenWithItems | null> {
  const supabase = createSupabaseRouteClient();

  const { data: orden, error: ordenError } = await supabase
    .from("ordenes_compra")
    .select("*")
    .eq("id", orderId)
    .single();

  if (ordenError) {
    if (ordenError.code === "PGRST116") return null;
    throw new Error(ordenError.message);
  }

  const { data: items, error: itemsError } = await supabase
    .from("orden_items")
    .select(
      "id, orden_id, producto_id, proveedor_id, cantidad, cbm_unitario, cbm_total, " +
      "coste_unitario_moneda, coste_unitario_usd, coste_unitario_eur, lote_producto, notas, created_at, " +
      "productos(sku, nombre), proveedores(nombre)",
    )
    .eq("orden_id", orderId)
    .order("created_at", { ascending: true });

  if (itemsError) throw new Error(itemsError.message);

  const ordenRow = orden as OrdenCompraRow;
  let agenteContacto: string | null = null;
  if (ordenRow.agente_id) {
    const { data: agente, error: agenteError } = await supabase
      .from("agentes_compra")
      .select("contacto")
      .eq("id", ordenRow.agente_id)
      .maybeSingle();
    if (agenteError) throw new Error(agenteError.message);
    agenteContacto = (agente as { contacto: string | null } | null)?.contacto ?? null;
  }

  return {
    orden: { ...ordenRow, agente_contacto: agenteContacto },
    items: (items ?? []) as unknown as OrdenItemWithProducto[],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// updateOrderDraft
// ─────────────────────────────────────────────────────────────────────────────

// UpdateOrderDraftInput — definido en modules/orders/types/orderPersistence.types.ts
// Lógica de orquestación → modules/orders/services/updateOrderDraftService.ts

/**
 * Wrapper de compatibilidad — delega en updateOrderDraftService.
 * La firma y la respuesta son idénticas a la versión anterior.
 *
 * @param orderId - UUID de la orden a actualizar.
 * @param header  - Campos de cabecera a modificar.
 * @param items   - Nuevas líneas (opcional). Si se omite, las líneas no cambian.
 */
export async function updateOrderDraft(
  orderId: string,
  header: UpdateOrderDraftInput,
  items?: Omit<InsertOrderItemInput, "orden_id">[],
): Promise<UpdateOrderDraftResult> {
  return updateOrderDraftService(orderId, header, items);
}

// ─────────────────────────────────────────────────────────────────────────────
// confirmOrder
// ─────────────────────────────────────────────────────────────────────────────

// ConfirmOrderInput — definido en modules/orders/types/orderPersistence.types.ts

/**
 * Confirma una orden de compra: actualiza los costes por línea, cambia el estado
 * a "confirmado" y registra todos los parámetros logísticos y de pago.
 *
 * Solo actúa sobre órdenes en estado "borrador". Si la orden ya estaba confirmada,
 * el filtro .eq("estado","borrador") devuelve 0 filas → se lanza error de negocio.
 *
 * @param orderId - UUID de la orden a confirmar.
 * @param input   - Datos de confirmación (lead times, ETA, costes, payment terms).
 * @returns La cabecera de la orden ya confirmada.
 * @throws Error de negocio si la orden no existe o no está en borrador.
 */
export async function confirmOrder(
  orderId: string,
  input: ConfirmOrderInput,
): Promise<OrdenCompraRow> {
  const supabase = createSupabaseRouteClient();

  // Actualizar costes individuales de las líneas antes de confirmar
  if (input.items_costes && input.items_costes.length > 0) {
    for (const ic of input.items_costes) {
      const patch: Record<string, unknown> = {
        coste_unitario_moneda: ic.coste_unitario_moneda ?? null,
        coste_unitario_usd: ic.coste_unitario_usd ?? null,
        coste_unitario_eur: ic.coste_unitario_eur ?? null,
      };
      if (ic.lote_producto !== undefined) {
        patch.lote_producto = ic.lote_producto === "" ? null : ic.lote_producto;
      }
      await supabase
        .from("orden_items")
        .update(patch)
        .eq("id", ic.item_id)
        .eq("orden_id", orderId);
    }
  }

  // Transición de estado: borrador → confirmado
  const { data, error } = await supabase
    .from("ordenes_compra")
    .update({
      estado: "confirmado",
      fecha_confirmacion: new Date().toISOString().slice(0, 10),
      eta: input.eta,
      etd: input.etd ?? null,
      eta_real: input.eta_real ?? null,
      lead_time_produccion: input.lead_time_produccion ?? null,
      lead_time_transito: input.lead_time_transito ?? null,
      numero_pedido_agente: input.numero_pedido_agente ?? null,
      agente_id: input.agente_id ?? null,
      moneda_compra: input.moneda_compra ?? null,
      tipo_cambio_moneda_eur: input.tipo_cambio_moneda_eur ?? null,
      tipo_cambio_usd_eur: input.tipo_cambio_usd_eur ?? null,
      deposito_porcentaje: input.deposito_porcentaje ?? 30,
      balance_dias_antes_eta: input.balance_dias_antes_eta ?? 10,
      balance_condiciones_texto:
        input.balance_condiciones_texto ??
        "The balance will be paid 10 days before the vessel arrives at the port",
    })
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
