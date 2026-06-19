import { findLogisticsCalendarRows } from "@/modules/planning/repositories/logisticsCalendarRepository";
import {
  mapLogisticsCalendarRow,
  type LogisticsCalendarEventInput,
} from "./resolveLogisticsCalendarImpact";

/** Carga eventos del año de referencia y el siguiente (p. ej. CNY ene 2027). */
export async function loadLogisticsCalendarEventsForPlanning(
  referenceDate?: string,
): Promise<LogisticsCalendarEventInput[]> {
  const ref = referenceDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  const year = Number(ref.slice(0, 4));
  const years = [year, year + 1];

  const rows = (
    await Promise.all(years.map((y) => findLogisticsCalendarRows({ year: y })))
  ).flat();

  const seen = new Set<string>();
  return rows
    .filter((row) => {
      const key = `${row.tipo}|${row.fecha_inicio}|${row.fecha_fin}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(mapLogisticsCalendarRow);
}
