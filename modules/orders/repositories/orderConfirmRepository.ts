/**
 * Módulo      : orders
 * Archivo     : repositories/orderConfirmRepository.ts
 * Responsabilidad: operaciones CRUD de Supabase sobre ordenes_compra y orden_items
 *                  usadas exclusivamente durante la confirmación de una orden.
 * No debe     : contener lógica de negocio, defaults de pago ni preparar payloads.
 */

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type {
  ConfirmOrderInput,
  OrdenCompraRow,
} from "@/modules/orders/types/orderPersistence.types";

function mapItemsToRpcJson(input: ConfirmOrderInput) {
  return (input.items_costes ?? []).map((item) => ({
    item_id: item.item_id,
    coste_unitario_moneda: item.coste_unitario_moneda ?? null,
    coste_unitario_usd: item.coste_unitario_usd ?? null,
    coste_unitario_eur: item.coste_unitario_eur ?? null,
    lote_producto: item.lote_producto ?? null,
  }));
}

export async function confirmOrderWithCurrentFactoryCostsRpc(
  orderId: string,
  input: ConfirmOrderInput,
): Promise<OrdenCompraRow> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase.rpc(
    "confirm_order_with_current_factory_costs",
    {
      p_order_id: orderId,
      p_eta: input.eta,
      p_etd: input.etd ?? null,
      p_eta_real: input.eta_real ?? null,
      p_lead_time_produccion: input.lead_time_produccion ?? null,
      p_lead_time_transito: input.lead_time_transito ?? null,
      p_numero_pedido_agente: input.numero_pedido_agente ?? null,
      p_agente_id: input.agente_id ?? null,
      p_moneda_compra: input.moneda_compra ?? null,
      p_tipo_cambio_moneda_eur: input.tipo_cambio_moneda_eur ?? null,
      p_tipo_cambio_usd_eur: input.tipo_cambio_usd_eur ?? null,
      p_deposito_porcentaje: input.deposito_porcentaje ?? 30,
      p_balance_dias_antes_eta: input.balance_dias_antes_eta ?? 10,
      p_balance_condiciones_texto: input.balance_condiciones_texto ?? null,
      p_items: mapItemsToRpcJson(input),
    },
  );

  if (error || !data) {
    throw new Error(error?.message ?? "No se pudo confirmar la orden.");
  }

  return data as OrdenCompraRow;
}
