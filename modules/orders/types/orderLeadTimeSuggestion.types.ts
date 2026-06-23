export type OrderLeadTimeSuggestionSource =
  | "historico_producto_proveedor"
  | "historico_producto"
  | "proveedor"
  | "none";

export type OrderLeadTimeSuggestionRequestItem = {
  producto_id: string;
  proveedor_id?: string | null;
};

export type OrderLeadTimeSuggestionRequest = {
  items: OrderLeadTimeSuggestionRequestItem[];
};

export type OrderLeadTimeSuggestion = {
  producto_id: string;
  proveedor_id: string | null;
  lead_time_produccion: number | null;
  lead_time_transito: number | null;
  source: OrderLeadTimeSuggestionSource;
  source_order_id?: string | null;
  source_fecha_confirmacion?: string | null;
};

export type OrderLeadTimeSuggestionResponse = {
  ok: true;
  suggestions: OrderLeadTimeSuggestion[];
};

export type OrderLeadTimeHistoricalRow = {
  orden_id: string;
  producto_id: string;
  proveedor_id: string | null;
  lead_time_produccion: number | null;
  lead_time_transito: number | null;
  fecha_confirmacion: string | null;
  created_at: string | null;
};

export type OrderLeadTimeSupplierRow = {
  id: string;
  dias_produccion_estandar: number | null;
  dias_transito_estandar: number | null;
};
