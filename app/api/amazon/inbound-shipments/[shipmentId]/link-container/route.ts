/**
 * Modulo: Amazon AGL.
 * Responsabilidad: vincular manualmente un shipment inbound con un contenedor AGL.
 * No debe tocar stock, inventario_paises, forecast ni estados logisticos/stock.
 */

import { NextRequest, NextResponse } from "next/server";
import { linkInboundShipmentToContainer } from "@/modules/amazon-sp-api/linkInboundShipmentContainerService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

type LinkPayload = {
  contenedor_id?: string;
  link_notes?: string | null;
  convert_to_amazon_agl?: boolean;
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

  const contenedorId = String(body.contenedor_id ?? "").trim();
  if (!contenedorId) {
    return NextResponse.json(
      { ok: false, error: "contenedor_id requerido" },
      { status: 400 },
    );
  }

  try {
    const result = await linkInboundShipmentToContainer({
      shipmentId: decodeURIComponent(params.shipmentId),
      contenedorId,
      linkNotes: body.link_notes ?? null,
      userId: user.id,
      convertToAmazonAgl: Boolean(body.convert_to_amazon_agl),
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Error vinculando shipment con contenedor",
      },
      { status: 400 },
    );
  }
}
