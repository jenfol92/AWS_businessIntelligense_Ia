import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export type LatestFactoryCost = {
  producto_id: string;
  costo_fabrica_monto: number | null;
  costo_fabrica_moneda: string | null;
  tipo_cambio_aplicado: number | null;
  costo_fabrica_eur: number | null;
  fecha: string | null;
  contenedor_id: string | null;
};

export type ProductSupplierCostRef = {
  producto_id: string;
  proveedor_id: string | null;
};

const CONFIRMED_ORDER_STATES = ["confirmado", "recibido"];

function normalizeRow(row: Record<string, unknown>): LatestFactoryCost {
  const monto = row.costo_fabrica_monto;
  return {
    producto_id: String(row.producto_id),
    costo_fabrica_monto:
      monto != null && Number(monto) > 0 ? Number(monto) : null,
    costo_fabrica_moneda: row.costo_fabrica_moneda
      ? String(row.costo_fabrica_moneda).toUpperCase()
      : null,
    tipo_cambio_aplicado:
      row.tipo_cambio_aplicado != null && Number.isFinite(Number(row.tipo_cambio_aplicado))
        ? Number(row.tipo_cambio_aplicado)
        : null,
    costo_fabrica_eur:
      row.costo_fabrica_eur != null && Number(row.costo_fabrica_eur) > 0
        ? Number(row.costo_fabrica_eur)
        : null,
    fecha: row.fecha ? String(row.fecha).slice(0, 10) : null,
    contenedor_id: row.contenedor_id ? String(row.contenedor_id) : null,
  };
}

/**
 * Último coste de fábrica por producto desde producto_costos (fecha desc).
 */
export async function getLatestFactoryCostByProductIds(
  productIds: string[],
  supabase: SupabaseClient = createSupabaseRouteClient(),
): Promise<Map<string, LatestFactoryCost>> {
  const map = new Map<string, LatestFactoryCost>();
  if (productIds.length === 0) return map;

  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));

  const { data, error } = await supabase
    .from("producto_costos")
    .select(
      "producto_id, costo_fabrica_monto, costo_fabrica_moneda, tipo_cambio_aplicado, costo_fabrica_eur, fecha, contenedor_id",
    )
    .in("producto_id", uniqueIds)
    .order("fecha", { ascending: false });

  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const pid = String(row.producto_id);
    if (map.has(pid)) continue;
    map.set(pid, normalizeRow(row));
  }

  return map;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function positiveNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function normalizeConfirmedOrderItemCost(
  row: Record<string, unknown>,
): LatestFactoryCost | null {
  const order = firstRelation(
    row.ordenes_compra as Record<string, unknown> | Record<string, unknown>[] | null | undefined,
  );
  if (!order) return null;

  const moneda = order.moneda_compra
    ? String(order.moneda_compra).toUpperCase()
    : null;
  const monto =
    positiveNumberOrNull(row.coste_unitario_moneda)
    ?? (moneda === "USD" ? positiveNumberOrNull(row.coste_unitario_usd) : null)
    ?? (moneda === "EUR" ? positiveNumberOrNull(row.coste_unitario_eur) : null);

  if (!monto) return null;

  return {
    producto_id: String(row.producto_id),
    costo_fabrica_monto: monto,
    costo_fabrica_moneda: moneda,
    tipo_cambio_aplicado: null,
    costo_fabrica_eur: positiveNumberOrNull(row.coste_unitario_eur),
    fecha:
      (order.fecha_confirmacion ? String(order.fecha_confirmacion).slice(0, 10) : null)
      ?? (order.created_at ? String(order.created_at).slice(0, 10) : null),
    contenedor_id: null,
  };
}

/**
 * Ultimo coste de fabrica confirmado desde orden_items.
 * Prioridad: producto + proveedor, despues producto.
 */
