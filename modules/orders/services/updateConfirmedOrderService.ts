import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { syncSupplierPaymentsForOrder } from "@/modules/finance/services/syncSupplierPaymentsForOrder";
import { upsertConfirmedOrderCostSnapshots } from "@/modules/orders/repositories/orderConfirmedCostSnapshotRepository";
import type { OrdenCompraRow, UpdateOrderDraftInput } from "@/modules/orders/types/orderPersistence.types";

export type ConfirmedOrderItemPatch = {
  item_id: string;
  cantidad?: number | null;
  coste_unitario_moneda?: number | null;
  coste_unitario_usd?: number | null;
  coste_unitario_eur?: number | null;
  lote_producto?: string | null;
};

export type UpdateConfirmedOrderInput = UpdateOrderDraftInput & {
  items?: ConfirmedOrderItemPatch[];
};

function compactHeader(input: UpdateOrderDraftInput): Record<string, unknown> {
  const allowed: Array<keyof UpdateOrderDraftInput> = [
    "tipo_envio",
    "fob_puerto",
    "destino",
    "fecha_orden",
    "cbm_limite",
    "agente_id",
    "notas",
    "etd",
    "eta",
    "eta_real",
    "lead_time_produccion",
    "lead_time_transito",
    "numero_pedido_agente",
    "moneda_compra",
    "tipo_cambio_moneda_eur",
    "tipo_cambio_usd_eur",
    "deposito_porcentaje",
    "balance_dias_antes_eta",
    "balance_condiciones_texto",
  ];
  const header: Record<string, unknown> = {};
  for (const key of allowed) {
    if (input[key] !== undefined) header[key] = input[key];
  }
  header.updated_at = new Date().toISOString();
  return header;
}

async function reconcileLogisticsAssignmentForTipoEnvio(
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  orderId: string,
  tipoEnvio?: "propio" | "amazon_agl",
): Promise<void> {
  if (!tipoEnvio) return;

  if (tipoEnvio === "amazon_agl") {
    const { error: unlinkError } = await supabase
      .from("contenedor_ordenes")
      .delete()
      .eq("orden_id", orderId);
    if (unlinkError) throw new Error(unlinkError.message);

    const { error } = await supabase
      .from("orden_logistics_assignments")
      .update({ status: "inactive" })
      .eq("orden_id", orderId)
      .eq("assignment_type", "contenedor_propio")
      .eq("status", "active");
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase
    .from("orden_logistics_assignments")
    .update({ status: "inactive" })
    .eq("orden_id", orderId)
    .eq("assignment_type", "amazon_inbound")
    .eq("status", "active");
  if (error) throw new Error(error.message);
}

export async function updateConfirmedOrderService(
  orderId: string,
  input: UpdateConfirmedOrderInput,
): Promise<OrdenCompraRow> {
  const supabase = createSupabaseRouteClient();
  const { items, ...headerInput } = input;

  const header = compactHeader(headerInput);
  if (Object.keys(header).length > 1) {
    const { error } = await supabase
      .from("ordenes_compra")
      .update(header)
      .eq("id", orderId)
      .eq("estado", "confirmado");

    if (error) throw new Error(error.message);
  }

  await reconcileLogisticsAssignmentForTipoEnvio(supabase, orderId, input.tipo_envio);

  for (const item of items ?? []) {
    if (!item.item_id) continue;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (item.cantidad !== undefined) patch.cantidad = item.cantidad;
    if (item.coste_unitario_moneda !== undefined) patch.coste_unitario_moneda = item.coste_unitario_moneda;
    if (item.coste_unitario_usd !== undefined) patch.coste_unitario_usd = item.coste_unitario_usd;
    if (item.coste_unitario_eur !== undefined) patch.coste_unitario_eur = item.coste_unitario_eur;
    if (item.lote_producto !== undefined) patch.lote_producto = item.lote_producto;

    const { error } = await supabase
      .from("orden_items")
      .update(patch)
      .eq("id", item.item_id)
      .eq("orden_id", orderId);

    if (error) throw new Error(error.message);
  }

  const { data: updated, error: readError } = await supabase
    .from("ordenes_compra")
    .select("*")
    .eq("id", orderId)
    .eq("estado", "confirmado")
    .single();

  if (readError || !updated) {
    throw new Error(readError?.message ?? "No se pudo actualizar la orden confirmada.");
  }

  const order = updated as OrdenCompraRow;
  await upsertConfirmedOrderCostSnapshots(order);
  await syncSupplierPaymentsForOrder(orderId);
  return order;
}
