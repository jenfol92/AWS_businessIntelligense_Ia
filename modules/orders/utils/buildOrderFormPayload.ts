/**
 * Builder puro del payload que OrderFormModal envía a POST /api/orders
 * y PUT /api/orders/[id].
 *
 * Traslado literal de la función buildBody que vivía en OrderFormModal.tsx.
 * No cambia ningún campo, ninguna normalización ni ningún valor por defecto.
 * No envía cbm_total (columna generada en BD, Postgres rechaza el INSERT).
 * Preserva la asimetría actual: POST ignora algunos campos avanzados — no corregir aquí.
 */

import type {
  OrderFormHeaderOpts,
  OrderFormItemInput,
  OrderFormPayload,
} from "@/modules/orders/types/orderFormPayload.types";

export function buildOrderFormPayload(
  itemList: OrderFormItemInput[],
  opts: OrderFormHeaderOpts,
): OrderFormPayload {
  const tc = opts.tipoCambio === "" ? null : Number(opts.tipoCambio);
  return {
    tipo_envio:  opts.tipoEnvio,
    fob_puerto:  opts.fob     || null,
    destino:     opts.destino || null,
    agente_id:   opts.agenteId || null,
    fecha_orden: opts.fecha,
    cbm_limite:  opts.cbmLimite,
    notas:       opts.notas   || null,
    etd:         opts.etd || null,
    eta:         opts.eta || null,
    moneda_compra: opts.monedaCompra || "USD",
    tipo_cambio_moneda_eur: tc,
    tipo_cambio_usd_eur: opts.monedaCompra === "USD" ? tc : null,
    numero_pedido_agente: opts.numeroPedidoAgente || null,
    lead_time_produccion: opts.leadProduccion === "" ? null : Number(opts.leadProduccion),
    lead_time_transito:   opts.leadTransito   === "" ? null : Number(opts.leadTransito),
    items: itemList.map((i) => ({
      producto_id:           i.producto_id,
      proveedor_id:          i.proveedor_id,
      cantidad:              i.cantidad,
      cbm_unitario:          i.cbm_unitario,
      coste_unitario_moneda: i.coste_unitario_moneda,
      coste_unitario_usd:    i.coste_unitario_usd,
      coste_unitario_eur:    i.coste_unitario_eur,
      lote_producto:         i.lote_producto?.trim() || null,
    })),
  };
}
