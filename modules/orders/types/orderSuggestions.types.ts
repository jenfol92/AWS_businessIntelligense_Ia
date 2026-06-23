/**
 * Tipos relacionados con sugerencias de compra.
 * Coinciden con la respuesta de GET /api/orders/suggestions.
 * No importar desde app/api para evitar dependencias del servidor en el cliente.
 */

export type SugerenciaRow = {
  // ── Campos base ─────────────────────────────────────────────────────────
  producto_id:        string;
  sku:                string;
  nombre:             string;
  imagen_url:         string | null;
  categoria:          string | null;
  proveedor_id:       string | null;
  proveedor_nombre:   string | null;
  puerto_preferido:   string | null;
  dias_produccion:    number;
  dias_transito:      number;
  lead_time_total:    number;
  stock_fba:          number;
  stock_fbm:          number;
  stock_actual:       number;
  dias_cobertura:     number | null;
  unidades_sugeridas: number;
  cbm_unitario:       number;
  cbm_total_sugerido: number;
  coste_unitario_usd: number | null;
  riesgo:             "critico" | "bajo" | null;
  // ── Campos extendidos del planner ────────────────────────────────────────
  fuente?:                  "planner" | "stock";
  recommended_order_date?:  string | null;
  estimated_arrival_date?:  string | null;
  agente_id?:               string | null;
  agente_nombre?:           string | null;
  origin_port_id?:          string | null;
  order_timing_status?:     "ON_TIME" | "DUE_NOW" | "OVERDUE";
  days_late?:               number;
  consolidation_eligible?:  boolean;
  peso_kg_total?:           number | null;
  capital_requerido?:       number | null;
  /** Nombre legible del puerto de origen (nunca UUID). */
  origin_port_name?:        string | null;
};
