// modules/planning/services/getLogisticsCalendar.ts

import { findLogisticsCalendarRows } from "../repositories/logisticsCalendarRepository";
import type {
  LogisticsCalendarEvent,
  LogisticsCalendarQuery,
  LogisticsCalendarRawRow,
  LogisticsCalendarResponse,
} from "../types";

function mapLogisticsCalendarRow(
  row: LogisticsCalendarRawRow
): LogisticsCalendarEvent {
  return {
    id: row.id,
    nombre: row.nombre,
    tipo: row.tipo,
    fechaInicio: row.fecha_inicio,
    fechaFin: row.fecha_fin,
    impactoDias: Number(row.impacto_dias ?? 0),
    pais: row.pais,
    afectaProduccion: Boolean(row.afecta_produccion),
    afectaTransporte: Boolean(row.afecta_transporte),
    descripcion: row.descripcion,
    createdAt: row.created_at,
  };
}

/**
 * Caso de uso: listar eventos logísticos del calendario.
 */
export async function getLogisticsCalendar(
  query: LogisticsCalendarQuery
): Promise<LogisticsCalendarResponse> {
  const rawRows = await findLogisticsCalendarRows(query);
  const events = rawRows.map(mapLogisticsCalendarRow);

  return {
    ok: true,
    events,
  };
}
