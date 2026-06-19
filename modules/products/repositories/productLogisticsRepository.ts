// modules/products/repositories/productLogisticsRepository.ts

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

/** Columnas escribibles en producto_logistica (excluye cubicaje_unitario_m3 GENERATED). */
export const LOGISTICS_WRITABLE_COLUMNS = [
  "unidades_por_caja",
  "peso_kg_bruto",
  "ean_upc",
  "pedido_minimo_unidades",
  "largo_cm",
  "ancho_cm",
  "alto_cm",
] as const;

function buildWritableLogisticsPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const key of LOGISTICS_WRITABLE_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      clean[key] = payload[key];
    }
  }
  return clean;
}

// Tabla: producto_logistica.
// cubicaje_unitario_m3 es GENERATED — solo lectura desde la app.
export async function findProductLogisticsByProductId(productId: string) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("producto_logistica")
    .select(`
      id,
      producto_id,
      unidades_por_caja,
      peso_kg_bruto,
      ean_upc,
      pedido_minimo_unidades,
      largo_cm,
      ancho_cm,
      alto_cm,
      cubicaje_unitario_m3,
      created_at
    `)
    .eq("producto_id", productId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data;
}

/** CBM unitario por producto_id (lectura; valor GENERATED en BD). Variantes: fallback al padre. */
export async function getCubicajeUnitarioByProductIds(
  productIds: string[],
): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  if (productIds.length === 0) return map;

  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("producto_logistica")
    .select("producto_id, cubicaje_unitario_m3")
    .in("producto_id", productIds);

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const pid = row.producto_id as string;
    const raw = row.cubicaje_unitario_m3;
    map.set(pid, raw != null ? Number(raw) : null);
  }

  const needsParentFallback = productIds.filter((pid) => {
    const v = map.get(pid);
    return v == null || v <= 0;
  });

  if (needsParentFallback.length === 0) return map;

  const { data: productos, error: prodError } = await supabase
    .from("productos")
    .select("id, parent_id")
    .in("id", needsParentFallback);

  if (prodError) throw new Error(prodError.message);

  const parentIds = Array.from(
    new Set(
      (productos ?? [])
        .map((p) => p.parent_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  if (parentIds.length === 0) return map;

  const parentCbm = await getCubicajeUnitarioByProductIds(parentIds);

  for (const p of productos ?? []) {
    const childId = p.id as string;
    const parentId = p.parent_id as string | null;
    if (!parentId) continue;
    const current = map.get(childId);
    if (current != null && current > 0) continue;
    const fromParent = parentCbm.get(parentId);
    if (fromParent != null && fromParent > 0) {
      map.set(childId, fromParent);
    }
  }

  return map;
}

/**
 * Crea o actualiza logística por producto_id.
 * UPDATE explícito si la fila existe (filas parciales previas); INSERT si no.
 * Nunca escribe cubicaje_unitario_m3.
 */
export async function upsertProductLogistics(
  productId: string,
  payload: Record<string, unknown>,
) {
  const supabase = createSupabaseRouteClient();
  const writablePayload = buildWritableLogisticsPayload(payload);

  const existing = await findProductLogisticsByProductId(productId);

  if (existing) {
    const { data, error } = await supabase
      .from("producto_logistica")
      .update(writablePayload)
      .eq("producto_id", productId)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await supabase
    .from("producto_logistica")
    .insert({
      producto_id: productId,
      ...writablePayload,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  return data;
}
