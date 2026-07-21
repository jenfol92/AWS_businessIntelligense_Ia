import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
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
    "agente_id",
    "notas",
    "etd",
    "eta",
    "eta_real",
    "lead_time_produccion",
    "lead_time_transito",
    "numero_pedido_agente",
  ];
  const header: Record<string, unknown> = {};
  for (const key of allowed) {
    if (input[key] !== undefined) header[key] = input[key];
  }
  return header;
}

function requireSingleRpcRow<T>(data: T | T[] | null, context: string): T {
  if (Array.isArray(data)) {
    if (data.length === 1) return data[0] as T;
    throw new Error(`${context}: respuesta RPC inesperada (${data.length} filas).`);
  }
  if (!data) throw new Error(`${context}: respuesta RPC vacia.`);
  return data;
}

function buildConfirmedCostItemPayload(item: ConfirmedOrderItemPatch): Record<string, unknown> {
  const payload: Record<string, unknown> = { item_id: item.item_id };
  if (Object.prototype.hasOwnProperty.call(item, "coste_unitario_moneda")) {
    payload.coste_unitario_moneda = item.coste_unitario_moneda;
  }
  if (Object.prototype.hasOwnProperty.call(item, "coste_unitario_usd")) {
    payload.coste_unitario_usd = item.coste_unitario_usd;
  }
  if (Object.prototype.hasOwnProperty.call(item, "coste_unitario_eur")) {
    payload.coste_unitario_eur = item.coste_unitario_eur;
  }
  return payload;
}

export async function updateConfirmedOrderService(
  orderId: string,
  input: UpdateConfirmedOrderInput,
): Promise<OrdenCompraRow> {
  const supabase = createSupabaseRouteClient();
  const { items, ...headerInput } = input;

  const header = compactHeader(headerInput);
  const { data, error } = await supabase.rpc(
    "update_confirmed_purchase_order",
    {
      p_order_id: orderId,
      p_header: header,
      p_items: (items ?? []).map(buildConfirmedCostItemPayload),
    },
  );

  if (error) {
    throw new Error(error.message || "No se pudo actualizar la orden confirmada.");
  }

  return requireSingleRpcRow(
    data as OrdenCompraRow | OrdenCompraRow[] | null,
    "update_confirmed_purchase_order",
  );
}
