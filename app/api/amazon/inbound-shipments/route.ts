/**
 * Módulo: Amazon AGL.
 * Responsabilidad: listar envíos inbound persistidos en `amazon_envios`.
 * No debe sincronizar SP-API, vincular contenedores ni tocar stock.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listAmazonInboundShipmentsFromAmazonEnvios } from "@/modules/amazon-sp-api/syncInboundShipmentsToAmazonEnviosService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

/**
 * GET /api/amazon/inbound-shipments
 *
 * Devuelve envíos agrupados por `shipment_id` para revisión y vinculación manual.
 *
 * Parámetros:
 *   mode=operative (default) — scope operativo: año actual + carryover no terminal
 *   mode=history             — histórico explícito; requiere year válido (→ 400 si inválido)
 *   year=YYYY                — requerido en mode=history; ignorado en operative
 *   includeClosedCurrentYear — en mode=operative, incluir CLOSED del año actual
 *   includeClosed            — alias de includeClosedCurrentYear
 */
export async function GET(request: NextRequest) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    const mode = (request.nextUrl.searchParams.get("mode") ?? "operative") as
      | "operative"
      | "history";

    if (mode !== "operative" && mode !== "history") {
      return NextResponse.json(
        { ok: false, error: `mode inválido: "${mode}". Use "operative" o "history".` },
        { status: 400 },
      );
    }

    const includeClosed =
      request.nextUrl.searchParams.get("includeClosed")?.toLowerCase() === "true";
    const includeClosedCurrentYear =
      request.nextUrl.searchParams.get("includeClosedCurrentYear")?.toLowerCase() === "true";

    const rawYear = request.nextUrl.searchParams.get("year");
    const year = rawYear ? Number(rawYear) : null;

    // mode=history con year inválido → 400 explícito (NO fallback silencioso)
    if (mode === "history" && (!rawYear || !Number.isInteger(year) || (year !== null && (year < 2020 || year > 2100)))) {
      return NextResponse.json(
        {
          ok: false,
          error: `INVALID_YEAR: mode=history requiere ?year=YYYY válido (2020-2100). Recibido: "${rawYear ?? "vacío"}"`,
        },
        { status: 400 },
      );
    }

    const result = await listAmazonInboundShipmentsFromAmazonEnvios({
      mode,
      includeClosed,
      includeClosedCurrentYear: includeClosed || includeClosedCurrentYear,
      year: Number.isInteger(year) ? year : null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error listando envíos Amazon";
    // INVALID_YEAR → 400; otros errores → 500
    const status = message.startsWith("INVALID_YEAR") ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
