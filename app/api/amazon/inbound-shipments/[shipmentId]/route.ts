/**
 * Modulo: Amazon AGL.
 * Responsabilidad: actualizar datos logisticos manuales de un shipment inbound.
 * No debe tocar stock, contenedores ni estados logisticos/stock.
 */

import { NextRequest, NextResponse } from "next/server";
import { updateAmazonInboundShipmentManualFields } from "@/modules/amazon-sp-api/amazonInboundShipmentLogisticsService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

type Payload = {
  eta_estimada?: string | null;
  fecha_salida?: string | null;
  fecha_entrega_real?: string | null;
  carrier?: string | null;
  tracking_number?: string | null;
  agl_tracking_number?: string | null;
  amazon_container_number?: string | null;
  booking_reference?: string | null;
  notas?: string | null;
};

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { shipmentId: string } },
) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ ok: false, error: "Body invalido" }, { status: 400 });
  }

  try {
    const shipment = await updateAmazonInboundShipmentManualFields({
      shipmentId: decodeURIComponent(params.shipmentId),
      eta_estimada: clean(body.eta_estimada),
      fecha_salida: clean(body.fecha_salida),
      fecha_entrega_real: clean(body.fecha_entrega_real),
      carrier: clean(body.carrier),
      tracking_number: clean(body.tracking_number),
      agl_tracking_number: clean(body.agl_tracking_number),
      amazon_container_number: clean(body.amazon_container_number),
      booking_reference: clean(body.booking_reference),
      notas: clean(body.notas),
    });

    return NextResponse.json({ ok: true, shipment });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Error actualizando datos logisticos",
      },
      { status: 400 },
    );
  }
}
