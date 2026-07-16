/**
 * Tipos del payload que OrderFormModal envía a POST /api/orders y PUT /api/orders/[id].
 * Separados del componente para que el builder pueda vivir fuera de él.
 * No modifica contratos API: los campos son los que ya aceptan los endpoints.
 */

/** Campos de cabecera que el formulario pasa al builder, en notación camelCase del modal. */
export type OrderFormHeaderOpts = {
  tipoEnvio: "propio" | "amazon_agl";
  fob: string;
  destino: string;
  agenteId: string;
  fecha: string;
  cbmLimite: number;
  notas: string;
  etd: string;
  eta: string;
  monedaCompra: string;
  tipoCambio: number | "";
  numeroPedidoAgente: string;
  leadProduccion: number | "";
  leadTransito: number | "";
};

/**
 * Campos mínimos de ítem que el builder necesita leer.
 * OrderItem del modal es estructuralmente asignable a este tipo
 * (tiene estos campos más _key, nombre, sku, proveedor_nombre, sin_coste_historico).
 * Así el mapper no depende del tipo local del componente.
 */
export type OrderFormItemInput = {
  _key?: string;
  producto_id: string;
  proveedor_id: string | null;
  cantidad: number;
  cbm_unitario: number;
  coste_unitario_moneda: number | null;
  coste_unitario_usd: number | null;
  coste_unitario_eur: number | null;
  lote_producto: string | null;
};

/** Línea del payload tal como la espera la API. */
export type OrderApiItemPayload = {
  item_id?: string;
  producto_id: string;
  proveedor_id: string | null;
  cantidad: number;
  cbm_unitario: number;
  coste_unitario_moneda: number | null;
  coste_unitario_usd: number | null;
  coste_unitario_eur: number | null;
  lote_producto: string | null;
};

/** Payload completo enviado a POST /api/orders y PUT /api/orders/[id]. */
export type OrderFormPayload = {
  tipo_envio: "propio" | "amazon_agl";
  fob_puerto: string | null;
  destino: string | null;
  agente_id: string | null;
  fecha_orden: string;
  cbm_limite: number;
  notas: string | null;
  etd: string | null;
  eta: string | null;
  moneda_compra: string;
  tipo_cambio_moneda_eur: number | null;
  tipo_cambio_usd_eur: number | null;
  numero_pedido_agente: string | null;
  lead_time_produccion: number | null;
  lead_time_transito: number | null;
  items: OrderApiItemPayload[];
};
