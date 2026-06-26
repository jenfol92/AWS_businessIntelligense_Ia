// app/api/planning/logistics-calendar/route.ts

import { NextResponse } from "next/server";
import { getLogisticsCalendar } from "@/modules/planning/services/getLogisticsCalendar";
import type { LogisticsCalendarQuery } from "@/modules/planning/types";

type ParseResult =
  | { ok: true; query: LogisticsCalendarQuery }
  | { ok: false; error: string };

function parseLogisticsCalendarQuery(req: Request): ParseResult {
  const url = new URL(req.url);
  const result: LogisticsCalendarQuery = {};

  const yearRaw = url.searchParams.get("year");
  if (yearRaw !== null && yearRaw !== "") {
    const year = Number(yearRaw);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      return {
        ok: false,
        error: "Parámetro year inválido; use un entero entre 1900 y 2100.",
      };
    }
    result.year = year;
  }

  const tipo = url.searchParams.get("tipo")?.trim();
  if (tipo) {
    result.tipo = tipo;
  }

  const pais = url.searchParams.get("pais")?.trim();
  if (pais) {
    result.pais = pais;
  }

  return { ok: true, query: result };
}

export async function GET(req: Request) {
  try {
    const parsed = parseLogisticsCalendarQuery(req);
    if (parsed.ok === false) {
      return NextResponse.json(
        { ok: false, error: parsed.error },
        { status: 400 }
      );
    }
    
    const body = await getLogisticsCalendar(parsed.query);
    return NextResponse.json(body);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error cargando calendario logístico";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
