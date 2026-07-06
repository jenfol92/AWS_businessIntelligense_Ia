/**
 * Modulo: Amazon AGL.
 * Responsabilidad: listar ordenes/proformas candidatas para un shipment Amazon inbound.
 * No debe tocar stock, contenedores ni estados logisticos/stock.
 */

import { NextRequest, NextResponse } from "next/server";
import { listLinkableOrdersForShipment } from "@/modules/amazon-sp-api/linkInboundShipmentOrderService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: { shipmentId: string } },
) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    const result = await listLinkableOrdersForShipment(
      decodeURIComponent(params.shipmentId),
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Error listando ordenes candidatas",
      },
      { status: 400 },
    );
  }
}
