/**
 * Modulo: Amazon AGL.
 * Responsabilidad: vincular manualmente un shipment Amazon inbound con una orden/proforma.
 * No debe tocar stock, contenedores ni estados logisticos/stock.
 */

import { NextRequest, NextResponse } from "next/server";
import { linkInboundShipmentToOrder } from "@/modules/amazon-sp-api/linkInboundShipmentOrderService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

type LinkPayload = {
  orden_id?: string;
  link_notes?: string | null;
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

  let body: LinkPayload;
  try {
    body = (await request.json()) as LinkPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Body invalido" }, { status: 400 });
  }

  const ordenId = String(body.orden_id ?? "").trim();
  if (!ordenId) {
    return NextResponse.json({ ok: false, error: "orden_id requerido" }, { status: 400 });
  }

  try {
    const result = await linkInboundShipmentToOrder({
      shipmentId: decodeURIComponent(params.shipmentId),
      ordenId,
      linkNotes: body.link_notes ?? null,
      userId: user.id,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Error vinculando shipment con orden",
      },
      { status: 400 },
    );
  }
}
