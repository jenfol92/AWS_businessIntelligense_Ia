/**
 * Modulo: Amazon AGL.
 * Responsabilidad: costes manuales de shipment Amazon inbound.
 * No debe tocar stock, contabilidad ni estados logisticos/stock.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createAmazonInboundShipmentCost,
  listAmazonInboundShipmentCosts,
} from "@/modules/amazon-sp-api/amazonInboundShipmentLogisticsService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

type Payload = {
  concepto?: string;
  amount?: number;
  currency?: string | null;
  cost_date?: string | null;
  notas?: string | null;
};

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
    const costs = await listAmazonInboundShipmentCosts(decodeURIComponent(params.shipmentId));
    return NextResponse.json({ ok: true, costs });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Error listando costes",
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

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ ok: false, error: "Body invalido" }, { status: 400 });
  }

  try {
    const cost = await createAmazonInboundShipmentCost({
      shipmentId: decodeURIComponent(params.shipmentId),
      concepto: String(body.concepto ?? ""),
      amount: Number(body.amount ?? 0),
      currency: body.currency ?? "EUR",
      costDate: body.cost_date ?? null,
      notas: body.notas ?? null,
      userId: user.id,
    });

    return NextResponse.json({ ok: true, cost });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Error creando coste",
      },
      { status: 400 },
    );
  }
}
