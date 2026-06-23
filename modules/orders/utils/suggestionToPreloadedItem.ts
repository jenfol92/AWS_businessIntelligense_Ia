import type { SugerenciaRow } from "@/modules/orders/types/orderSuggestions.types";
import type { PreloadedItem } from "@/modules/orders/types/orderForm.types";

/**
 * Convierte una fila de sugerencia de compra en un PreloadedItem
 * para abrir OrderFormModal con el producto precargado.
 *
 * IMPORTANTE: `fob_puerto` siempre recibe el nombre legible del puerto
 * (origin_port_name, ya resuelto por el endpoint), nunca un UUID.
 */
export function suggestionToPreloadedItem(s: SugerenciaRow): PreloadedItem {
  return {
    producto_id:        s.producto_id,
    sku:                s.sku,
    nombre:             s.nombre,
    proveedor_id:       s.proveedor_id,
    proveedor_nombre:   s.proveedor_nombre,
    agente_id:          s.agente_id ?? null,
    agente_contacto:    s.agente_nombre ?? null,
    cbm_unitario:       s.cbm_unitario,
    coste_unitario_usd: s.coste_unitario_usd,
    unidades_sugeridas: s.unidades_sugeridas,
    fob_puerto:         s.origin_port_name ?? s.puerto_preferido ?? null,
  };
}
