/**
 * Módulo      : containers
 * Archivo     : repositories/containersRepository.ts
 * Responsabilidad: lectura y escritura directa sobre la tabla `contenedores`
 *                  y `orden_items` en el contexto de detalle de contenedor.
 * No debe     : contener lógica de negocio ni transformaciones de dominio.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Lista de contenedores ────────────────────────────────────────────────────

/**
 * Devuelve todos los contenedores (máx. 200), opcionalmente filtrados por estado.
 * @param estado - Valor de filtro. Si es null/undefined/"ALL" devuelve todos.
 */
export async function fetchContainerListByEstado(
  supabase: SupabaseClient,
  estado?: string | null,
): Promise<Record<string, unknown>[]> {
  let q = supabase
    .from("contenedores")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (estado && estado !== "ALL") q = q.eq("estado", estado);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

// ─── Detalle de contenedor ────────────────────────────────────────────────────

/**
 * Devuelve el contenedor completo por id, o null si no existe.
 */
export async function fetchContainerById(
  supabase: SupabaseClient,
  id: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("contenedores")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as Record<string, unknown>;
}

export type ContainerDetailOrderLink = {
  orden_id: string;
  ordenes_compra: Record<string, unknown> | Record<string, unknown>[] | null;
};

/**
 * Devuelve las órdenes vinculadas a un contenedor con todos los campos necesarios
 * para la vista de detalle (incluye ítems de agente, fechas, costes, proforma).
 */
export async function fetchContainerDetailOrderLinks(
  supabase: SupabaseClient,
  contenedorId: string,
): Promise<ContainerDetailOrderLink[]> {
  const { data, error } = await supabase
    .from("contenedor_ordenes")
    .select(
      `orden_id,
       ordenes_compra(
         id, numero_orden, numero_pedido_agente,
         agente_id, fob_puerto, destino, fecha_orden, eta, etd,
         coste_total_usd, coste_total_eur, cbm_total,
         tipo_cambio_usd_eur, lead_time_produccion, lead_time_transito,
         proforma_firmada_url, proforma_firmada_at,
         agentes_compra(contacto)
       )`,
    )
    .eq("contenedor_id", contenedorId);

  if (error) throw new Error(error.message ?? "Error cargando órdenes del contenedor");
  return (data ?? []) as ContainerDetailOrderLink[];
}

/**
 * Devuelve los ítems de las órdenes indicadas con productos, proveedores y costes.
 */
export async function fetchOrderItemsForOrders(
  supabase: SupabaseClient,
  ordenIds: string[],
): Promise<Record<string, unknown>[]> {
  if (ordenIds.length === 0) return [];

  const { data, error } = await supabase
    .from("orden_items")
    .select(
      `id, orden_id, producto_id, cantidad, cbm_unitario, cbm_total,
       coste_unitario_moneda, coste_unitario_usd, coste_unitario_eur, lote_producto,
       productos(sku, nombre, producto_detalle(imagen_url)),
       proveedores(nombre)`,
    )
    .in("orden_id", ordenIds);

  if (error) throw new Error(error.message ?? "Error cargando ítems de las órdenes");
  return (data ?? []) as Record<string, unknown>[];
}

// ─── Actualización de contenedor ─────────────────────────────────────────────

/**
 * Lee solo los campos de estado y notas necesarios para construir la actualización (PUT).
 */
export async function fetchContainerCurrentState(
  supabase: SupabaseClient,
  id: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await supabase
    .from("contenedores")
    .select("estado, estado_logistico, estado_stock, estado_costes, tipo_contenedor, notas")
    .eq("id", id)
    .single();

  return (data as Record<string, unknown> | null) ?? null;
}

/**
 * Aplica el payload de actualización sobre el contenedor y devuelve la fila actualizada.
 */
export async function updateContainerRecord(
  supabase: SupabaseClient,
  id: string,
  payload: Record<string, unknown>,
): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  const { data, error } = await supabase
    .from("contenedores")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  return {
    data: error ? null : (data as Record<string, unknown>),
    error: error?.message ?? null,
  };
}
