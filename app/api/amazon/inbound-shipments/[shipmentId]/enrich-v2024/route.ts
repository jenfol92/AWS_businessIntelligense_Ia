/**
 * Modulo: Amazon AGL.
 * Responsabilidad: enriquecer manualmente un shipment concreto con datos v2024.
 * No debe crear contenedores, tocar stock, forecast ni ejecutar cron.
 */

import { NextRequest, NextResponse } from "next/server";

import { getMissingSpApiEnvKeys } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { enrichAmazonInboundShipmentV2024Directed } from "@/modules/amazon-sp-api/syncInboundShipmentsToAmazonEnviosService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

type Params = { params: { shipmentId: string } };

function numberParam(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

export async function POST(request: NextRequest, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const missing = getMissingSpApiEnvKeys();
  if (missing.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `Faltan variables de entorno: ${missing.join(", ")}`,
      },
      { status: 400 },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      maxPages?: number;
      delayMs?: number;
      force?: boolean;
    };

    const result = await enrichAmazonInboundShipmentV2024Directed({
      shipmentId: decodeURIComponent(params.shipmentId),
      maxPages: numberParam(body.maxPages, 100, 1, 100),
      delayMs: numberParam(body.delayMs, 1000, 0, 10000),
      force: Boolean(body.force),
    });

    return NextResponse.json({
      ok: true,
      result,
      warnings: result.warnings,
      errors: result.endpointErrors,
    });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return NextResponse.json(
      {
        ok: false,
        error: mapped.message,
        code: mapped.code,
      },
      { status: mapped.status ?? 400 },
    );
  }
}
