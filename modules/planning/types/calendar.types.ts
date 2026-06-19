// modules/planning/types/calendar.types.ts

/** Filtros de negocio (camelCase); el repository recibe el mismo shape para armar el SQL. */
export type LogisticsCalendarQuery = {
  year?: number;
  tipo?: string;
  pais?: string;
};

/** Fila tal como viene de `logistics_calendar` (snake_case). */
export type LogisticsCalendarRawRow = {
  id: string;
  nombre: string;
  tipo: string;
  fecha_inicio: string;
  fecha_fin: string;
  impacto_dias: number;
  pais: string | null;
  afecta_produccion: boolean | null;
  afecta_transporte: boolean | null;
  descripcion: string | null;
  created_at: string | null;
  updated_at: string | null;
updatedAt: string | null;
};

/** Evento listo para API / consumo en frontend. */
export type LogisticsCalendarEvent = {
  id: string;
  nombre: string | null;
  tipo: string | null;
  fechaInicio: string;
  fechaFin: string;
  impactoDias: number | null;
  pais: string | null;
  afectaProduccion: boolean;
  afectaTransporte: boolean;
  descripcion: string | null;
  createdAt: string | null;
};

export type LogisticsCalendarResponse = {
  ok: true;
  events: LogisticsCalendarEvent[];
};
