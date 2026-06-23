import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type {
  OrderLeadTimeHistoricalRow,
  OrderLeadTimeSupplierRow,
} from "@/modules/orders/types/orderLeadTimeSuggestion.types";

const CONFIRMED_ORDER_STATES = ["confirmado", "recibido"];

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function pickRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function mapHistoricalRow(raw: Record<string, unknown>): OrderLeadTimeHistoricalRow | null {
  const order = pickRelation(
    raw.ordenes_compra as Record<string, unknown> | Record<string, unknown>[] | null | undefined,
  );
  if (!order) return null;

  return {
    orden_id: String(order.id),
    producto_id: String(raw.producto_id),
    proveedor_id: (raw.proveedor_id as string | null) ?? null,
    lead_time_produccion: toNumberOrNull(order.lead_time_produccion),
    lead_time_transito: toNumberOrNull(order.lead_time_transito),
    fecha_confirmacion: (order.fecha_confirmacion as string | null) ?? null,
    created_at: (order.created_at as string | null) ?? null,
  };
}

export async function fetchLatestLeadTimeByProductAndSupplier(
  productoId: string,
  proveedorId: string,
): Promise<OrderLeadTimeHistoricalRow | null> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("orden_items")
    .select(
      "producto_id, proveedor_id, ordenes_compra!inner(id, estado, lead_time_produccion, lead_time_transito, fecha_confirmacion, created_at)",
    )
    .eq("producto_id", productoId)
    .eq("proveedor_id", proveedorId)
    .in("ordenes_compra.estado", CONFIRMED_ORDER_STATES)
    .order("fecha_confirmacion", { ascending: false, foreignTable: "ordenes_compra" })
    .order("created_at", { ascending: false, foreignTable: "ordenes_compra" })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapHistoricalRow(data as unknown as Record<string, unknown>) : null;
}

export async function fetchLatestLeadTimeByProduct(
  productoId: string,
): Promise<OrderLeadTimeHistoricalRow | null> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("orden_items")
    .select(
      "producto_id, proveedor_id, ordenes_compra!inner(id, estado, lead_time_produccion, lead_time_transito, fecha_confirmacion, created_at)",
    )
    .eq("producto_id", productoId)
    .in("ordenes_compra.estado", CONFIRMED_ORDER_STATES)
    .order("fecha_confirmacion", { ascending: false, foreignTable: "ordenes_compra" })
    .order("created_at", { ascending: false, foreignTable: "ordenes_compra" })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapHistoricalRow(data as unknown as Record<string, unknown>) : null;
}

export async function fetchSupplierLeadTimes(
  proveedorIds: string[],
): Promise<Map<string, OrderLeadTimeSupplierRow>> {
  const ids = Array.from(new Set(proveedorIds.filter(Boolean)));
  const result = new Map<string, OrderLeadTimeSupplierRow>();
  if (ids.length === 0) return result;

  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("proveedores")
    .select("id, dias_produccion_estandar, dias_transito_estandar")
    .in("id", ids);

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const raw = row as unknown as Record<string, unknown>;
    const id = String(raw.id);
    result.set(id, {
      id,
      dias_produccion_estandar: toNumberOrNull(raw.dias_produccion_estandar),
      dias_transito_estandar: toNumberOrNull(raw.dias_transito_estandar),
    });
  }

  return result;
}
