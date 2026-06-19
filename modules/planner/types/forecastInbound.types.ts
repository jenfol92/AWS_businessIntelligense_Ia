export type ForecastInboundConfidence = "confirmed" | "provisional";

export type InboundPlanningKind =
  | "CONTAINER_CONFIRMED"
  | "PURCHASE_ORDER_CONFIRMED"
  | "PURCHASE_ORDER_PROVISIONAL";

export type ForecastInboundItemRaw = {
  contenedor_id: string | null;
  identificador_embarque: string | null;
  estado_contenedor: string | null;
  fecha_eta_original: string | null;
  fecha_eta_estimada: string | null;
  retraso_dias: number;
  orden_id: string;
  numero_orden: string | null;
  destino_orden: string | null;
  orden_item_id: string;
  producto_id: string;
  unidades_orden: number;
  unidades_aplicadas: number;
  unidades_pendientes: number;
  coste_unitario_eur: number;
  tipo_contenedor: string | null;
  puerto_llegada: string | null;
  transitario: string | null;
  has_contenedor: boolean;
  confidence: ForecastInboundConfidence;
};

export type ForecastInboundItem = ForecastInboundItemRaw & {
  forecast_country: string | null;
  forecast_channel: string;
  warnings: string[];
};

export type ForecastInboundScheduleEntry = {
  eta: string;
  units: number;
  /** @deprecated Usar `planningKind` / `usableForPlanning` */
  confidence: ForecastInboundConfidence;
  planningKind?: InboundPlanningKind;
  usableForPlanning?: boolean;
  ordenId?: string | null;
  numeroOrden?: string | null;
  forecastCountry: string | null;
  forecastChannel: string;
};

export type ForecastInboundProductSummary = {
  productoId: string;
  stockInboundConfirmed: number;
  stockInboundProvisional: number;
  capitalAlreadyCommitted: number;
  schedule: ForecastInboundScheduleEntry[];
  items: ForecastInboundItem[];
};

export type ForecastInboundCapitalSummary = {
  capitalAlreadyCommitted: number;
  additionalCapitalRequired: number;
  totalCapitalExposure: number;
};
