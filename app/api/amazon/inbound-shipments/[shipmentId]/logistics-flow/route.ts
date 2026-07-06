/**
 * Modulo: Amazon AGL.
 * Responsabilidad: ajustar manualmente la clasificacion logistica del shipment.
 * No debe tocar stock, forecast, contenedores ni campos logisticos de fechas/tracking.
 */

import { NextRequest, NextResponse } from "next/server";

import { updateAmazonInboundShipmentLogisticsFlow } from "@/modules/amazon-sp-api/amazonInboundShipmentLogisticsService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

type Payload = {
  logistics_flow?:
    | "fabrica_a_amazon"
    | "almacen_a_amazon"
    /** Alias legacy aceptado temporalmente; se guarda como fabrica_a_amazon. */
    | "proveedor_a_amazon"
    | "desconocido"
    | null;
};

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
    const shipment = await updateAmazonInboundShipmentLogisticsFlow({
      shipmentId: decodeURIComponent(params.shipmentId),
      logisticsFlow: body.logistics_flow ?? null,
    });

    return NextResponse.json({ ok: true, shipment });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Error actualizando clasificacion logistica",
      },
      { status: 400 },
    );
  }
}
