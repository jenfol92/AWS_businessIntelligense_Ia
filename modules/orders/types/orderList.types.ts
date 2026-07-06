/** Contenedor vinculado a una orden (resumen para listados). */
export type OrderLinkedContainer = {
  contenedor_id: string;
  identificador_embarque: string;
  fecha_salida: string | null;
  fecha_eta_estimada: string | null;
  estado_logistico: string | null;
  puerto_llegada: string | null;
};

export type OrderLinkedAmazonInbound = {
  assignment_type: "amazon_inbound";
  shipment_id: string;
  shipment_name: string | null;
  estado_amazon: string | null;
  destination_center: string | null;
  destination_country: string | null;
  logistics_flow: string | null;
  transport_provider: string | null;
  fecha_salida: string | null;
  eta_estimada: string | null;
  fecha_entrega_real: string | null;
  tracking_number: string | null;
  agl_tracking_number: string | null;
  amazon_container_number: string | null;
  documents_count: number;
  costs_count: number;
};

/** Fila de orden en listados (GET /api/orders) con info de contenedor opcional. */
export type OrderListRow = {
  id: string;
  numero_orden: string;
  numero_pedido_agente: string | null;
  agente_id: string | null;
  agente_contacto?: string | null;
  estado: "borrador" | "confirmado" | "cancelado" | "recibido";
  tipo_envio: "propio" | "amazon_agl";
  fecha_orden: string;
  fob_puerto: string | null;
  destino: string | null;
  etd?: string | null;
  eta: string | null;
  cbm_total: number;
  cbm_limite: number | null;
  coste_total_usd: number;
  coste_total_eur: number;
  notas: string | null;
  lead_time_produccion: number | null;
  lead_time_transito: number | null;
  tipo_cambio_usd_eur: number | null;
  proforma_firmada_url: string | null;
  proforma_firmada_at: string | null;
  contenedor: OrderLinkedContainer | null;
  amazon_inbound: OrderLinkedAmazonInbound | null;
};