export async function getLatestConfirmedFactoryCostByProductRefs(
  refs: ProductSupplierCostRef[],
  supabase: SupabaseClient = createSupabaseRouteClient(),
  currency?: string | null,
): Promise<Map<string, LatestFactoryCost>> {
  const result = new Map<string, LatestFactoryCost>();
  if (refs.length === 0) return result;

  const uniqueRefs = Array.from(
    new Map(
      refs
        .filter((ref) => Boolean(ref.producto_id))
        .map((ref) => [
          `${ref.producto_id}:${ref.proveedor_id ?? ""}`,
          {
            producto_id: ref.producto_id,
            proveedor_id: ref.proveedor_id ?? null,
          },
        ]),
    ).values(),
  );
  const productIds = Array.from(new Set(uniqueRefs.map((ref) => ref.producto_id)));
  if (productIds.length === 0) return result;
  const normalizedCurrency = currency?.trim().toUpperCase() || null;

  const snapshotQuery = supabase
    .from("order_confirmed_cost_snapshots")
    .select(
      "producto_id, proveedor_id, moneda_original, coste_unitario_original, tipo_cambio_moneda_eur, coste_unitario_eur, snapshot_date",
    )
    .in("producto_id", productIds)
    .order("snapshot_date", { ascending: false })
    .order("created_at", { ascending: false });

  const { data: snapshotRows, error: snapshotError } = normalizedCurrency
    ? await snapshotQuery.eq("moneda_original", normalizedCurrency)
    : await snapshotQuery;

  if (!snapshotError) {
    const byProductSupplier = new Map<string, LatestFactoryCost>();
    const byProduct = new Map<string, LatestFactoryCost>();

    for (const row of (snapshotRows ?? []) as Record<string, unknown>[]) {
      const productId = String(row.producto_id);
      const supplierId = row.proveedor_id ? String(row.proveedor_id) : null;
      const cost: LatestFactoryCost = {
        producto_id: productId,
        costo_fabrica_monto: positiveNumberOrNull(row.coste_unitario_original),
        costo_fabrica_moneda: row.moneda_original ? String(row.moneda_original).toUpperCase() : null,
        tipo_cambio_aplicado:
          row.tipo_cambio_moneda_eur != null && Number.isFinite(Number(row.tipo_cambio_moneda_eur))
            ? Number(row.tipo_cambio_moneda_eur)
            : null,
        costo_fabrica_eur: positiveNumberOrNull(row.coste_unitario_eur),
        fecha: row.snapshot_date ? String(row.snapshot_date).slice(0, 10) : null,
        contenedor_id: null,
      };
      if (!cost.costo_fabrica_monto) continue;
      if (!byProduct.has(productId)) byProduct.set(productId, cost);
      if (supplierId) {
        const key = `${productId}:${supplierId}`;
        if (!byProductSupplier.has(key)) byProductSupplier.set(key, cost);
      }
    }

    for (const ref of uniqueRefs) {
      const supplierKey = `${ref.producto_id}:${ref.proveedor_id ?? ""}`;
      const cost =
        (ref.proveedor_id ? byProductSupplier.get(supplierKey) : null)
        ?? byProduct.get(ref.producto_id)
        ?? null;
      if (cost) result.set(supplierKey, cost);
    }

    if (result.size === uniqueRefs.length) return result;
  }

  const { data, error } = await supabase
    .from("orden_items")
    .select(
      "producto_id, proveedor_id, coste_unitario_moneda, coste_unitario_usd, coste_unitario_eur, created_at, ordenes_compra!inner(estado, moneda_compra, fecha_confirmacion, created_at)",
    )
    .in("producto_id", productIds)
    .in("ordenes_compra.estado", CONFIRMED_ORDER_STATES)
    .order("fecha_confirmacion", { ascending: false, foreignTable: "ordenes_compra" })
    .order("created_at", { ascending: false, foreignTable: "ordenes_compra" })
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const byProductSupplier = new Map<string, LatestFactoryCost>();
  const byProduct = new Map<string, LatestFactoryCost>();

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const productId = String(row.producto_id);
    const supplierId = row.proveedor_id ? String(row.proveedor_id) : null;
    const cost = normalizeConfirmedOrderItemCost(row);
    if (!cost) continue;
    if (normalizedCurrency && cost.costo_fabrica_moneda !== normalizedCurrency) continue;

    if (!byProduct.has(productId)) byProduct.set(productId, cost);
    if (supplierId) {
      const key = `${productId}:${supplierId}`;
      if (!byProductSupplier.has(key)) byProductSupplier.set(key, cost);
    }
  }

  for (const ref of uniqueRefs) {
    const supplierKey = `${ref.producto_id}:${ref.proveedor_id ?? ""}`;
    const cost =
      (ref.proveedor_id ? byProductSupplier.get(supplierKey) : null)
      ?? byProduct.get(ref.producto_id)
      ?? null;
    if (cost) result.set(supplierKey, cost);
  }

  return result;
}
