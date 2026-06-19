import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type {
  ContainerRowForBilling,
  OrdenItemForBillingRow,
} from "../types/containerBilling.types";

function asNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function fetchContainerForBilling(
  contenedorId: string,
): Promise<ContainerRowForBilling | null> {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("contenedores")
    .select(
      `id, identificador_embarque, tipo_contenedor, estado, estado_logistico, estado_stock, estado_costes,
       puerto_llegada, costo_flete_total_eur, gastos_llegada_puerto_eur, costo_transito_total_eur,
       comision_bancaria_eur, flete, gastos_llegada_puerto, facturado_at`,
    )
    .eq("id", contenedorId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    identificador_embarque: String(row.identificador_embarque ?? ""),
    tipo_contenedor: row.tipo_contenedor != null ? String(row.tipo_contenedor) : null,
    estado_costes: row.estado_costes != null ? String(row.estado_costes) : null,
    estado_logistico: row.estado_logistico != null ? String(row.estado_logistico) : null,
    estado_stock: row.estado_stock != null ? String(row.estado_stock) : null,
    estado: row.estado != null ? String(row.estado) : null,
    puerto_llegada: row.puerto_llegada != null ? String(row.puerto_llegada) : null,
    costo_flete_total_eur: asNumber(row.costo_flete_total_eur),
    gastos_llegada_puerto_eur: asNumber(row.gastos_llegada_puerto_eur),
    costo_transito_total_eur: asNumber(row.costo_transito_total_eur),
    comision_bancaria_eur: asNumber(row.comision_bancaria_eur),
    flete: asNumber(row.flete),
    gastos_llegada_puerto: asNumber(row.gastos_llegada_puerto),
    facturado_at: row.facturado_at != null ? String(row.facturado_at) : null,
  };
}

export async function fetchOrderItemsForBilling(
  contenedorId: string,
): Promise<OrdenItemForBillingRow[]> {
  const supabase = createSupabaseRouteClient();

  const { data: links, error: linkError } = await supabase
    .from("contenedor_ordenes")
    .select("orden_id")
    .eq("contenedor_id", contenedorId);

  if (linkError) throw new Error(linkError.message);

  const ordenIds = (links ?? []).map((l) =>
    String((l as { orden_id: string }).orden_id),
  );
  if (ordenIds.length === 0) return [];

  const { data: items, error: itemError } = await supabase
    .from("orden_items")
    .select(
      `id, orden_id, producto_id, proveedor_id, cantidad, cbm_unitario, cbm_total,
       coste_unitario_moneda, coste_unitario_eur, lote_producto,
       ordenes_compra(moneda_compra, tipo_cambio_moneda_eur, destino, numero_orden),
       productos(sku, nombre)`,
    )
    .in("orden_id", ordenIds);

  if (itemError) throw new Error(itemError.message);

  return (items ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    const orden = firstRelation(
      row.ordenes_compra as Record<string, unknown> | Record<string, unknown>[] | null,
    );
    const producto = firstRelation(
      row.productos as Record<string, unknown> | Record<string, unknown>[] | null,
    );

    return {
      id: String(row.id),
      orden_id: String(row.orden_id),
      producto_id: String(row.producto_id),
      proveedor_id: row.proveedor_id != null ? String(row.proveedor_id) : null,
      cantidad: Number(row.cantidad ?? 0),
      cbm_unitario: asNumber(row.cbm_unitario),
      cbm_total: asNumber(row.cbm_total),
      coste_unitario_moneda: asNumber(row.coste_unitario_moneda),
      coste_unitario_eur: asNumber(row.coste_unitario_eur),
      lote_producto: row.lote_producto != null ? String(row.lote_producto) : null,
      moneda_compra: orden?.moneda_compra != null ? String(orden.moneda_compra) : null,
      tipo_cambio_moneda_eur: asNumber(orden?.tipo_cambio_moneda_eur),
      destino: orden?.destino != null ? String(orden.destino) : null,
      numero_orden: orden?.numero_orden != null ? String(orden.numero_orden) : null,
      sku: producto?.sku != null ? String(producto.sku) : null,
      nombre: producto?.nombre != null ? String(producto.nombre) : null,
    };
  });
}

export async function fetchExistingProductoCostosForContainer(
  contenedorId: string,
): Promise<Map<string, string>> {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("producto_costos")
    .select("id, producto_id, lote_producto")
    .eq("contenedor_id", contenedorId);

  if (error) throw new Error(error.message);

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const r = row as { id: string; producto_id: string; lote_producto: string | null };
    const key = `${r.producto_id}|${r.lote_producto ?? ""}`;
    map.set(key, String(r.id));
  }
  return map;
}

export async function upsertProductoCostoFromFacturacion(
  existingId: string | undefined,
  payload: Record<string, unknown>,
): Promise<{ id: string; action: "insert" | "update" }> {
  const supabase = createSupabaseRouteClient();

  if (existingId) {
    const { data, error } = await supabase
      .from("producto_costos")
      .update(payload)
      .eq("id", existingId)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: String((data as { id: string }).id), action: "update" };
  }

  const { data, error } = await supabase
    .from("producto_costos")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: String((data as { id: string }).id), action: "insert" };
}

export async function markContainerCostesFacturados(
  contenedorId: string,
  userId: string,
  payload: {
    estado_costes: string;
    estado: string;
    facturado_at: string;
    facturado_by: string;
  },
): Promise<void> {
  const supabase = createSupabaseRouteClient();
  const { error } = await supabase
    .from("contenedores")
    .update({
      ...payload,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq("id", contenedorId);

  if (error) throw new Error(error.message);
}
