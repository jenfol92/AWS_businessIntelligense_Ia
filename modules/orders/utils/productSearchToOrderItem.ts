/**
 * Mapper puro: convierte un resultado de búsqueda de producto en un ítem
 * del formulario de orden de compra.
 *
 * Traslado literal de la lógica duplicada que existía en
 * addProductFromSearch y addSelectedProducts de OrderFormModal.tsx.
 * No cambia campos, valores por defecto ni lógica de costes.
 */

import { syncOrderLineCostFields } from "@/modules/orders/utils/syncOrderLineCostFields";
import type { ProductoSearch } from "@/modules/orders/types/orderProductSearch.types";
import type { OrderFormItemState } from "@/modules/orders/types/orderFormState.types";

/**
 * Convierte un ProductoSearch en un OrderFormItemState listo para añadir
 * a la lista de ítems del formulario.
 *
 * @param prod          - Producto devuelto por GET /api/orders/products-search.
 * @param monedaCompra  - Moneda de compra activa en el formulario (ej. "USD", "EUR").
 */
export function productSearchToOrderItem(
  prod: ProductoSearch,
  monedaCompra: string,
): OrderFormItemState {
  const costs = syncOrderLineCostFields({
    monedaCompra,
    costeUnitarioMoneda: prod.coste_unitario_moneda,
    costeUnitarioUsd:
      prod.moneda_producto === "USD" ? prod.coste_unitario_moneda : prod.coste_unitario_usd,
    costeUnitarioEur: prod.coste_fabrica_eur ?? null,
  });

  return {
    _key:               prod.producto_id,
    producto_id:        prod.producto_id,
    nombre:             prod.nombre,
    sku:                prod.sku,
    proveedor_id:       prod.proveedor_id,
    proveedor_nombre:   prod.proveedor_nombre ?? "—",
    cantidad:           1,
    cbm_unitario:       prod.cbm_unitario ?? 0,
    ...costs,
    lote_producto:      null,
    sin_coste_historico: prod.sin_coste_historico ?? !prod.coste_unitario_moneda,
  };
}
