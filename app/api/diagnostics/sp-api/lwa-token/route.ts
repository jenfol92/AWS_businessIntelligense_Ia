/**
 * Modulo      : diagnostics
 * Archivo     : app/api/diagnostics/sp-api/lwa-token/route.ts
 * Responsabilidad: comprobar renovacion LWA sin llamar a SP-API ni exponer tokens.
 */

import { NextResponse } from "next/server";

import { getMissingSpApiEnvKeys, loadSpApiConfig } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { getLwaAccessToken } from "@/modules/amazon-sp-api/lwaClient";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        ok: false,
        message: "Diagnostico LWA no disponible en produccion.",
      },
      { status: 404 },
    );
  }

  const missing = getMissingSpApiEnvKeys();
  if (missing.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        message: `Faltan variables de entorno: ${missing.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const forceRefresh = url.searchParams.get("force") === "1";

  try {
    const config = loadSpApiConfig();
    const token = await getLwaAccessToken(config, { forceRefresh });

    return NextResponse.json({
      ok: true,
      expiresIn: token.expiresIn,
      forceRefresh,
      cached: token.cached,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return NextResponse.json(
      {
        ok: false,
        message: mapped.message,
        status: mapped.status ?? null,
        code: mapped.code,
        generatedAt: new Date().toISOString(),
      },
      { status: mapped.status ?? 500 },
    );
  }
}
