import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { OrdenCompraRow } from "@/modules/orders/repositories/ordersRepository";

function requireSingleRpcRow<T>(data: T | T[] | null, context: string): T {
  if (Array.isArray(data)) {
    if (data.length === 1) return data[0] as T;
    throw new Error(`${context}: respuesta RPC inesperada (${data.length} filas).`);
  }
  if (!data) throw new Error(`${context}: respuesta RPC vacia.`);
  return data;
}

/**
 * Reabre una orden confirmada a borrador sin borrar datos logísticos ni económicos.
 */
export async function reopenOrder(
  orderId: string,
  motivo?: string | null,
): Promise<OrdenCompraRow> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase.rpc(
    "reopen_confirmed_purchase_order",
    { p_order_id: orderId, p_motivo: motivo ?? null },
  );

  if (error) {
    throw new Error(error.message || "No se pudo reabrir la orden.");
  }

  return requireSingleRpcRow(
    data as OrdenCompraRow | OrdenCompraRow[] | null,
    "reopen_confirmed_purchase_order",
  );
}
