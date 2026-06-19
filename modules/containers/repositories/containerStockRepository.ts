import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type {
  ContainerRowForStock,
  ContenedorStockDestinoRow,
  OrdenItemForContainerRow,
  StockCanal,
} from "../types/containerStock.types";

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchContainerForStock(
  contenedorId: string,
): Promise<ContainerRowForStock | null> {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("contenedores")
    .select(
      `id, identificador_embarque, estado, tipo_contenedor,
       costo_flete_total_eur, gastos_llegada_puerto_eur, costo_transito_total_eur, comision_bancaria_eur,
       flete, gastos_llegada_puerto`,
    )
    .eq("id", contenedorId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    identificador_embarque: String(row.identificador_embarque ?? ""),
    estado: String(row.estado ?? ""),
    tipo_contenedor: row.tipo_contenedor != null ? String(row.tipo_contenedor) : null,
    costo_flete_total_eur:
      row.costo_flete_total_eur != null ? asNumber(row.costo_flete_total_eur) : null,
    gastos_llegada_puerto_eur:
      row.gastos_llegada_puerto_eur != null ? asNumber(row.gastos_llegada_puerto_eur) : null,
    costo_transito_total_eur:
      row.costo_transito_total_eur != null ? asNumber(row.costo_transito_total_eur) : null,
    comision_bancaria_eur:
      row.comision_bancaria_eur != null ? asNumber(row.comision_bancaria_eur) : null,
    flete: row.flete != null ? asNumber(row.flete) : null,
    gastos_llegada_puerto:
      row.gastos_llegada_puerto != null ? asNumber(row.gastos_llegada_puerto) : null,
  };
}

export async function fetchOrderItemIdsForContainer(
  contenedorId: string,
): Promise<string[]> {
  const supabase = createSupabaseRouteClient();

  const { data: links, error: linkError } = await supabase
    .from("contenedor_ordenes")
    .select("orden_id")
    .eq("contenedor_id", contenedorId);

  if (linkError) throw new Error(linkError.message);

  const ordenIds = (links ?? []).map((l) => String((l as { orden_id: string }).orden_id));
  if (ordenIds.length === 0) return [];

  const { data: items, error: itemError } = await supabase
    .from("orden_items")
    .select("id")
    .in("orden_id", ordenIds);

  if (itemError) throw new Error(itemError.message);
  return (items ?? []).map((i) => String((i as { id: string }).id));
}

export async function fetchOrderItemsForContainer(
  contenedorId: string,
): Promise<OrdenItemForContainerRow[]> {
  const supabase = createSupabaseRouteClient();

  const { data: links, error: linkError } = await supabase
    .from("contenedor_ordenes")
    .select("orden_id")
    .eq("contenedor_id", contenedorId);

  if (linkError) throw new Error(linkError.message);

  const ordenIds = (links ?? []).map((l) => String((l as { orden_id: string }).orden_id));
  if (ordenIds.length === 0) return [];

  const { data: items, error: itemError } = await supabase
    .from("orden_items")
    .select(
      "id, orden_id, producto_id, cantidad, cbm_unitario, cbm_total, coste_unitario_eur, lote_producto",
    )
    .in("orden_id", ordenIds);

  if (itemError) throw new Error(itemError.message);

  return (items ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      id: String(row.id),
      orden_id: String(row.orden_id),
      producto_id: String(row.producto_id),
      cantidad: asNumber(row.cantidad),
      cbm_unitario: row.cbm_unitario != null ? asNumber(row.cbm_unitario) : null,
      cbm_total: row.cbm_total != null ? asNumber(row.cbm_total) : null,
      coste_unitario_eur:
        row.coste_unitario_eur != null ? asNumber(row.coste_unitario_eur) : null,
      lote_producto: row.lote_producto != null ? String(row.lote_producto) : null,
    };
  });
}

export async function fetchStockDestinosForContainer(
  contenedorId: string,
): Promise<ContenedorStockDestinoRow[]> {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("contenedor_stock_destinos")
    .select("*")
    .eq("contenedor_id", contenedorId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      id: String(row.id),
      contenedor_id: String(row.contenedor_id),
      orden_item_id: String(row.orden_item_id),
      producto_id: String(row.producto_id),
      pais: String(row.pais),
      canal: String(row.canal) as StockCanal,
      marketplace_id: row.marketplace_id != null ? String(row.marketplace_id) : null,
      cantidad: asNumber(row.cantidad),
      notas: row.notas != null ? String(row.notas) : null,
    };
  });
}

export async function countActiveStockApplied(contenedorId: string): Promise<number> {
  const supabase = createSupabaseRouteClient();
  const { count, error } = await supabase
    .from("contenedor_stock_aplicado")
    .select("id", { count: "exact", head: true })
    .eq("contenedor_id", contenedorId)
    .is("revertido_at", null);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function countStockDestinos(contenedorId: string): Promise<number> {
  const supabase = createSupabaseRouteClient();
  const { count, error } = await supabase
    .from("contenedor_stock_destinos")
    .select("id", { count: "exact", head: true })
    .eq("contenedor_id", contenedorId);

  if (error) {
    if (error.message.includes("contenedor_stock_destinos")) return 0;
    throw new Error(error.message);
  }
  return count ?? 0;
}

export async function countProductoCostosForContainer(
  contenedorId: string,
): Promise<number> {
  const supabase = createSupabaseRouteClient();
  const { count, error } = await supabase
    .from("producto_costos")
    .select("id", { count: "exact", head: true })
    .eq("contenedor_id", contenedorId)
    .not("costo_unitario_total_eur", "is", null);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchAmazonEnviosForContainer(contenedorId: string) {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("amazon_envios")
    .select(
      "id, shipment_id, sku, producto_id, cantidad_enviada, cantidad_recibida, destination_country, estado",
    )
    .eq("contenedor_id", contenedorId);

  if (error) {
    if (error.message.includes("amazon_envios")) return [];
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function insertStockAplicadoRows(
  rows: Array<{
    contenedor_id: string;
    orden_item_id: string;
    producto_id: string;
    pais: string;
    canal: StockCanal;
    cantidad: number;
    fuente: string;
    aplicado_by?: string | null;
    notas?: string | null;
  }>,
) {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("contenedor_stock_aplicado")
    .insert(rows)
    .select("id");

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function callFnStockAdd(input: {
  productoId: string;
  pais: string;
  canal: StockCanal;
  cantidad: number;
}): Promise<void> {
  const supabase = createSupabaseRouteClient();
  const { error } = await supabase.rpc("fn_stock_add", {
    p_producto_id: input.productoId,
    p_pais: input.pais,
    p_canal: input.canal,
    p_cantidad: input.cantidad,
  });

  if (error) throw new Error(error.message);
}
