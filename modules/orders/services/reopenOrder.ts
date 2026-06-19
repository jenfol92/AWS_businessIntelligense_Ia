import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { OrdenCompraRow } from "@/modules/orders/repositories/ordersRepository";

/**
 * Reabre una orden confirmada a borrador sin borrar datos logísticos ni económicos.
 */
export async function reopenOrder(
  orderId: string,
  motivo?: string | null,
): Promise<OrdenCompraRow> {
  const supabase = createSupabaseRouteClient();

  const { data: ordenActual, error: ordenError } = await supabase
    .from("ordenes_compra")
    .select("id, estado, notas")
    .eq("id", orderId)
    .single();

  if (ordenError || !ordenActual) {
    throw new Error("Orden no encontrada");
  }

  if (ordenActual.estado !== "confirmado") {
    throw new Error("Solo se pueden reabrir ordenes confirmadas.");
  }

  const marcaTiempo = new Date().toISOString().slice(0, 16).replace("T", " ");
  const motivoTrim = (motivo ?? "").trim();
  const anotacion = motivoTrim
    ? `[${marcaTiempo}] Reabierta a borrador: ${motivoTrim}`
    : `[${marcaTiempo}] Reabierta a borrador`;
  const nuevasNotas = ordenActual.notas
    ? `${ordenActual.notas}\n${anotacion}`
    : anotacion;

  const { data: orden, error: updateError } = await supabase
    .from("ordenes_compra")
    .update({
      estado: "borrador",
      notas: nuevasNotas,
      fecha_confirmacion: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .eq("estado", "confirmado")
    .select("*")
    .single();

  if (updateError || !orden) {
    throw new Error(updateError?.message ?? "No se pudo reabrir la orden.");
  }

  return orden as OrdenCompraRow;
}
