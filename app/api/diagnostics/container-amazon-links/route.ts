import { NextRequest, NextResponse } from "next/server";

import { getMissingSpApiEnvKeys } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { buildContainerAmazonLinksDiagnostic } from "@/modules/containers/services/buildContainerAmazonLinksDiagnostic";

export const dynamic = "force-dynamic";

function parseLimit(request: NextRequest): number {
  const raw = Number(request.nextUrl.searchParams.get("limit") ?? 25);
  return Number.isFinite(raw) ? Math.min(Math.max(Math.round(raw), 1), 100) : 25;
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        ok: false,
        message: "Diagnostico de vinculacion Amazon/contenedor no disponible en produccion.",
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

  try {
    const diagnostic = await buildContainerAmazonLinksDiagnostic({
      limit: parseLimit(request),
      lastUpdatedAfter: request.nextUrl.searchParams.get("lastUpdatedAfter"),
    });

    return NextResponse.json(diagnostic);
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return NextResponse.json(
      {
        ok: false,
        message: "No se pudo construir el diagnostico de vinculacion Amazon/contenedor.",
        error: mapped.message,
        status: mapped.status,
      },
      { status: mapped.status ?? 502 },
    );
  }
}
