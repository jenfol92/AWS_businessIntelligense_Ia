/**
 * Modulo      : diagnostics
 * Archivo     : app/api/diagnostics/sp-api/route.ts
 * Responsabilidad: comprobar credenciales SP-API en modo solo lectura.
 * No debe     : imprimir secretos, importar datos, escribir en Supabase ni persistir tokens.
 */

import { NextResponse } from "next/server";

import { getMissingSpApiEnvKeys, loadSpApiConfig } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { getLwaAccessToken } from "@/modules/amazon-sp-api/lwaClient";
import { spApiRequest } from "@/modules/amazon-sp-api/spApiClient";

export const dynamic = "force-dynamic";

type DiagnosticStage = "env" | "lwa" | "spapi";

type MarketplaceParticipationsResponse = {
  payload?: unknown[];
};

type SpApiDiagnosticResponse = {
  ok: boolean;
  stage: DiagnosticStage;
  message: string;
  status?: number;
  marketplacesCount?: number;
};

function jsonDiagnostic(body: SpApiDiagnosticResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function getMissingMarketplaceEnvKeys(): string[] {
  const hasMarketplace = [
    process.env.AMAZON_MARKETPLACE_ES,
    process.env.AMAZON_MARKETPLACE_FR,
    process.env.AMAZON_MARKETPLACE_DE,
    process.env.AMAZON_MARKETPLACE_IT,
    process.env.AMAZON_MARKETPLACE_GB,
    process.env.AMAZON_MARKETPLACE_PL,
    process.env.AMAZON_MARKETPLACE_SE,
  ].some((value) => String(value ?? "").trim());

  return hasMarketplace ? [] : ["AMAZON_MARKETPLACE_*"];
}

/**
 * Ejecuta una prueba segura de autenticacion LWA y lectura SP-API.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        ok: false,
        stage: "env",
        message: "Diagnóstico SP-API no disponible en producción.",
      },
      { status: 404 },
    );
  }

  const missing = [...getMissingSpApiEnvKeys(), ...getMissingMarketplaceEnvKeys()];

  if (missing.length > 0) {
    return jsonDiagnostic(
      {
        ok: false,
        stage: "env",
        message: `Faltan variables de entorno: ${missing.join(", ")}`,
      },
      400,
    );
  }

  try {
    const config = loadSpApiConfig();
    await getLwaAccessToken(config);
  } catch (error: unknown) {
    const mapped = mapGenericError(error);

    return jsonDiagnostic(
      {
        ok: false,
        stage: mapped.code === "missing_env" ? "env" : "lwa",
        message:
          mapped.code === "missing_env"
            ? mapped.message
            : "No se pudo obtener access_token LWA.",
        status: mapped.status,
      },
      mapped.status ?? (mapped.code === "missing_env" ? 400 : 502),
    );
  }

  try {
    const data = await spApiRequest<MarketplaceParticipationsResponse>({
      method: "GET",
      path: "/sellers/v1/marketplaceParticipations",
    });

    return jsonDiagnostic({
      ok: true,
      stage: "spapi",
      message: "Conexión SP-API correcta.",
      marketplacesCount: Array.isArray(data.payload) ? data.payload.length : 0,
    });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);

    if (mapped.code === "unauthorized" || mapped.code === "forbidden") {
      return jsonDiagnostic(
        {
          ok: false,
          stage: "spapi",
          message:
            "La autenticación LWA funciona, pero la operación SP-API no está autorizada o falta rol/permisos.",
          status: mapped.status,
        },
        mapped.status ?? 403,
      );
    }

    return jsonDiagnostic(
      {
        ok: false,
        stage: "spapi",
        message: "No se pudo completar la prueba de conexión SP-API.",
        status: mapped.status,
      },
      mapped.status ?? 500,
    );
  }
}
