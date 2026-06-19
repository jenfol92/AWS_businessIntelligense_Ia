// modules/planning/hooks/useLogisticsCalendar.ts

"use client";

import { useCallback, useEffect, useState } from "react";
import type { LogisticsCalendarEvent } from "../types";

export type UseLogisticsCalendarFilters = {
  year?: number;
  tipo?: string;
  pais?: string;
};

type ApiSuccess = { ok: true; events: LogisticsCalendarEvent[] };
type ApiErrorBody = { ok: false; error?: string };

function buildLogisticsCalendarUrl(filters: UseLogisticsCalendarFilters): string {
  const params = new URLSearchParams();

  if (filters.year !== undefined) {
    params.set("year", String(filters.year));
  }
  if (filters.tipo !== undefined && filters.tipo.trim() !== "") {
    params.set("tipo", filters.tipo.trim());
  }
  if (filters.pais !== undefined && filters.pais.trim() !== "") {
    params.set("pais", filters.pais.trim());
  }

  const qs = params.toString();
  return qs.length > 0
    ? `/api/planning/logistics-calendar?${qs}`
    : "/api/planning/logistics-calendar";
}

function isSuccessPayload(data: unknown): data is ApiSuccess {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    d.ok === true &&
    Array.isArray(d.events) &&
    d.events.every((item) => item !== null && typeof item === "object")
  );
}

export function useLogisticsCalendar(
  filters: UseLogisticsCalendarFilters = {}
) {
  const year = filters.year;
  const tipo = filters.tipo;
  const pais = filters.pais;

  const [events, setEvents] = useState<LogisticsCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const url = buildLogisticsCalendarUrl({ year, tipo, pais });
      const response = await fetch(url, { cache: "no-store" });

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error(
          "No se pudo leer la respuesta del calendario logístico."
        );
      }

      if (!response.ok) {
        const errBody = body as ApiErrorBody;
        const message =
          typeof errBody?.error === "string" && errBody.error.length > 0
            ? errBody.error
            : `Error al cargar el calendario (${response.status}).`;
        throw new Error(message);
      }

      if (!isSuccessPayload(body)) {
        throw new Error("La respuesta del servidor no tiene el formato esperado.");
      }

      setEvents(body.events);
    } catch (err) {
      if (err instanceof TypeError && err.message.includes("fetch")) {
        setError(
          "Sin conexión o el servidor no responde. Comprueba tu red e inténtalo de nuevo."
        );
        setEvents([]);
        return;
      }

      setError(
        err instanceof Error
          ? err.message
          : "Error desconocido al cargar el calendario logístico."
      );
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [year, tipo, pais]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    events,
    loading,
    error,
    reload: load,
  };
}
