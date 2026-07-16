/**
 * Tipos del estado del formulario de orden cargado desde la API.
 * Usados por fetchOrderDetail, mapOrderDetailToFormState y useOrderFormLoader
 * para evitar que el mapper importe desde un componente.
 */

// ─── Respuesta cruda de GET /api/orders/:id ────────────────────────────────

export type RawOrderDetail = {
  orden: Record<string, unknown>;
  items: Record<string, unknown>[];
};

// ─── Estado del formulario ─────────────────────────────────────────────────

/**
 * Ítem de orden tal como se necesita en el formulario.
 * Estructuralmente idéntico al tipo local OrderItem de OrderFormModal.
 */
export type OrderFormItemState = {
  _key: string;
  producto_id: string;
  nombre: string;
  sku: string;
  proveedor_id: string | null;
  proveedor_nombre: string;
  cantidad: number;
  cbm_unitario: number;
  coste_unitario_moneda: number | null;
  coste_unitario_usd: number | null;
  coste_unitario_eur: number | null;
  moneda_coste?: string | null;
  lote_producto: string | null;
  sin_coste_historico?: boolean;
};

/**
 * Estado completo del formulario mapeado desde la respuesta de GET /api/orders/:id.
 * Contiene cabecera y líneas listas para aplicar a los setters del formulario.
 */
export type OrderFormLoaderState = {
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
  items: OrderFormItemState[];
};
