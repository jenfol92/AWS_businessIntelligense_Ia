/**
 * Modulo: Amazon AGL.
 * Responsabilidad: eliminar costes manuales de shipment Amazon inbound.
 * No debe tocar stock, contabilidad ni estados logisticos/stock.
 */

import { NextRequest, NextResponse } from "next/server";
import { deleteAmazonInboundShipmentCost } from "@/modules/amazon-sp-api/amazonInboundShipmentLogisticsService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { shipmentId: string; costId: string } },
) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    await deleteAmazonInboundShipmentCost({
      shipmentId: decodeURIComponent(params.shipmentId),
      costId: params.costId,
    });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Error eliminando coste",
      },
      { status: 400 },
    );
  }
}
