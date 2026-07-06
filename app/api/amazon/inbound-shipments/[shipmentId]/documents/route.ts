/**
 * Modulo: Amazon AGL.
 * Responsabilidad: documentos Drive de shipment Amazon inbound.
 * No debe tocar stock, contenedores ni estados logisticos/stock.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  listAmazonInboundShipmentDocuments,
  uploadAmazonInboundShipmentDocumentRecord,
} from "@/modules/amazon-sp-api/amazonInboundShipmentLogisticsService";
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
    const documents = await listAmazonInboundShipmentDocuments(
      decodeURIComponent(params.shipmentId),
    );
    return NextResponse.json({ ok: true, documents });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Error listando documentos",
      },
      { status: 400 },
    );
  }
}

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

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Archivo requerido" }, { status: 400 });
    }

    const document = await uploadAmazonInboundShipmentDocumentRecord({
      shipmentId: decodeURIComponent(params.shipmentId),
      file,
      tipoDocumento: String(formData.get("tipo_documento") ?? "otros"),
      notas: String(formData.get("notas") ?? "").trim() || null,
      userId: user.id,
    });

    return NextResponse.json({ ok: true, document });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Error subiendo documento",
        drive_required:
          error instanceof Error && error.message.includes("Drive no esta configurado"),
      },
      { status: 400 },
    );
  }
}
