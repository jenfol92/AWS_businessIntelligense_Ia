import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { OrdenCompraRow } from "@/modules/orders/repositories/ordersRepository";
import { voidPendingSupplierPaymentsForOrder } from "@/modules/finance/repositories/financeSupplierPaymentsRepository";

/**
 * Reabre una orden confirmada a borrador sin borrar datos logísticos ni económicos.
 */
export async function reopenOrder(
  orderId: string,
  _motivo?: string | null,
): Promise<OrdenCompraRow> {
  const supabase = createSupabaseRouteClient();

  const { data: ordenActual, error: ordenError } = await supabase
    .from("ordenes_compra")
    .select("id, estado")
    .eq("id", orderId)
    .single();

  if (ordenError || !ordenActual) {
    throw new Error("Orden no encontrada");
  }

  if (ordenActual.estado !== "confirmado") {
    throw new Error("Solo se pueden reabrir ordenes confirmadas.");
  }

  const { data: orden, error: updateError } = await supabase
    .from("ordenes_compra")
    .update({
      estado: "borrador",
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .eq("estado", "confirmado")
    .select("*")
    .single();

  if (updateError || !orden) {
    throw new Error(updateError?.message ?? "No se pudo reabrir la orden.");
  }

  await voidPendingSupplierPaymentsForOrder(orderId);

  return orden as OrdenCompraRow;
}
