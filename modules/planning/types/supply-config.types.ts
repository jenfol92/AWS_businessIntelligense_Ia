// modules/planning/types/supply-config.types.ts

/** Método de forecast por producto (columna producto_supply_config.forecast_method). */
export type ForecastMethod =
  | "AUTO"
  | "OWN_SALES"
  | "OWN_SALES_CORRECTED"
  | "COMPETITOR_BENCHMARK"
  | "MIXED"
  | "MANUAL";

export const FORECAST_METHODS: ForecastMethod[] = [
  "AUTO",
  "OWN_SALES",
  "OWN_SALES_CORRECTED",
  "COMPETITOR_BENCHMARK",
  "MIXED",
  "MANUAL",
];

/** Fila `producto_supply_config` tal como viene de Supabase (snake_case). */
export type ProductSupplyConfigRawRow = {
  id: string;
  producto_id: string;
  lead_time_produccion_dias: number | null;
  lead_time_transporte_dias: number | null;
  lead_time_aduana_dias: number | null;
  stock_seguridad_dias: number | null;
  frecuencia_reposicion_dias: number | null;
  moq: number | null;
  master_carton_qty: number | null;
  puerto_origen: string | null;
  puerto_destino: string | null;
  proveedor_id: string | null;
  agente_id: string | null;
  forecast_method: string | null;
  forecast_mix_own_weight: number | null;
  forecast_mix_competitor_weight: number | null;
  competitor_capture_pct: number | null;
  stockout_correction_enabled: boolean | null;
  created_at: string | null;
  updated_at?: string | null;
};

/** Payload de escritura hacia Supabase (snake_case). */
export type ProductSupplyConfigUpsertRaw = {
  producto_id: string;
  lead_time_produccion_dias: number;
  lead_time_transporte_dias: number;
  lead_time_aduana_dias: number;
  stock_seguridad_dias: number;
  frecuencia_reposicion_dias: number;
  moq: number;
  master_carton_qty: number;
  puerto_origen: string | null;
  puerto_destino: string | null;
  proveedor_id: string | null;
  agente_id: string | null;
  forecast_method?: string | null;
  forecast_mix_own_weight?: number | null;
  forecast_mix_competitor_weight?: number | null;
  competitor_capture_pct?: number | null;
  stockout_correction_enabled?: boolean | null;
};

export type ProductForecastConfigUpsertRaw = {
  forecast_method: string;
  forecast_mix_own_weight: number | null;
  forecast_mix_competitor_weight: number | null;
  competitor_capture_pct: number | null;
  stockout_correction_enabled: boolean;
};

/** Configuración expuesta a API / frontend (camelCase). */
export type ProductSupplyConfig = {
  id: string | null;
  productoId: string;
  leadTimeProduccionDias: number;
  leadTimeTransporteDias: number;
  leadTimeAduanaDias: number;
  stockSeguridadDias: number;
  frecuenciaReposicionDias: number;
  moq: number;
  masterCartonQty: number;
  puertoOrigen: string | null;
  puertoDestino: string | null;
  proveedorId: string | null;
  agenteId: string | null;
  forecastMethod: ForecastMethod;
  forecastMixOwnWeight: number | null;
  forecastMixCompetitorWeight: number | null;
  competitorCapturePct: number | null;
  stockoutCorrectionEnabled: boolean;
  createdAt: string | null;
};

export type ProductSupplyConfigGetResponse = {
  ok: true;
  config: ProductSupplyConfig;
};

/** Cuerpo PUT: mismos campos configurables que `ProductSupplyConfig` salvo id, createdAt y productoId (el id de producto va en la URL). */
export type ProductSupplyConfigUpsertBody = {
  leadTimeProduccionDias: number;
  leadTimeTransporteDias: number;
  leadTimeAduanaDias: number;
  stockSeguridadDias: number;
  frecuenciaReposicionDias: number;
  moq: number;
  masterCartonQty: number;
  puertoOrigen: string | null;
  puertoDestino: string | null;
  proveedorId: string | null;
  agenteId: string | null;
};

export type ProductSupplyConfigUpsertResponse = {
  ok: true;
  config: ProductSupplyConfig;
};

/** Campos de forecast editables desde pestaña Benchmarking. */
export type ProductForecastConfigUpsertBody = {
  forecastMethod: ForecastMethod;
  forecastMixOwnWeight: number | null;
  forecastMixCompetitorWeight: number | null;
  competitorCapturePct: number | null;
  stockoutCorrectionEnabled: boolean;
};

export type ProductForecastConfigUpsertResponse = {
  ok: true;
  config: ProductSupplyConfig;
};
