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
    const includeClosed =
      request.nextUrl.searchParams.get("includeClosed")?.toLowerCase() === "true";
    const includeClosedCurrentYear =
      request.nextUrl.searchParams.get("includeClosedCurrentYear")?.toLowerCase() === "true";
    const year = Number(request.nextUrl.searchParams.get("year"));
    const result = await listAmazonInboundShipmentsFromAmazonEnvios({
      includeClosed,
      includeClosedCurrentYear: includeClosed || includeClosedCurrentYear,
      year: Number.isInteger(year) ? year : null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Error listando envíos Amazon",
      },
      { status: 400 },
    );
  }
}
