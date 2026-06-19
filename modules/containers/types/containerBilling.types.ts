export type FacturacionErrorCode =
  | "container_not_found"
  | "container_has_no_orders"
  | "missing_order_items"
  | "missing_cbm_total"
  | "invalid_container_cbm_total"
  | "missing_order_item_unit_cost_eur"
  | "missing_order_item_quantity"
  | "missing_container_cost_fields";

export type OrdenItemForBillingRow = {
  id: string;
  orden_id: string;
  producto_id: string;
  proveedor_id: string | null;
  cantidad: number;
  cbm_unitario: number | null;
  cbm_total: number | null;
  coste_unitario_moneda: number | null;
  coste_unitario_eur: number | null;
  lote_producto: string | null;
  moneda_compra: string | null;
  tipo_cambio_moneda_eur: number | null;
  destino: string | null;
  numero_orden: string | null;
  sku: string | null;
  nombre: string | null;
};

export type ContainerRowForBilling = {
  id: string;
  identificador_embarque: string;
  tipo_contenedor: string | null;
  estado_costes: string | null;
  estado_logistico: string | null;
  estado_stock: string | null;
  estado: string | null;
  puerto_llegada: string | null;
  costo_flete_total_eur: number | null;
  gastos_llegada_puerto_eur: number | null;
  costo_transito_total_eur: number | null;
  comision_bancaria_eur: number | null;
  flete: number | null;
  gastos_llegada_puerto: number | null;
  facturado_at: string | null;
};

export type FacturacionLineaResult = {
  orden_item_id: string;
  sku: string | null;
  producto: string | null;
  lote_producto: string | null;
  cantidad: number;
  cbm_total: number;
  peso_cbm: number;
  costo_fabrica_eur_unit: number;
  costo_flete_unit_eur: number;
  gastos_llegada_puerto_eur_unit: number;
  transito_eur_unit: number;
  costo_unitario_total_eur: number;
  producto_costos_id?: string;
  action: "insert" | "update";
};

export type FacturarContainerCostsResult = {
  ok: true;
  contenedor_id: string;
  cbm_total_contenedor: number;
  coste_flete_total: number;
  coste_transito_total: number;
  gastos_llegada_total: number;
  lineas_procesadas: number;
  coste_total_logistico: number;
  producto_costos_upserted: number;
  warnings: string[];
  lineas: FacturacionLineaResult[];
};

export type FacturarContainerCostsError = {
  ok: false;
  code: FacturacionErrorCode | "facturacion_failed";
  message: string;
  details?: string[];
};
