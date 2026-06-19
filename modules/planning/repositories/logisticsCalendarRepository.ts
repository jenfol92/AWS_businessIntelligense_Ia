// modules/planning/repositories/logisticsCalendarRepository.ts

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { LogisticsCalendarQuery, LogisticsCalendarRawRow } from "../types";

/**
 * Lee `logistics_calendar` con filtros opcionales.
 * Solo snake_case y tipos crudos de Postgres/Supabase.
 */
export async function findLogisticsCalendarRows(
  query: LogisticsCalendarQuery
): Promise<LogisticsCalendarRawRow[]> {
  const supabase = createSupabaseRouteClient();

  let dbQuery = supabase
    .from("logistics_calendar")
    .select("*")
    .order("fecha_inicio", { ascending: true });

  if (query.year !== undefined) {
    const yearStart = `${query.year}-01-01`;
    const yearEnd = `${query.year}-12-31`;
    dbQuery = dbQuery
      .lte("fecha_inicio", yearEnd)
      .gte("fecha_fin", yearStart);
  }

  if (query.tipo !== undefined && query.tipo.length > 0) {
    dbQuery = dbQuery.eq("tipo", query.tipo);
  }

  if (query.pais !== undefined && query.pais.length > 0) {
    dbQuery = dbQuery.eq("pais", query.pais);
  }

  const { data, error } = await dbQuery;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as LogisticsCalendarRawRow[];
}
