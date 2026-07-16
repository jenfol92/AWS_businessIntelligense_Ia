import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { OrdenCompraRow } from "@/modules/orders/types/orderPersistence.types";

type SnapshotItemRow = {
  id: string;
  orden_id: string;
  producto_id: string;
  proveedor_id: string | null;
  cantidad: number | null;
  coste_unitario_moneda: number | null;
  coste_unitario_eur: number | null;
  lote_producto: string | null;
};

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function upsertConfirmedOrderCostSnapshots(
  order: Pick<
    OrdenCompraRow,
    "id" | "moneda_compra" | "tipo_cambio_moneda_eur" | "tipo_cambio_usd_eur" | "fecha_confirmacion"
  >,
): Promise<void> {
  const supabase = createSupabaseRouteClient();
  const { data: items, error: itemsError } = await supabase
    .from("orden_items")
    .select(
      "id, orden_id, producto_id, proveedor_id, cantidad, coste_unitario_moneda, coste_unitario_eur, lote_producto",
    )
    .eq("orden_id", order.id);

  if (itemsError) throw new Error(itemsError.message);

  const orderCurrency = (order.moneda_compra ?? "USD").trim().toUpperCase() || "USD";
  const orderFx =
    orderCurrency === "EUR"
      ? 1
      : asNumber(order.tipo_cambio_moneda_eur) ?? (orderCurrency === "USD" ? asNumber(order.tipo_cambio_usd_eur) : null);
  const snapshotDate = order.fecha_confirmacion?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

  const rows = ((items ?? []) as SnapshotItemRow[]).map((item) => {
    const quantity = asNumber(item.cantidad) ?? 0;
    const currency = orderCurrency;
    const fx = orderFx;
    const unitOriginal = asNumber(item.coste_unitario_moneda);
    const unitEur = asNumber(item.coste_unitario_eur) ?? (unitOriginal != null && fx != null ? unitOriginal * fx : null);
    return {
      orden_id: order.id,
      orden_item_id: item.id,
      producto_id: item.producto_id,
      proveedor_id: item.proveedor_id,
      lote_producto: item.lote_producto,
      moneda_original: currency,
      coste_unitario_original: unitOriginal,
      total_original: unitOriginal != null ? unitOriginal * quantity : null,
      tipo_cambio_moneda_eur: fx,
      coste_unitario_eur: unitEur,
      total_eur: unitEur != null ? unitEur * quantity : null,
      snapshot_date: snapshotDate,
      updated_at: new Date().toISOString(),
    };
  });

  if (rows.length === 0) return;

  const { error } = await supabase
    .from("order_confirmed_cost_snapshots")
    .upsert(rows, { onConflict: "orden_item_id" });

  if (error) throw new Error(error.message);
}
