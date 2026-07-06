import { NextResponse } from "next/server";

import { buildAmazonInboundShipmentEnrichmentDiagnostic } from "@/modules/amazon-sp-api/amazonInboundShipmentEnrichmentDiagnosticService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

type Params = { params: { shipmentId: string } };

export async function GET(_req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    const diagnostic = await buildAmazonInboundShipmentEnrichmentDiagnostic(
      supabase,
      decodeURIComponent(params.shipmentId),
    );
    return NextResponse.json({ ok: true, diagnostic });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Error enriqueciendo shipment Amazon.",
      },
      { status: 500 },
    );
  }
}
