/**
 * Mapper puro: convierte la respuesta cruda de GET /api/orders/:id
 * en el estado del formulario de edición de orden.
 *
 * Extrae literalmente la lógica que estaba en el useEffect de OrderFormModal.
 * No cambia valores por defecto, null/undefined/"" ni cálculos.
 */

import type {
  RawOrderDetail,
  OrderFormLoaderState,
} from "@/modules/orders/types/orderFormState.types";

const CBM_LIMITE_DEFAULT = 65;

export function mapOrderDetailToFormState(detail: RawOrderDetail): OrderFormLoaderState {
  const orden = detail.orden;
  const tc    = (orden.tipo_cambio_moneda_eur ?? orden.tipo_cambio_usd_eur) as number | null;

  return {
    tipoEnvio:          orden.tipo_envio === "amazon_agl" ? "amazon_agl" : "propio",
    fob:                (orden.fob_puerto as string | null) ?? "",
    destino:            (orden.destino    as string | null) ?? "",
    agenteId:           (orden.agente_id  as string | null) ?? "",
    fecha:              ((orden.fecha_orden as string | null) ?? "").slice(0, 10),
    cbmLimite:          Number(orden.cbm_limite ?? CBM_LIMITE_DEFAULT),
    notas:              (orden.notas               as string | null) ?? "",
    etd:                orden.etd ? String(orden.etd).slice(0, 10) : "",
    eta:                orden.eta ? String(orden.eta).slice(0, 10) : "",
    monedaCompra:       String(orden.moneda_compra ?? "USD"),
    tipoCambio:         tc != null ? Number(tc) : "",
    numeroPedidoAgente: (orden.numero_pedido_agente  as string | null) ?? "",
    leadProduccion:     (orden.lead_time_produccion  as number | null) ?? "",
    leadTransito:       (orden.lead_time_transito    as number | null) ?? "",

    items: detail.items.map((i) => ({
      _key:               String(i.id),
      producto_id:        String(i.producto_id),
      nombre:             (i.productos as { nombre?: string } | null)?.nombre ?? "",
      sku:                (i.productos as { sku?: string }    | null)?.sku    ?? "",
      proveedor_id:       (i.proveedor_id as string | null) ?? null,
      proveedor_nombre:   (i.proveedores as { nombre?: string } | null)?.nombre ?? "—",
      cantidad:           Number(i.cantidad    ?? 1),
      cbm_unitario:       Number(i.cbm_unitario ?? 0),
      coste_unitario_moneda:
        (i.coste_unitario_moneda as number | null)
        ?? (i.coste_unitario_usd  as number | null)
        ?? null,
      coste_unitario_usd: (i.coste_unitario_usd as number | null) ?? null,
      coste_unitario_eur: (i.coste_unitario_eur as number | null) ?? null,
      moneda_coste:       (i.moneda_coste as string | null) ?? String(orden.moneda_compra ?? "USD"),
      lote_producto:      (i.lote_producto      as string | null) ?? null,
      sin_coste_historico:
        i.coste_unitario_moneda == null
        && i.coste_unitario_usd == null
        && i.coste_unitario_eur == null,
    })),
  };
}
