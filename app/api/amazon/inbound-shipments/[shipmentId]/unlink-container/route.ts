/**
 * Modulo: Amazon AGL.
 * Responsabilidad: desvincular manualmente un shipment inbound de su contenedor.
 * No debe tocar stock, inventario_paises, forecast ni estados logisticos/stock.
 */

import { NextRequest, NextResponse } from "next/server";
import { unlinkInboundShipmentFromContainer } from "@/modules/amazon-sp-api/linkInboundShipmentContainerService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

type UnlinkPayload = {
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

  let body: UnlinkPayload = {};
  try {
    body = (await request.json()) as UnlinkPayload;
  } catch {
    body = {};
  }

  try {
    const result = await unlinkInboundShipmentFromContainer({
      shipmentId: decodeURIComponent(params.shipmentId),
      linkNotes: body.link_notes ?? null,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Error desvinculando shipment de contenedor",
      },
      { status: 400 },
    );
  }
}
