/**
 * Modulo: Amazon AGL.
 * Responsabilidad: desvincular manualmente un shipment Amazon inbound de una orden/proforma.
 * No debe tocar stock, contenedores ni estados logisticos/stock.
 */

import { NextRequest, NextResponse } from "next/server";
import { unlinkInboundShipmentFromOrder } from "@/modules/amazon-sp-api/linkInboundShipmentOrderService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

type UnlinkPayload = {
  orden_id?: string;
};

export async function POST(
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

  let body: UnlinkPayload;
  try {
    body = (await request.json()) as UnlinkPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Body invalido" }, { status: 400 });
  }

  const ordenId = String(body.orden_id ?? "").trim();
  if (!ordenId) {
    return NextResponse.json({ ok: false, error: "orden_id requerido" }, { status: 400 });
  }

  try {
    const result = await unlinkInboundShipmentFromOrder({
      shipmentId: decodeURIComponent(params.shipmentId),
      ordenId,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Error desvinculando shipment de orden",
      },
      { status: 400 },
    );
  }
}
